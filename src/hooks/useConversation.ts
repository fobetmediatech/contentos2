/**
 * useConversation — orchestrates the full conversational analysis pipeline.
 *
 * State machine (mirrors analysisStore.ts):
 *
 *   idle → chatting → discovering → confirming → running → clarifying → done
 *               ↑          │               │
 *               │ 0 seeds   │               └── analyze() / discover() fires
 *               └──────────┘
 *               ↑ needsClarification (max 1 turn)
 *               └──────────────────────
 *
 * Pipeline routing (T-routing):
 *   Gemini extracts pipelineType from the user message in the same parseIntent call.
 *   - 'competitor' → existing competitor analysis pipeline (default)
 *   - 'discovery'  → location discovery pipeline (useLocationDiscovery)
 *
 *   In the confirming state the user can redirect from discovery → competitor by
 *   selecting DISCOVERY_REDIRECT_TO_COMPETITOR. This calls runCompetitorDiscovery()
 *   which re-scrapes seeds from hashtags — never passes an empty handles array.
 *
 * AbortController lifecycle (T20):
 *   A new controller is created for each sendMessage() call.
 *   The ref is stored so unmounting ChatPage can abort in-flight discovery.
 *   useEffect cleanup calls controller.abort() on unmount.
 *
 * Clarification loop guard (T21):
 *   After 1 needsClarification turn, we force progression to avoid an infinite loop.
 *   The counter lives in component-local state (not the store) — it resets per mount.
 */

import { useRef, useState, useEffect } from 'react'
import { useAnalysisStore } from '../store/analysisStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useKeysStore } from '../store/keysStore'
import { useCompetitorAnalysis } from './useCompetitorAnalysis'
import { useLocationDiscovery } from './useLocationDiscovery'
import { parseIntent } from '../ai/intentParser'
import { generateHashtags } from '../lib/hashtagGenerator'
import { scrapeHashtagUsernames } from '../lib/apifyClient'
import { GeminiError, callGeminiFollowUp, callGeminiConfirmReply } from '../ai/gemini'
import { ApifyError } from '../lib/apifyCore'
import { PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR, GEMINI_KEY_MISSING_MSG } from '../lib/constants'
import { PIPELINE_REGISTRY } from '../tools/registry'
import type { ParsedIntent } from '../ai/intentParser'
import type { ResolvedIntent } from '../tools/types'

const DISCOVERY_TIMEOUT_MS = 90_000
const DISCOVERY_SOFT_NUDGE_MS = 60_000

// ── Pure confirming-state helpers (outside hook, no side effects) ─────────────

/**
 * Returns true if the user's typed text indicates they want to switch to the
 * *other* pipeline rather than confirm the current one.
 *
 * Intentionally conservative: only fires on strong explicit signals to avoid
 * false positives on regular confirmations.
 */
export function detectPipelineSwitch(text: string, currentPipeline: string): boolean {
  const lower = text.toLowerCase()
  if (currentPipeline === 'competitor') {
    // Trigger a switch to discovery only when the user explicitly names a location context.
    // Intentionally avoids `find.*creator` (too broad — matches "find the right macro creator")
    // and standalone `location` (matches "I know the location"). Anchored on concrete phrases.
    return /\blocal\b|\bbased in\b|\blocated in\b|\bdiscovery\b/.test(lower)
  }
  if (currentPipeline === 'discovery') {
    // Trigger a switch to competitor when the user explicitly asks for competitive analysis.
    // \banalysis\b is excluded — "thanks for the analysis!" is not a redirect intent.
    // Bounds who.*winning wildcard to prevent runaway matching.
    return /\bcompetitor\b|\bglobal\w*|\bdominates?\b|\bsimilar to\b|\bwho.{0,30}winning\b/.test(lower)
  }
  return false
}

/**
 * Keyword pre-filter that maps common typed responses to a known option string
 * WITHOUT a Gemini call. Returns the matched option string or null.
 *
 * CRITICAL ORDER: specific options (micro/macro/biz/redirect) MUST be checked
 * BEFORE generic affirmatives (yes/go/ok/fine/start) to avoid false positives
 * like "I'm fine with micro" matching the generic affirmative first.
 */
export function heuristicConfirmMatch(text: string, options: string[]): string | null {
  if (options.length === 0) return null
  const lower = text.toLowerCase()

  // Specific options FIRST — checked before generic affirmatives to avoid false
  // positives on phrases like "I'm fine with micro" or "start with brands".

  // Redirect: "competitors globally", "globally", "who dominates" etc.
  // \banalysis\b intentionally excluded — "thanks for the analysis!" would trigger a false redirect.
  const redirectOpt = options.find((o) => o === DISCOVERY_REDIRECT_TO_COMPETITOR)
  if (redirectOpt && /\bcompetitors?\b|\bglobal\w*|\bdominates?\b/.test(lower)) return redirectOpt

  // Micro: "micro", "small", "under" — NOT "100k" alone (ambiguous with macro).
  const microOpt = options.find((o) => /micro/i.test(o))
  if (microOpt && /\b(micro|small|under)\b/.test(lower)) return microOpt

  // Macro: "macro", "large", "big", or the literal "100k+" string.
  const macroOpt = options.find((o) => /macro/i.test(o))
  if (macroOpt && (/\b(macro|large|big)\b/.test(lower) || lower.includes('100k+'))) return macroOpt

  // Business/brand/company — handle plural forms (brands, companies).
  const bizOpt = options.find((o) => /business/i.test(o))
  if (bizOpt && /\bbusiness(?:es)?\b|\bbrands?\b|\bcompan(?:y|ies)\b/.test(lower)) return bizOpt

  // Generic affirmatives LAST (catch-all for "yes", "go", "ok", "sure", "start", "fine", etc.)
  if (/\b(yes|go|ok|sure|proceed|start|looks? right|fine)\b/.test(lower)) return options[0]

  return null
}

/** Scrape location-aware hashtags → post authors → return first 10 unique handles. */
async function discoverSeedHandles(
  niche: string,
  location: string,
  geminiKey: string,
  apifyKey: string,
  signal: AbortSignal,
): Promise<string[]> {
  const { hashtags } = await generateHashtags(geminiKey, location, niche, 'standard', signal)
  const handles = await scrapeHashtagUsernames(hashtags, apifyKey, signal)
  console.info('[discovery] seeds found:', handles.length, 'handles from', hashtags.length, 'hashtags')
  return handles.slice(0, 10)
}

export function useConversation() {
  const store = useAnalysisStore()
  const discoveryStore = useDiscoveryStore()
  const { geminiKey, pickKey } = useKeysStore()
  const { analyze } = useCompetitorAnalysis()
  const { discover } = useLocationDiscovery()

  // T21: clarification turn counter — resets each mount, never stored in Zustand
  const [clarificationTurns, setClarificationTurns] = useState(0)

  // Tracks whether we are currently awaiting Gemini's response for a typed
  // confirming-state message. Exposed to ChatPage so it can show a TypingIndicator
  // and disable the option buttons to prevent a button+type race condition.
  const [isConfirmingPending, setIsConfirmingPending] = useState(false)
  // Ref mirror of isConfirmingPending — used inside confirmSeeds() to guard
  // against button clicks that arrive during the 200ms window before React
  // re-renders the disabled state. A ref is read synchronously; state is not.
  const isConfirmingPendingRef = useRef(false)

  // AD5: retry counter — tracks consecutive failures in the confirming path.
  // After 2 failures the textarea is locked so the user is nudged back to the buttons.
  // Resets when the user successfully resolves the confirming state or leaves it.
  const [confirmErrorCount, setConfirmErrorCount] = useState(0)
  const confirmErrorCountRef = useRef(0)

  // T20: AbortController ref for discovery — cleaned up on unmount
  const discoveryAbortRef = useRef<AbortController | null>(null)

  // Soft-nudge timer ref — cleared on abort or completion
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hard-abort timeout ref — stored as ref so unmount cleanup can clear it.
  // A bare local variable inside runCompetitorDiscovery is unreachable from the
  // useEffect cleanup; storing it here guarantees it is always cancelled on unmount
  // even if the async function is mid-flight.
  const discoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // D6: single-flight guard — prevents Enter + button click firing sendMessage
  // twice in the same render frame before status transitions to 'discovering'.
  const isSendingRef = useRef(false)

  // T20: cleanup on unmount
  useEffect(() => {
    return () => {
      discoveryAbortRef.current?.abort()
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
      if (discoveryTimeoutRef.current) clearTimeout(discoveryTimeoutRef.current)
    }
  }, [])

  /**
   * Shared competitor-discovery flow: scrape seed handles from hashtags, then
   * transition to confirming state so the user can pick a direction.
   *
   * Extracted so both the initial competitor path AND the discovery→competitor
   * redirect can call it without duplicating AbortController/nudge logic or
   * risking an empty-handles crash in analyze([]).
   */
  const runCompetitorDiscovery = async (
    niche: string,
    location: string,
    geminiKey: string,
    apifyKey: string,
  ) => {
    const discoveryController = new AbortController()
    // Overwrites the parseController stored by sendMessage() — safe because
    // runCompetitorDiscovery() is always called after parseIntent() has resolved.
    discoveryAbortRef.current = discoveryController
    // Store in ref so the useEffect cleanup (and re-runs) can cancel it on unmount.
    discoveryTimeoutRef.current = setTimeout(() => discoveryController.abort(), DISCOVERY_TIMEOUT_MS)

    // T9: soft nudge at 60s
    nudgeTimerRef.current = setTimeout(() => {
      if (store.status === 'discovering') {
        store.addMessage({
          role: 'assistant',
          content: "Still searching — this is taking a bit longer than usual. Hang tight…",
          timestamp: Date.now(),
          type: 'text',
        })
      }
    }, DISCOVERY_SOFT_NUDGE_MS)

    try {
      const seeds = await discoverSeedHandles(
        niche,
        location,
        geminiKey,
        apifyKey,
        discoveryController.signal,
      )

      // T2: 0 seeds → back to chatting with fallback message
      if (seeds.length === 0) {
        store.addMessage({
          role: 'assistant',
          content: `Couldn't find accounts automatically for "${niche}"${location ? ` in ${location}` : ''}. Do you know any handles in this niche I can start from?`,
          timestamp: Date.now(),
          type: 'text',
        })
        store.setStatus('chatting')
        return
      }

      store.setDiscoveredSeeds(seeds)
      store.setStatus('confirming')
      console.info('[confirm] seeds set, transitioning to confirming:', seeds)

      // Show seeds with direction options — label the pipeline explicitly so users
      // know what's running. Escape hatch hint is shown statically in the UI (AD4).
      store.addMessage({
        role: 'assistant',
        content: `Found **${seeds.length} ${niche} accounts** via hashtag search: ${seeds.slice(0, 4).map(s => '@' + s).join(', ')}${seeds.length > 4 ? ` + ${seeds.length - 4} more` : ''}. Which direction should I focus on?`,
        timestamp: Date.now(),
        type: 'options',
        options: [
          PROCEED_LABEL,
          'Micro-influencers (under 100K followers)',
          'Macro creators (100K+ followers)',
          'Include businesses and brands',
        ],
      })

    } catch (err) {
      let message = 'Search timed out — try again.'
      if (err instanceof ApifyError) {
        // Don't forward err.message — it may contain internal URLs or key fragments.
        message = 'Scraping error — try again or check your Apify key.'
      } else if (err instanceof TypeError && String(err.message).includes('fetch')) {
        message = 'Network blocked — check your browser or disable shields.'
      } else if (discoveryController.signal.aborted) {
        message = 'Search timed out after 90 seconds. Try again.'
      }

      store.addMessage({ role: 'assistant', content: message, timestamp: Date.now(), type: 'error' })
      store.setStatus('chatting')
    } finally {
      // Always clear both timers — whether the discovery succeeded, failed, or was aborted.
      if (discoveryTimeoutRef.current) clearTimeout(discoveryTimeoutRef.current)
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
    }
  }

  /**
   * Build a short summary of the completed pipeline for follow-up context.
   * Reads from whichever store has a done result.
   */
  const buildPipelineSummary = (): string => {
    if (store.status === 'done') {
      const n = store.competitors.length
      return `Competitor analysis complete — found ${n} account${n !== 1 ? 's' : ''}${store.niche ? ` in the ${store.niche} space` : ''}.`
    }
    if (discoveryStore.status === 'done') {
      const n = discoveryStore.results.length
      const city = discoveryStore.params?.city
      return `Location discovery complete — found ${n} creator${n !== 1 ? 's' : ''}${city ? ` in ${city}` : ''}.`
    }
    return 'Analysis complete.'
  }

  /**
   * Extract account summaries from whichever pipeline just finished.
   * Used to give Gemini richer context in follow-up calls.
   * Case-insensitive username match to prevent 0-followers context on casing mismatches.
   */
  const buildFollowUpAccountSummaries = (): Array<{ username: string; followers: number; er: number }> | undefined => {
    if (store.status === 'done' && store.competitors.length > 0) {
      return store.competitors.map((c) => {
        const profile = store.inputProfiles.find(
          (p: { username: string }) => p.username.toLowerCase() === c.username.toLowerCase(),
        )
        return {
          username: c.username,
          followers: profile?.followersCount ?? 0,
          er: profile?.engagementRate ?? 0,
        }
      })
    }
    if (discoveryStore.status === 'done' && discoveryStore.results.length > 0) {
      return discoveryStore.results.map((r) => {
        const profile = discoveryStore.candidateProfiles.find(
          (p) => p.username.toLowerCase() === r.username.toLowerCase(),
        )
        return {
          username: r.username,
          followers: profile?.followersCount ?? 0,
          er: profile?.engagementRate ?? 0,
        }
      })
    }
    return undefined
  }

  /**
   * Handle a user message in the chat input.
   * When a pipeline is done, routes to follow-up instead of re-running parseIntent.
   */
  const sendMessage = async (text: string) => {
    // ── Confirming path: user typed text while waiting to pick a direction ────
    // This runs BEFORE the pipelineDone and chatting checks so it handles
    // the 'confirming' status (which is not 'chatting' and not 'done').
    if (store.status === 'confirming') {
      if (!text.trim() || isSendingRef.current) return
      isSendingRef.current = true
      setIsConfirmingPending(true)
      isConfirmingPendingRef.current = true
      try {
        const safeText = text.replace(/[\n\r]/g, ' ').trim().slice(0, 500)
        store.addMessage({ role: 'user', content: safeText, timestamp: Date.now(), type: 'text' })

        if (!geminiKey?.trim()) {
          store.addMessage({
            role: 'assistant',
            content: GEMINI_KEY_MISSING_MSG,
            timestamp: Date.now(),
            type: 'error',
          })
          return
        }

        const { parsedIntent } = store
        const pipelineType =
          parsedIntent && 'pipelineType' in parsedIntent
            ? (parsedIntent.pipelineType ?? 'competitor')
            : 'competitor'

        // 1. Pipeline-switch detection — re-enter the full intent pipeline
        if (detectPipelineSwitch(safeText, pipelineType)) {
          store.addMessage({
            role: 'assistant',
            content: 'Switching pipelines…',
            timestamp: Date.now(),
            type: 'text',
          })
          // CRITICAL: clear guards BEFORE recursive call or the inner sendMessage
          // hits isSendingRef.current = true and silently no-ops (AE1).
          isSendingRef.current = false
          setIsConfirmingPending(false)
          isConfirmingPendingRef.current = false
          store.setStatus('chatting')
          await sendMessage(safeText)
          return
        }

        // Guard: if the stored intent is a clarification (needsClarification: true),
        // the pipeline was never fully resolved — drop back to chatting so the user
        // can re-state their request with a full query.
        if (!parsedIntent || ('needsClarification' in parsedIntent && parsedIntent.needsClarification)) {
          store.addMessage({
            role: 'assistant',
            content: 'Something went wrong with your request — please try again.',
            timestamp: Date.now(),
            type: 'error',
          })
          store.setStatus('chatting')
          return
        }
        const intent = parsedIntent as ResolvedIntent
        const availableOptions =
          PIPELINE_REGISTRY[pipelineType]?.confirmOptions(intent) ?? [PROCEED_LABEL]

        // 2. Heuristic pre-filter — no Gemini call needed
        const heuristicMatch = heuristicConfirmMatch(safeText, availableOptions)
        if (heuristicMatch) {
          store.addMessage({
            role: 'assistant',
            content: `Got it — running with "${heuristicMatch}"…`,
            timestamp: Date.now(),
            type: 'text',
          })
          confirmSeeds(heuristicMatch)
          return
        }

        // 3. Gemini fallback — maps free text to the closest option string
        const confirmController = new AbortController()
        discoveryAbortRef.current = confirmController  // allow abort on navigate/unmount (AE4)
        const mappedOption = await callGeminiConfirmReply(
          geminiKey,
          safeText,
          availableOptions,
          confirmController.signal,
        )
        store.addMessage({
          role: 'assistant',
          content: `Got it — running with "${mappedOption}"…`,
          timestamp: Date.now(),
          type: 'text',
        })
        // AD5: successful resolution — reset the error counter
        confirmErrorCountRef.current = 0
        setConfirmErrorCount(0)
        confirmSeeds(mappedOption)
      } catch {
        // AD5: increment error counter; after 2 failures, lock the textarea and
        // nudge the user to use the buttons instead.
        const newCount = confirmErrorCountRef.current + 1
        confirmErrorCountRef.current = newCount
        setConfirmErrorCount(newCount)
        const content = newCount >= 2
          ? "Let's keep it simple — just pick one of the options above."
          : "I'm not sure which direction you mean — try describing it differently, or pick one of the options."
        store.addMessage({
          role: 'assistant',
          content,
          timestamp: Date.now(),
          type: newCount >= 2 ? 'error' : 'text',
        })
        // Stay in confirming so the user can still click a button
        store.setStatus('confirming')
      } finally {
        isSendingRef.current = false
        setIsConfirmingPending(false)
        isConfirmingPendingRef.current = false
      }
      return
    }

    // Follow-up path: pipeline finished, user refines/asks a question
    const pipelineDone = store.status === 'done' || discoveryStore.status === 'done'
    if (pipelineDone) {
      if (!text.trim()) return
      if (isSendingRef.current) return
      isSendingRef.current = true
      try {
        const safeText = text.replace(/[\n\r]/g, ' ').trim().slice(0, 500)
        store.addMessage({ role: 'user', content: safeText, timestamp: Date.now(), type: 'text' })

        if (!geminiKey?.trim()) {
          store.addMessage({
            role: 'assistant',
            content: GEMINI_KEY_MISSING_MSG,
            timestamp: Date.now(),
            type: 'error',
          })
          return
        }

        // Abort any in-flight follow-up before starting a new one — otherwise the
        // old request becomes a zombie and calls store.addMessage with stale data.
        discoveryAbortRef.current?.abort()
        const followUpController = new AbortController()
        discoveryAbortRef.current = followUpController

        try {
          const summary = buildPipelineSummary()
          const accountSummaries = buildFollowUpAccountSummaries()
          const reply = await callGeminiFollowUp(geminiKey, summary, safeText, followUpController.signal, accountSummaries)
          store.addMessage({ role: 'assistant', content: reply, timestamp: Date.now(), type: 'text' })
        } catch (err) {
          let content = 'Something went wrong — try again.'
          if (err instanceof GeminiError) {
            if (err.code === 'AUTH_ERROR') content = 'Gemini API key is invalid or missing. Go to Settings to update it.'
            else if (err.code === 'RATE_LIMITED') content = 'Gemini rate limit hit — wait a few seconds and try again.'
          }
          store.addMessage({ role: 'assistant', content, timestamp: Date.now(), type: 'error' })
        }
      } finally {
        isSendingRef.current = false
      }
      return
    }

    // Normal chat path
    if (store.status !== 'chatting') return
    if (!text.trim()) return
    if (isSendingRef.current) return
    isSendingRef.current = true

    try {
      const safeText = text.replace(/[\n\r]/g, ' ').trim().slice(0, 500)

      // Append user message to conversation
      store.addMessage({ role: 'user', content: safeText, timestamp: Date.now(), type: 'text' })

      const apifyKey = pickKey()
      if (!apifyKey) {
        store.addMessage({
          role: 'assistant',
          content: 'No Apify keys available. Add one in Settings.',
          timestamp: Date.now(),
          type: 'error',
        })
        return
      }

      if (!geminiKey?.trim()) {
        store.addMessage({
          role: 'assistant',
          content: 'Gemini API key missing. Add it in Settings.',
          timestamp: Date.now(),
          type: 'error',
        })
        return
      }

      // Step 1: parse intent
      store.setStatus('discovering')  // show typing indicator immediately

      // Sequential guarantee: parseIntent() is fully awaited before
      // runCompetitorDiscovery() runs and overwrites this ref with its own
      // discoveryController — the parse phase is always complete by then.
      const parseController = new AbortController()
      discoveryAbortRef.current = parseController

      let intent: ParsedIntent
      try {
        intent = await parseIntent(geminiKey, safeText, parseController.signal)
        console.info('[chat] intent parsed:', intent)
      } catch (err) {
        let errorContent = "Couldn't understand that — try rephrasing."
        if (err instanceof GeminiError) {
          if (err.code === 'AUTH_ERROR') {
            errorContent = 'Gemini API key is invalid or missing. Go to Settings to update it.'
          } else if (err.code === 'RATE_LIMITED') {
            errorContent = 'Gemini rate limit hit — wait a few seconds and try again.'
          } else if (err.code === 'PARSE_ERROR') {
            errorContent = 'Gemini returned an unexpected response — try again.'
          } else if (err.message.toLowerCase().includes('network')) {
            errorContent = 'Network error — check your connection and try again.'
          }
        }
        store.addMessage({
          role: 'assistant',
          content: errorContent,
          timestamp: Date.now(),
          type: 'error',
        })
        store.setStatus('chatting')
        return
      }

      // Handle needsClarification (T21: max 1 turn)
      if ('needsClarification' in intent && intent.needsClarification === true) {
        if (clarificationTurns < 1) {
          setClarificationTurns((c) => c + 1)
          store.addMessage({
            role: 'assistant',
            content: intent.question,
            timestamp: Date.now(),
            type: 'text',
          })
          store.setStatus('chatting')
          return
        }
        // Second ambiguous response — force a handle-based fallback
        store.addMessage({
          role: 'assistant',
          content: "Having trouble understanding. Name a handle you want to analyze, and I'll find similar accounts.",
          timestamp: Date.now(),
          type: 'text',
        })
        store.setStatus('chatting')
        return
      }

      // Store parsed intent for confirmSeeds()
      store.setParsedIntent(intent)

      // Step 2: route to the correct pipeline via registry
      const niche = 'niche' in intent ? intent.niche : ''
      const location = 'location' in intent ? (intent.location ?? '') : ''
      const pipelineType = 'pipelineType' in intent ? (intent.pipelineType ?? 'competitor') : 'competitor'

      const descriptor = PIPELINE_REGISTRY[pipelineType]

      if (descriptor && pipelineType !== 'competitor') {
        // Non-competitor pipelines: show confirm message from registry, require a location if missing
        if (pipelineType === 'discovery' && !location) {
          store.addMessage({
            role: 'assistant',
            content: `I can find **${niche}** creators in a specific city. Which city should I search in?`,
            timestamp: Date.now(),
            type: 'text',
          })
          store.setStatus('chatting')
          return
        }

        // Confirm before firing the pipeline
        store.setStatus('confirming')
        store.addMessage({
          role: 'assistant',
          content: descriptor.confirmMessage(intent),
          timestamp: Date.now(),
          type: 'options',
          options: descriptor.confirmOptions(intent),
        })
        return
      }

      // Competitor pipeline (default)
      // If the user already provided reference handles, skip hashtag discovery entirely —
      // go straight to confirming with their handles as seeds.
      //
      // Gemini extraction via responseSchema is unreliable when thinkingBudget=0.
      // Extract @handles client-side as a guaranteed fallback — regex is deterministic
      // and doesn't depend on model reasoning capability.
      const geminiHandles = ('knownHandles' in intent ? (intent.knownHandles ?? []) : [])
        .filter((h): h is string => typeof h === 'string' && /^[a-zA-Z0-9._]{1,50}$/.test(h))
      const clientHandles = [...safeText.matchAll(/@([a-zA-Z0-9._]+)/g)]
        .map(m => m[1].toLowerCase())
        .filter(h => h.length <= 50)               // match Gemini validation cap
        .filter((h, i, arr) => arr.indexOf(h) === i) // dedup
        .slice(0, 5)
      const knownHandles = geminiHandles.length > 0 ? geminiHandles : clientHandles
      if (knownHandles.length > 0) {
        store.setDiscoveredSeeds(knownHandles)
        store.setStatus('confirming')
        store.addMessage({
          role: 'assistant',
          content: `Got **${knownHandles.length} reference account${knownHandles.length > 1 ? 's' : ''}**: ${knownHandles.slice(0, 4).map(h => '@' + h).join(', ')}${knownHandles.length > 4 ? ` + ${knownHandles.length - 4} more` : ''}. Which direction should I focus on?`,
          timestamp: Date.now(),
          type: 'options',
          options: [
            PROCEED_LABEL,
            'Micro-influencers (under 100K followers)',
            'Macro creators (100K+ followers)',
            'Include businesses and brands',
          ],
        })
      } else {
        await runCompetitorDiscovery(niche, location, geminiKey, apifyKey)
      }
    } finally {
      isSendingRef.current = false
    }
  }

  /**
   * Called when the user selects a direction option in the confirming state.
   * Routes to either the competitor analysis pipeline or location discovery pipeline.
   *
   * T3: null guard on parsedIntent — if missing, reset to chatting.
   *
   * Extension point: to add a third pipeline, add a new `if (pipelineType === 'your-type')` block
   * here (and a matching PipelineToolDescriptor entry in registry.ts). The registry handles
   * UI metadata; confirmSeeds handles the dispatch logic.
   */
  const confirmSeeds = (selectedOption: string) => {
    // Guard: confirmSeeds is wired to option buttons that are only rendered in
    // the 'confirming' state, but ChatMessage doesn't enforce this — a stale
    // closure or double-click could call this from any status.
    if (store.status !== 'confirming') return

    // AE2: Button+type race guard. If the user types+submits and then clicks a
    // button within the 200ms before React re-renders the disabled state, this
    // ref catches the double-fire synchronously (state would still read false).
    if (isConfirmingPendingRef.current) return

    const { parsedIntent, discoveredSeeds } = store

    // T3: null guard
    if (!parsedIntent || ('needsClarification' in parsedIntent && parsedIntent.needsClarification)) {
      store.addMessage({
        role: 'assistant',
        content: 'Session expired. Start a new conversation to try again.',
        timestamp: Date.now(),
        type: 'text',
      })
      store.setStatus('chatting')
      return
    }

    const intent = parsedIntent as Extract<ParsedIntent, { needsClarification?: false | null | undefined }>
    const niche = 'niche' in intent ? intent.niche : ''
    const location = 'location' in intent ? (intent.location ?? '') : ''
    const pipelineType = 'pipelineType' in intent ? (intent.pipelineType ?? 'competitor') : 'competitor'

    // ── Discovery pipeline confirmation ─────────────────────────────────────
    if (pipelineType === 'discovery') {
      if (selectedOption === DISCOVERY_REDIRECT_TO_COMPETITOR) {
        // User wants competitor analysis instead — scrape seeds first (never pass [] to analyze)
        const apifyKey = pickKey()
        if (!apifyKey || !geminiKey?.trim()) {
          store.addMessage({
            role: 'assistant',
            content: 'API keys missing. Check Settings and try again.',
            timestamp: Date.now(),
            type: 'error',
          })
          store.setStatus('chatting')
          return
        }
        store.setStatus('discovering')
        void runCompetitorDiscovery(niche, location, geminiKey, apifyKey).catch(() => {
          store.setStatus('chatting')
        })
        return
      }

      // User confirmed discovery — fire the location discovery pipeline
      discover({
        city: location,
        niche,
        depth: intent.depth ?? 'standard',
        clientName: intent.clientName ?? '',
      })
      return
    }

    // ── Competitor pipeline confirmation ────────────────────────────────────
    const isProceedAsIs = selectedOption === PROCEED_LABEL || selectedOption === ''
    const nicheContext = isProceedAsIs ? niche : `${niche} — ${selectedOption}`

    console.info('[confirm] option selected:', selectedOption, '→ nicheContext:', nicheContext)

    analyze({
      handles: discoveredSeeds,
      depth: intent.depth ?? 'standard',
      clientName: intent.clientName ?? '',
      nicheContext,
    })
    // useEffect in ChatPage watches status === 'running' → navigates to /progress
  }

  // AD5: textarea is locked after 2+ consecutive confirming failures.
  // Reset happens on successful resolution (in sendMessage) or via confirmSeeds (button click).
  const isConfirmingLocked = confirmErrorCount >= 2

  // Reset error count when the user confirms via button so the counter doesn't carry
  // over if they re-enter the confirming state in a new conversation.
  const confirmSeedsWithReset = (option: string) => {
    confirmErrorCountRef.current = 0
    setConfirmErrorCount(0)
    confirmSeeds(option)
  }

  return { sendMessage, confirmSeeds: confirmSeedsWithReset, isConfirmingPending, isConfirmingLocked }
}
