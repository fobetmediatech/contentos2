/**
 * useConversation — orchestrates the full conversational analysis pipeline.
 *
 * State machine (mirrors analysisStore.ts):
 *
 *   idle → chatting → discovering → confirming → running → clarifying → done
 *               ↑          │               │
 *               │ 0 seeds   │               └── analyze() fires
 *               └──────────┘
 *               ↑ needsClarification (max 1 turn)
 *               └──────────────────────
 *
 * This hook is the sole writer to analysisStore for the chatting/discovering/confirming
 * states. It composes parseIntent() + discoverSeedHandles() + useCompetitorAnalysis.analyze().
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
import { parseIntent } from '../ai/intentParser'
import { generateHashtags } from '../lib/hashtagGenerator'
import { scrapeHashtagUsernames } from '../lib/apifyClient'
import { GeminiError } from '../ai/gemini'
import { ApifyError } from '../lib/apifyCore'
import { PROCEED_LABEL } from '../lib/constants'
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

  // T21: clarification turn counter — resets each mount, never stored in Zustand
  const [clarificationTurns, setClarificationTurns] = useState(0)

  // T20: AbortController ref for discovery — cleaned up on unmount
  const discoveryAbortRef = useRef<AbortController | null>(null)

  // Soft-nudge timer ref — cleared on abort or completion
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // T20: cleanup on unmount
  useEffect(() => {
    return () => {
      discoveryAbortRef.current?.abort()
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)
    }
  }, [])

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
      store.addMessage({
        role: 'assistant',
        content: err instanceof GeminiError && err.message.includes('key')
          ? 'Add your Gemini key in Settings to get started.'
          : "Couldn't understand that — try rephrasing.",
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

    // Step 2: discover seed handles (with 90s AbortController)
    const discoveryController = new AbortController()
    discoveryAbortRef.current = discoveryController
    const discoveryTimeout = setTimeout(() => discoveryController.abort(), DISCOVERY_TIMEOUT_MS)

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
      const location = 'location' in intent ? (intent.location ?? '') : ''
      const niche = 'niche' in intent ? intent.niche : ''

      const seeds = await discoverSeedHandles(
        niche,
        location,
        geminiKey,
        apifyKey,
        discoveryController.signal,
      )

      clearTimeout(discoveryTimeout)
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)

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
      clearTimeout(discoveryTimeout)
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current)

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
    }
  }

  /**
   * Called when the user selects a direction option in the confirming state.
   * Fires the analysis pipeline via useCompetitorAnalysis.analyze().
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

    const intent = parsedIntent as Extract<ParsedIntent, { needsClarification?: false }>
    const isProceedAsIs = selectedOption === PROCEED_LABEL || selectedOption === ''
    const nicheContext = isProceedAsIs ? intent.niche : `${intent.niche} — ${selectedOption}`

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
