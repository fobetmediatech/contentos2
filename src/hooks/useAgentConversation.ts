/**
 * useAgentConversation — Phase 1b T8 agent loop (flag-gated replacement for useConversation).
 *
 * Turn-based loop instead of a rigid state machine:
 *   user message → callGeminiWithTools(history, AGENT_TOOLS) → runAgentTurn (decide +
 *   one repair) → dispatch the chosen tool, OR render the agent's question/answer.
 *
 * The pure decision core (runAgentTurn → decideAction → validateToolCall) is unit-tested
 * in agentTools.test.ts. This hook is the thin wiring: history assembly, dispatch to the
 * pipeline hooks, latest-wins steering, and the cross-turn clarification cap.
 *
 * Latest-wins: a new sendMessage aborts the prior turn's controller. Because T7 threaded
 * that signal into analyze/discover/startAnalysis, the abort also cancels a running scrape
 * (a genuine steer), and the superseded run returns silently (no error bubble).
 */

import { useEffect, useRef, useState } from 'react'
import { useAnalysisStore } from '../store/analysisStore'
import { useConversationsStore } from '../store/conversationsStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { useKeysStore } from '../store/keysStore'
import { useCompetitorAnalysis } from './useCompetitorAnalysis'
import { useLocationDiscovery } from './useLocationDiscovery'
import { useReelAnalysis } from './useReelAnalysis'
import { callGeminiWithTools, callGeminiContent, GeminiError } from '../ai/gemini'
import type { GeminiTurn } from '../ai/gemini'
import { AGENT_TOOLS, AGENT_SYSTEM_PROMPT, runAgentTurn, buildGeminiHistory } from '../tools/agentTools'
import type { AgentAction } from '../tools/agentTools'
import { generateHashtags } from '../lib/hashtagGenerator'
import { scrapeHashtagUsernames } from '../lib/apifyClient'
import { friendlyGemini } from '../lib/errorMessages'
import { GEMINI_KEY_MISSING_MSG } from '../lib/constants'

const HISTORY_WINDOW = 8       // turns sent to the model per call (cap context cost)
const THINKING_BUDGET = 512    // small budget so ask-vs-act reasons without big latency (6A)
const MAX_CLARIFY = 2          // cross-turn clarification cap before a forced fallback (T7/T8)
const SEED_LIMIT = 10          // competitor seeds scraped from hashtags when no handles given

export function useAgentConversation() {
  // The transcript lives in conversationsStore now; addMessage writes to the active conversation.
  const addMessage = useConversationsStore((s) => s.addMessage)
  const { geminiKey, apifyKeys, pickKey } = useKeysStore()
  const { analyze } = useCompetitorAnalysis()
  const { discover } = useLocationDiscovery()
  const { startAnalysis: startReelAnalysis } = useReelAnalysis()

  const [isThinking, setIsThinking] = useState(false)
  const thinkingRef = useRef(false) // ref mirror of isThinking, readable synchronously in sendMessage
  const clarifyTurnsRef = useRef(0)
  // ONE controller per active run. It deliberately OUTLIVES the turn: a pipeline dispatch is
  // fire-and-forget (analyze/discover return before the scrape finishes), so the controller
  // must stay live for the next message to abort the still-running scrape. That persistence
  // is what makes latest-wins a genuine steer and not just a cancel of the planning call.
  const currentRun = useRef<AbortController | null>(null)

  useEffect(() => () => currentRun.current?.abort(), [])

  // Steer cleanup: when a new message supersedes a run with work on screen, clear the
  // lingering ProgressBubble WITHOUT wiping the chat. analysisStore.reset() would also clear
  // conversationMessages, so for it we only flip status back to 'chatting'; discovery + reel
  // state live outside the chat, so a full reset there is safe.
  const stopLingeringProgress = () => {
    const a = useAnalysisStore.getState()
    if (a.status === 'running' || a.status === 'clarifying' || a.status === 'discovering') a.setStatus('chatting')
    const d = useDiscoveryStore.getState()
    if (d.status === 'running') d.reset()
    const r = useReelAnalysisStore.getState()
    if (r.activeHandles.length > 0 && r.synthesisStatus !== 'done' && r.synthesisStatus !== 'failed') r.reset()
  }

  const bot = (content: string, type: 'text' | 'error' = 'text') =>
    addMessage({ role: 'assistant', content, type })

  /**
   * Windowed Gemini history (errors + empties dropped).
   *
   * Reads LIVE state via getState(), NOT the render-time `store` snapshot. Zustand snapshots
   * don't update within the same synchronous tick, so right after `store.addMessage(userMsg)`
   * the `store` closure is one message stale — which sent EMPTY contents on the first turn
   * (Gemini 400) and made every later turn answer the PREVIOUS message. getState() always
   * reflects the message we just added. Also drop any leading model turns so `contents`
   * starts with a user turn (the API requires it).
   */
  const buildHistory = (): GeminiTurn[] => {
    const c = useConversationsStore.getState()
    return buildGeminiHistory(c.conversations[c.activeId]?.messages ?? [], HISTORY_WINDOW)
  }

  /** True when there is genuinely live work to interrupt — a turn thinking or a scrape running. */
  const isAnyPipelineRunning = (): boolean => {
    const a = useAnalysisStore.getState()
    if (a.status === 'running' || a.status === 'clarifying' || a.status === 'discovering') return true
    if (useDiscoveryStore.getState().status === 'running') return true
    const r = useReelAnalysisStore.getState()
    return r.activeHandles.length > 0 && r.synthesisStatus !== 'done' && r.synthesisStatus !== 'failed'
  }

  const agentError = (err: unknown): string =>
    err instanceof GeminiError ? friendlyGemini(err.code) : 'Something went wrong — try again.'

  const sendMessage = async (text: string) => {
    const safeText = text.replace(/[\n\r]/g, ' ').trim().slice(0, 500)
    if (!safeText) return

    // Latest-wins: always abort the previous run's controller (cancels an in-flight planning
    // call AND any scrape it dispatched via T7's shared signal). But only treat it as a STEER
    // — the cleanup + "Switched" note — when there was genuinely live work to interrupt. A
    // completed turn leaves a non-aborted controller in currentRun, so its mere presence is
    // NOT a steer; that false-positive showed "Switched" after almost every message.
    const steering = thinkingRef.current || isAnyPipelineRunning()
    currentRun.current?.abort()
    if (steering) {
      stopLingeringProgress()
      bot('Switched — picking up your new request.') // TD4 steer feedback
    }

    addMessage({ role: 'user', content: safeText, type: 'text' })

    if (!geminiKey?.trim()) {
      bot(GEMINI_KEY_MISSING_MSG, 'error')
      return
    }

    const controller = new AbortController()
    currentRun.current = controller
    thinkingRef.current = true
    setIsThinking(true)
    try {
      const history = buildHistory() // live state — includes the user message just added above
      const callModel = (h: GeminiTurn[], repairNote?: string) =>
        callGeminiWithTools(
          geminiKey,
          repairNote
            ? [...h, { role: 'user', parts: [{ text: `Your previous tool call was invalid: ${repairNote}. Call a valid tool now.` }] }]
            : h,
          AGENT_TOOLS,
          { thinkingBudget: THINKING_BUDGET, signal: controller.signal, systemInstruction: AGENT_SYSTEM_PROMPT },
        )

      const action = await runAgentTurn(history, callModel)
      if (controller.signal.aborted) return
      await performAction(action, controller.signal)
    } catch (err) {
      if (controller.signal.aborted) return
      bot(agentError(err), 'error')
    } finally {
      // Keep currentRun pointing at this controller so a fire-and-forget scrape stays
      // cancellable by the next message. Only the LATEST turn owns the thinking state — a
      // superseded turn's finally must not clear the indicator the new turn just turned on.
      if (currentRun.current === controller) {
        thinkingRef.current = false
        setIsThinking(false)
      }
    }
  }

  const performAction = async (action: AgentAction, signal: AbortSignal) => {
    switch (action.type) {
      case 'message':
        bot(action.text)
        clarifyTurnsRef.current = 0
        return

      case 'ask':
        // Cross-turn cap: after MAX_CLARIFY asks, force a fallback instead of looping.
        if (clarifyTurnsRef.current >= MAX_CLARIFY) {
          clarifyTurnsRef.current = 0
          bot("Let's just start — name a creator @handle or a specific niche and I'll run with it.")
          return
        }
        clarifyTurnsRef.current += 1
        // TD1: render tappable pills when the agent offered options; plain bubble otherwise.
        if (action.options && action.options.length > 0) {
          addMessage({ role: 'assistant', content: action.question, type: 'options', options: action.options })
        } else {
          bot(action.question)
        }
        return

      case 'answer': {
        clarifyTurnsRef.current = 0
        const reply = await callGeminiContent(geminiKey, action.message, undefined, signal)
        if (signal.aborted) return
        bot(reply)
        return
      }

      case 'dispatch':
        clarifyTurnsRef.current = 0
        await dispatchTool(action, signal)
        return
    }
  }

  const dispatchTool = async (
    action: Extract<AgentAction, { type: 'dispatch' }>,
    signal: AbortSignal,
  ) => {
    const { name, args } = action

    if (name === 'analyze_reels') {
      startReelAnalysis((args.handles as string[]) ?? [], signal)
      return
    }

    if (name === 'discover_by_location') {
      discover(
        {
          city: String(args.city ?? ''),
          niche: String(args.niche ?? ''),
          depth: (args.depth as 'standard' | 'deep') ?? 'standard',
          clientName: '',
        },
        signal,
      )
      return
    }

    // discover_competitors
    const handles = (args.knownHandles as string[]) ?? []
    const niche = String(args.niche ?? '')
    const segment = String(args.segment ?? 'all')
    const nicheContext = segment !== 'all' && niche ? `${niche} — ${segment}` : niche

    if (handles.length > 0) {
      analyze({ handles, depth: 'standard', clientName: '', nicheContext }, signal)
      return
    }

    // Niche-only: scrape seed accounts from hashtags, then rank.
    // Guard only — scrapeHashtagUsernames picks a fresh key per run from the full array.
    if (!pickKey()) {
      bot('No Apify keys available. Add one in Settings.', 'error')
      return
    }
    const { hashtags } = await generateHashtags(geminiKey, '', niche, 'standard', signal)
    const seeds = await scrapeHashtagUsernames(hashtags, apifyKeys, signal)
    if (signal.aborted) return
    if (seeds.length === 0) {
      bot(`Couldn't find accounts for "${niche}" automatically. Know any @handles I can start from?`)
      return
    }
    analyze({ handles: seeds.slice(0, SEED_LIMIT), depth: 'standard', clientName: '', nicheContext }, signal)
  }

  return { sendMessage, isThinking }
}
