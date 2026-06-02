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
 * AbortController lifecycle (M2):
 *   Each in-flight request (parse, discovery, confirm-reply, content) gets its OWN
 *   AbortController, tracked in a Set — requests no longer share one ref (which could
 *   abort the wrong one). useEffect cleanup aborts the whole set on unmount; pending
 *   timers are tracked the same way so a concurrent run can't clobber them (M1).
 *
 * Clarification loop guard (T21, Phase 1a):
 *   After 2 needsClarification turns, we force progression to avoid an infinite loop.
 *   (Phase 1a raised the cap from 1→2 so the parser, which now asks when the creator
 *   target is ambiguous instead of best-guessing, can hold a real clarifying exchange.)
 *   The counter lives in component-local state (not the store) — it resets per mount.
 */

import { useRef, useState, useEffect } from 'react'
import { useAnalysisStore } from '../store/analysisStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useKeysStore } from '../store/keysStore'
import { useCompetitorAnalysis } from './useCompetitorAnalysis'
import { useLocationDiscovery } from './useLocationDiscovery'
import { useReelAnalysis } from './useReelAnalysis'
import { parseIntent } from '../ai/intentParser'
import { generateHashtags } from '../lib/hashtagGenerator'
import { scrapeHashtagUsernames } from '../lib/apifyClient'
import { GeminiError, callGeminiContent, callGeminiConfirmReply } from '../ai/gemini'
import { ApifyError } from '../lib/apifyCore'
import { PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR, GEMINI_KEY_MISSING_MSG } from '../lib/constants'
import { PIPELINE_REGISTRY } from '../tools/registry'
import type { ParsedIntent } from '../ai/intentParser'
import type { ResolvedIntent } from '../tools/types'
import type { ContentContext } from '../ai/prompts'

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
  // Reel analysis is triggerable from here (NL-routed) the same way analyze()/discover()
  // are. Safe to mount alongside ChatPage's instance — synthesis is explicit, not an
  // effect, so it never double-fires (see useReelAnalysis).
  const { startAnalysis: startReelAnalysis } = useReelAnalysis()

  // T21: clarification turn counter — resets each mount, never stored in Zustand
  const [clarificationTurns, setClarificationTurns] = useState(0)

  // Tracks whether we are currently awaiting Gemini's response for a typed
  // confirming-state message. Exposed to ChatPage so it can show a TypingIndicator
  // and disable the option buttons to prevent a button+type race condition.
  const [isConfirmingPending, setIsConfirmingPending] = useState(false)
  // True while the content copilot is generating a reply — drives a typing indicator
  // and disables send (so a second content turn can't fire mid-generation).
  const [isAnswering, setIsAnswering] = useState(false)
  // Ref mirror of isConfirmingPending — used inside confirmSeeds() to guard
  // against button clicks that arrive during the 200ms window before React
  // re-renders the disabled state. A ref is read synchronously; state is not.
  const isConfirmingPendingRef = useRef(false)

  // AD5: retry counter — tracks consecutive failures in the confirming path.
  // After 2 failures the textarea is locked so the user is nudged back to the buttons.
  // Resets when the user successfully resolves the confirming state or leaves it.
  const [confirmErrorCount, setConfirmErrorCount] = useState(0)
  const confirmErrorCountRef = useRef(0)

  // M2: every in-flight request gets its OWN AbortController, tracked here. The old
  // single discoveryAbortRef multiplexed parse / discovery / confirm-reply / follow-up
  // through one slot, so a new request (or unmount) could abort a DIFFERENT request than
  // intended. We isolate per request and abort the whole set on unmount.
  const activeControllers = useRef<Set<AbortController>>(new Set())
  // M1: pending timers, tracked so each invocation clears its OWN. The old shared
  // nudge/hard-abort refs let a second runCompetitorDiscovery overwrite the first's
  // timers — the first's finally then cleared the SECOND's, cancelling its 90s timeout.
  const activeTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())

  // D6: single-flight guard — prevents Enter + button click firing sendMessage
  // twice in the same render frame before status transitions to 'discovering'.
  const isSendingRef = useRef(false)

  // Create + track an AbortController; release (untrack) it when the op settles.
  const trackController = (): AbortController => {
    const c = new AbortController()
    activeControllers.current.add(c)
    return c
  }
  const releaseController = (c: AbortController): void => {
    activeControllers.current.delete(c)
  }
  // setTimeout that auto-untracks when it fires; clearTracked() cancels + untracks early.
  const trackTimeout = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const t = setTimeout(() => {
      activeTimers.current.delete(t)
      fn()
    }, ms)
    activeTimers.current.add(t)
    return t
  }
  const clearTracked = (t: ReturnType<typeof setTimeout> | null): void => {
    if (t === null) return
    clearTimeout(t)
    activeTimers.current.delete(t)
  }

  // Cleanup on unmount: abort every in-flight request and clear every pending timer.
  useEffect(() => {
    const controllers = activeControllers.current
    const timers = activeTimers.current
    return () => {
      controllers.forEach((c) => c.abort())
      controllers.clear()
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
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
    // M2: own controller (tracked for unmount-abort, not a shared ref).
    const discoveryController = trackController()
    // M1: timers are LOCAL to this invocation — a concurrent run can't overwrite them,
    // and the finally clears exactly these two (the set also clears them on unmount).
    const hardTimeout = trackTimeout(() => discoveryController.abort(), DISCOVERY_TIMEOUT_MS)
    const nudgeTimer = trackTimeout(() => {
      if (store.status === 'discovering') {
        store.addMessage({
          role: 'assistant',
          content: "Still searching — this is taking a bit longer than usual. Hang tight…",
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
      if (err instanceof GeminiError && err.code === 'AUTH_ERROR') {
        // H10: hashtag generation now throws on a bad Gemini key instead of silently
        // falling back to template hashtags — surface it so the user fixes the key.
        message = 'Gemini API key is invalid or missing. Add it in Settings.'
      } else if (err instanceof ApifyError) {
        // Don't forward err.message — it may contain internal URLs or key fragments.
        message = 'Scraping error — try again or check your Apify key.'
      } else if (err instanceof TypeError && String(err.message).includes('fetch')) {
        message = 'Network blocked — check your browser or disable shields.'
      } else if (discoveryController.signal.aborted) {
        message = 'Search timed out after 90 seconds. Try again.'
      }

      store.addMessage({ role: 'assistant', content: message, type: 'error' })
      store.setStatus('chatting')
    } finally {
      // Clear exactly THIS invocation's timers + release its controller (M1/M2).
      clearTracked(hardTimeout)
      clearTracked(nudgeTimer)
      releaseController(discoveryController)
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
   * Assemble research grounding for the content copilot from whatever the user
   * has run this session (competitor/discovery results + reel synthesis).
   */
  const buildContentContext = (): ContentContext | undefined => {
    const ctx: ContentContext = {}

    if (
      (store.status === 'done' && store.competitors.length > 0) ||
      (discoveryStore.status === 'done' && discoveryStore.results.length > 0)
    ) {
      ctx.researchSummary = buildPipelineSummary()
      ctx.accounts = buildFollowUpAccountSummaries()
    }

    // Reel synthesis (read fresh — the reel store is separate from this hook).
    const reel = useReelAnalysisStore.getState()
    if (reel.synthesisStatus === 'done' && reel.synthesis) {
      ctx.hookPatterns = reel.synthesis.topPatterns.map((p) => ({ archetype: p.archetype, count: p.count }))
      ctx.replicateTips = reel.synthesis.replicateTips
      if (!ctx.researchSummary) {
        const who = reel.activeHandles.map((h) => '@' + h).join(', ')
        ctx.researchSummary = `Reel hook analysis just completed for ${who}.`
      }
    }

    return Object.keys(ctx).length > 0 ? ctx : undefined
  }

  /**
   * Content copilot turn — answer or generate content conversationally, grounded
   * in the session's research context. No scraping. Used for both the 'content'
   * intent (idle chat) and follow-up messages after a pipeline completes.
   */
  const answerContent = async (userMessage: string) => {
    if (!geminiKey?.trim()) {
      store.addMessage({ role: 'assistant', content: GEMINI_KEY_MISSING_MSG, type: 'error' })
      return
    }
    // M2: own tracked controller. sendMessage's single-flight (isSendingRef) already
    // prevents a second content turn from overlapping this one, so there's no prior
    // call to abort — the set handles unmount.
    const controller = trackController()
    setIsAnswering(true)
    try {
      const reply = await callGeminiContent(geminiKey, userMessage, buildContentContext(), controller.signal)
      store.addMessage({ role: 'assistant', content: reply, type: 'text' })
    } catch (err) {
      if (controller.signal.aborted) return
      let content = 'Something went wrong — try again.'
      if (err instanceof GeminiError) {
        if (err.code === 'AUTH_ERROR') content = 'Gemini API key is invalid or missing. Go to Settings to update it.'
        else if (err.code === 'RATE_LIMITED') content = 'Gemini rate limit hit — wait a few seconds and try again.'
      }
      store.addMessage({ role: 'assistant', content, type: 'error' })
    } finally {
      releaseController(controller)
      setIsAnswering(false)
    }
  }

  /**
   * Handle a user message in the chat input.
   * When a pipeline is done, routes to the content copilot instead of re-running parseIntent.
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
        store.addMessage({ role: 'user', content: safeText, type: 'text' })

        if (!geminiKey?.trim()) {
          store.addMessage({
            role: 'assistant',
            content: GEMINI_KEY_MISSING_MSG,
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
            type: 'text',
          })
          confirmSeeds(heuristicMatch)
          return
        }

        // 3. Gemini fallback — maps free text to the closest option string.
        // M2: own tracked controller, released once the call settles.
        const confirmController = trackController()
        let mappedOption: string
        try {
          mappedOption = await callGeminiConfirmReply(
            geminiKey,
            safeText,
            availableOptions,
            confirmController.signal,
          )
        } finally {
          releaseController(confirmController)
        }
        store.addMessage({
          role: 'assistant',
          content: `Got it — running with "${mappedOption}"…`,
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
        store.addMessage({ role: 'user', content: safeText, type: 'text' })
        // Pipeline done → every message is a content-copilot turn, grounded in results.
        await answerContent(safeText)
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
      store.addMessage({ role: 'user', content: safeText, type: 'text' })

      const apifyKey = pickKey()
      if (!apifyKey) {
        store.addMessage({
          role: 'assistant',
          content: 'No Apify keys available. Add one in Settings.',
          type: 'error',
        })
        return
      }

      if (!geminiKey?.trim()) {
        store.addMessage({
          role: 'assistant',
          content: 'Gemini API key missing. Add it in Settings.',
          type: 'error',
        })
        return
      }

      // Step 0: handles-only fast path — detect bare comma/space-separated usernames
      // WITHOUT @ signs and bypass Gemini entirely.
      //
      // Gemini can't infer a niche from raw usernames alone (no context), so it
      // returns needsClarification:true. If clarificationTurns is already 1, the
      // user hits the fallback and gets stuck. This pre-check breaks that loop.
      //
      // Only fires when:
      //   - No @ signs (messages with @ go through the existing Gemini path which handles them well)
      //   - All tokens match Instagram handle format
      //   - No common English words (rules out prose sentences)
      //   - Has commas OR at least one token has dots/underscores/digits (confirms list intent)
      const HANDLE_TOKEN_RE = /^[a-zA-Z0-9._]{3,30}$/
      const COMMON_WORDS = new Set([
        'the', 'and', 'for', 'are', 'you', 'can', 'this', 'that', 'from', 'not',
        'with', 'find', 'show', 'want', 'like', 'more', 'some', 'any', 'all',
        'get', 'has', 'its', 'was', 'how', 'who', 'what', 'when', 'help',
        'similar', 'analyze', 'search', 'look', 'creators', 'accounts', 'brands',
        'influencers', 'bloggers', 'niche', 'best', 'top', 'good', 'great',
      ])
      if (!safeText.includes('@')) {
        const rawTokens = safeText.split(/[\s,]+/).map(t => t.trim()).filter(Boolean)
        const isHandlesOnly =
          rawTokens.length >= 1 &&
          rawTokens.length <= 5 &&
          rawTokens.every(t => HANDLE_TOKEN_RE.test(t)) &&
          !rawTokens.some(t => COMMON_WORDS.has(t.toLowerCase())) &&
          // Confirm list intent: commas present OR a token has handle-special chars
          (safeText.includes(',') || rawTokens.some(t => /[._\d]/.test(t)))

        if (isHandlesOnly) {
          // Deduplicate case-insensitively before storing
          const seen = new Set<string>()
          const directHandles = rawTokens
            .map(h => h.toLowerCase())
            .filter(h => !seen.has(h) && seen.add(h))
          // Synthesize a competitor intent — this fast path bypasses parseIntent
          // (which normally sets parsedIntent), so without this confirmSeeds() hits
          // its null guard and the user dead-ends on "Session expired".
          store.setParsedIntent({
            needsClarification: false,
            niche: '',
            location: undefined,
            knownHandles: directHandles,
            depth: 'standard',
            clientName: undefined,
            pipelineType: 'competitor',
            routingConfidence: 'high',
          } as ParsedIntent)
          store.setDiscoveredSeeds(directHandles)
          store.setStatus('confirming')
          store.addMessage({
            role: 'assistant',
            content: `Got **${directHandles.length} reference account${directHandles.length > 1 ? 's' : ''}**: ${directHandles.map(h => '@' + h).join(', ')}. Which direction should I focus on?`,
            type: 'options',
            options: [
              PROCEED_LABEL,
              'Micro-influencers (under 100K followers)',
              'Macro creators (100K+ followers)',
              'Include businesses and brands',
            ],
          })
          return
        }
      }

      // Step 1: parse intent
      store.setStatus('discovering')  // show typing indicator immediately

      // M2: own tracked controller for the parse phase, released when it settles.
      const parseController = trackController()

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
          type: 'error',
        })
        store.setStatus('chatting')
        return
      } finally {
        releaseController(parseController)
      }

      // Handle needsClarification (T21: max 2 turns — Phase 1a)
      // Phase 1a (10C): the parser now ASKS when the creator target is ambiguous
      // (prompts.ts) instead of best-guessing, and we let it hold up to TWO
      // clarifying turns before forcing a fallback. This is the "consume the
      // signal the classifier already emits" fix — no agent loop required.
      const CLARIFICATION_CAP = 2
      if ('needsClarification' in intent && intent.needsClarification === true) {
        if (clarificationTurns < CLARIFICATION_CAP) {
          setClarificationTurns((c) => c + 1)
          store.addMessage({
            role: 'assistant',
            content: intent.question,
            type: 'text',
          })
          store.setStatus('chatting')
          return
        }
        // Cap reached and still ambiguous — force a handle-based fallback.
        // Reset clarificationTurns so the user can try again after providing handles.
        setClarificationTurns(0)
        store.addMessage({
          role: 'assistant',
          content: "Having trouble understanding. Name a handle you want to analyze, and I'll find similar accounts.",
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
      const routingConfidence = 'routingConfidence' in intent ? (intent.routingConfidence ?? 'high') : 'high'

      // ── Content copilot ────────────────────────────────────────────────────
      // Conversational help / generation — no scraping, no confirm step.
      if (pipelineType === 'content') {
        await answerContent(safeText)
        return
      }

      const descriptor = PIPELINE_REGISTRY[pipelineType]

      // Reference handles — used by both the reel and competitor paths. Prefer
      // Gemini's knownHandles; fall back to a deterministic @handle regex (Gemini
      // extraction is unreliable with thinkingBudget=0).
      const geminiHandles = ('knownHandles' in intent ? (intent.knownHandles ?? []) : [])
        .filter((h): h is string => typeof h === 'string' && /^[a-zA-Z0-9._]{1,30}$/.test(h))
      const clientHandles = [...safeText.matchAll(/@([a-zA-Z0-9._]+)/g)]
        .map(m => m[1].toLowerCase())
        .filter(h => h.length <= 30)               // Instagram max handle length is 30 chars
        .filter((h, i, arr) => arr.indexOf(h) === i) // dedup
        .slice(0, 5)
      const knownHandles = geminiHandles.length > 0 ? geminiHandles : clientHandles

      // ── Routing confidence (Phase 1a) ────────────────────────────────────────
      // The parser is only "medium" confident about competitor-vs-discovery when a
      // location is present (e.g. "fitness creators in Austin" — competitors based
      // there, or local creators?). Rather than dispatch the guess, ASK which one.
      // Reuses the clarification loop + shared cap. Tightly gated (medium + location
      // + no handles + competitor/discovery) so clear requests never get interrogated.
      if (
        routingConfidence === 'medium' &&
        location &&
        knownHandles.length === 0 &&
        (pipelineType === 'competitor' || pipelineType === 'discovery') &&
        clarificationTurns < CLARIFICATION_CAP
      ) {
        setClarificationTurns((c) => c + 1)
        store.addMessage({
          role: 'assistant',
          content: `Want **${niche || 'those'}** competitors anywhere, or creators physically **based in ${location}**? Tell me which and I'll run the right search.`,
          type: 'text',
        })
        store.setStatus('chatting')
        return
      }

      // ── Reel / hook analysis ───────────────────────────────────────────────
      // Needs specific creators to study. If none were named, ask for handles.
      if (pipelineType === 'reel') {
        if (knownHandles.length === 0) {
          store.addMessage({
            role: 'assistant',
            content: "Which creators' reels should I break down? Share their @handles (e.g. @username, @username2).",
            type: 'text',
          })
          store.setStatus('chatting')
          return
        }
        store.setDiscoveredSeeds(knownHandles)
        store.setStatus('confirming')
        const shown = knownHandles.slice(0, 4).map(h => '@' + h).join(', ')
        store.addMessage({
          role: 'assistant',
          content: `Break down the hook patterns in recent reels for ${shown}${knownHandles.length > 4 ? ` + ${knownHandles.length - 4} more` : ''}? I'll analyze the top ~10 reels each — about 2–3 min per creator.`,
          type: 'options',
          options: descriptor.confirmOptions(intent),
        })
        return
      }

      // ── Location discovery ─────────────────────────────────────────────────
      if (descriptor && pipelineType === 'discovery') {
        // Require a city before firing the geographic pipeline.
        if (!location) {
          store.addMessage({
            role: 'assistant',
            content: `I can find **${niche}** creators in a specific city. Which city should I search in?`,
            type: 'text',
          })
          store.setStatus('chatting')
          return
        }
        store.setStatus('confirming')
        store.addMessage({
          role: 'assistant',
          content: descriptor.confirmMessage(intent),
          type: 'options',
          options: descriptor.confirmOptions(intent),
        })
        return
      }

      // ── Competitor pipeline (default) ──────────────────────────────────────
      // If the user already named reference handles, skip hashtag discovery and
      // go straight to confirming with their handles as seeds.
      if (knownHandles.length > 0) {
        store.setDiscoveredSeeds(knownHandles)
        store.setStatus('confirming')
        store.addMessage({
          role: 'assistant',
          content: `Got **${knownHandles.length} reference account${knownHandles.length > 1 ? 's' : ''}**: ${knownHandles.slice(0, 4).map(h => '@' + h).join(', ')}${knownHandles.length > 4 ? ` + ${knownHandles.length - 4} more` : ''}. Which direction should I focus on?`,
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
        type: 'text',
      })
      store.setStatus('chatting')
      return
    }

    const intent = parsedIntent as Extract<ParsedIntent, { needsClarification?: false | null | undefined }>
    const niche = 'niche' in intent ? intent.niche : ''
    const location = 'location' in intent ? (intent.location ?? '') : ''
    const pipelineType = 'pipelineType' in intent ? (intent.pipelineType ?? 'competitor') : 'competitor'

    // ── Reel / hook analysis confirmation ───────────────────────────────────
    if (pipelineType === 'reel') {
      if (discoveredSeeds.length === 0) {
        store.addMessage({
          role: 'assistant',
          content: 'Session expired — tell me which creators to analyze to start over.',
          type: 'text',
        })
        store.setStatus('chatting')
        return
      }
      const shown = discoveredSeeds.slice(0, 4).map(h => '@' + h).join(', ')
      store.addMessage({
        role: 'assistant',
        content: `On it — breaking down reels for ${shown}${discoveredSeeds.length > 4 ? ` + ${discoveredSeeds.length - 4} more` : ''}…`,
        type: 'text',
      })
      // Reel results render inline via the reel store (activeHandles). Return chat
      // to idle so the input stays usable; the run owns its own AbortController.
      store.setStatus('chatting')
      void startReelAnalysis(discoveredSeeds)
      return
    }

    // ── Discovery pipeline confirmation ─────────────────────────────────────
    if (pipelineType === 'discovery') {
      if (selectedOption === DISCOVERY_REDIRECT_TO_COMPETITOR) {
        // User wants competitor analysis instead — scrape seeds first (never pass [] to analyze)
        const apifyKey = pickKey()
        if (!apifyKey || !geminiKey?.trim()) {
          store.addMessage({
            role: 'assistant',
            content: 'API keys missing. Check Settings and try again.',
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

  return { sendMessage, confirmSeeds: confirmSeedsWithReset, isConfirmingPending, isConfirmingLocked, isAnswering }
}
