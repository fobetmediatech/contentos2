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
import { useKeysStore } from '../store/keysStore'
import { useCompetitorAnalysis } from './useCompetitorAnalysis'
import { useLocationDiscovery } from './useLocationDiscovery'
import { parseIntent } from '../ai/intentParser'
import { generateHashtags } from '../lib/hashtagGenerator'
import { scrapeHashtagUsernames } from '../lib/apifyClient'
import { GeminiError } from '../ai/gemini'
import { ApifyError } from '../lib/apifyCore'
import { PROCEED_LABEL, DISCOVERY_REDIRECT_TO_COMPETITOR } from '../lib/constants'
import type { ParsedIntent } from '../ai/intentParser'

const DISCOVERY_TIMEOUT_MS = 90_000
const DISCOVERY_SOFT_NUDGE_MS = 60_000

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
  const { geminiKey, pickKey } = useKeysStore()
  const { analyze } = useCompetitorAnalysis()
  const { discover } = useLocationDiscovery()

  // T21: clarification turn counter — resets each mount, never stored in Zustand
  const [clarificationTurns, setClarificationTurns] = useState(0)

  // T20: AbortController ref for discovery — cleaned up on unmount
  const discoveryAbortRef = useRef<AbortController | null>(null)

  // Soft-nudge timer ref — cleared on abort or completion
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Hard-abort timeout ref — stored as ref so unmount cleanup can clear it.
  // A bare local variable inside runCompetitorDiscovery is unreachable from the
  // useEffect cleanup; storing it here guarantees it is always cancelled on unmount
  // even if the async function is mid-flight.
  const discoveryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

      // Show seeds with direction options
      store.addMessage({
        role: 'assistant',
        content: `Found ${seeds.length} accounts in the **${niche}** space${location ? ` in ${location}` : ''}. Which direction should I focus on?`,
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
        message = `Scraping error: ${err.message}. Try again or check your Apify key.`
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
   * Handle a user message in the chat input.
   * Only processes when status === 'chatting'.
   */
  const sendMessage = async (text: string) => {
    if (store.status !== 'chatting') return
    if (!text.trim()) return

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

    // Step 2: route to the correct pipeline
    const niche = 'niche' in intent ? intent.niche : ''
    const location = 'location' in intent ? (intent.location ?? '') : ''
    const pipelineType = 'pipelineType' in intent ? (intent.pipelineType ?? 'competitor') : 'competitor'

    if (pipelineType === 'discovery') {
      // Discovery pipeline: requires a city — ask if missing
      if (!location) {
        store.addMessage({
          role: 'assistant',
          content: `I can find **${niche}** creators in a specific city. Which city should I search in?`,
          timestamp: Date.now(),
          type: 'text',
        })
        store.setStatus('chatting')
        return
      }

      // Confirm before firing the 150s discovery pipeline
      store.setStatus('confirming')
      store.addMessage({
        role: 'assistant',
        content: `I'll find **${niche}** creators physically based in **${location}**. Ready to search?`,
        timestamp: Date.now(),
        type: 'options',
        options: [
          PROCEED_LABEL,
          DISCOVERY_REDIRECT_TO_COMPETITOR,
        ],
      })
      return
    }

    // Competitor pipeline (default) — scrape seeds then confirm direction
    await runCompetitorDiscovery(niche, location, geminiKey, apifyKey)
  }

  /**
   * Called when the user selects a direction option in the confirming state.
   * Routes to either the competitor analysis pipeline or location discovery pipeline.
   *
   * T3: null guard on parsedIntent — if missing, reset to chatting.
   */
  const confirmSeeds = (selectedOption: string) => {
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
      // Navigation to /discover/progress is driven by discoveryStore.status → 'running'
      // (watched in ChatPage useEffect — not mutation state)
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

  return { sendMessage, confirmSeeds }
}
