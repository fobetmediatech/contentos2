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
import { useSingleReelAnalysis } from './useSingleReelAnalysis'
import { useRepurposeReel } from './useRepurposeReel'
import { useTranscriptAnalysis } from './useTranscriptAnalysis'
import { launchReelUrlRuns, launchHeavyRun } from './agentRunLaunch'
import { callGeminiWithTools, callGeminiContent, GeminiError } from '../ai/gemini'
import type { GeminiTurn } from '../ai/gemini'
import type { ContentContext } from '../ai/prompts'
import { AGENT_TOOLS, AGENT_SYSTEM_PROMPT, runAgentTurn, buildGeminiHistory } from '../tools/agentTools'
import type { AgentAction } from '../tools/agentTools'
import { generateHashtags } from '../lib/hashtagGenerator'
import { scrapeHashtagUsernames } from '../lib/apifyClient'
import { friendlyGemini } from '../lib/errorMessages'
import { MAX_INPUT_CHARS } from '../lib/constants'
import type { ChatAttachment } from '../lib/attachment'

const HISTORY_WINDOW = 8       // turns sent to the model per call (cap context cost)
const THINKING_BUDGET = 512    // small budget so ask-vs-act reasons without big latency (6A)
const MAX_CLARIFY = 2          // cross-turn clarification cap before a forced fallback (T7/T8)
const SEED_LIMIT = 10          // competitor seeds scraped from hashtags when no handles given

export function useAgentConversation() {
  // The transcript lives in conversationsStore now; addMessage writes to the active conversation.
  const addMessage = useConversationsStore((s) => s.addMessage)
  const { geminiKeys, apifyKeys } = useKeysStore()
  const { analyze, answerClarification: answerAnalysisClarification } = useCompetitorAnalysis()
  const { discover } = useLocationDiscovery()
  const { startAnalysis: startReelAnalysis } = useReelAnalysis()
  const { startSingleReel } = useSingleReelAnalysis()
  const { startRepurpose } = useRepurposeReel()
  const { startTranscript } = useTranscriptAnalysis()

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

  /**
   * Assemble research context for the content copilot from the active conversation's
   * latest result + the live reel synthesis. Returns undefined when no context exists.
   */
  const buildContentContext = (): ContentContext | undefined => {
    const convState = useConversationsStore.getState()
    const messages = convState.conversations[convState.activeId]?.messages ?? []
    const lastResult = [...messages].reverse().find((m) => m.type === 'result')
    const payload = lastResult?.result

    const ctx: ContentContext = {}

    if (payload?.kind === 'competitor') {
      const profileMap = new Map(payload.profiles.map((p) => [p.username, p]))
      ctx.researchSummary = `Found ${payload.competitors.length} competitors in ${payload.niche}.`
      ctx.accounts = payload.competitors.slice(0, 10).map((c) => {
        const p = profileMap.get(c.username)
        return { username: c.username, followers: p?.followersCount ?? 0, er: p?.engagementRate ?? 0 }
      })
    } else if (payload?.kind === 'discovery') {
      const profileMap = new Map(payload.profiles.map((p) => [p.username, p]))
      ctx.researchSummary = `Found ${payload.results.length} creators in ${payload.city}.`
      ctx.accounts = payload.results.slice(0, 10).map((r) => {
        const p = profileMap.get(r.username)
        return { username: r.username, followers: p?.followersCount ?? 0, er: p?.engagementRate ?? 0 }
      })
    }

    const synthesis = useReelAnalysisStore.getState().synthesis
    if (synthesis) {
      ctx.hookPatterns = synthesis.topPatterns.map((p) => ({ archetype: p.archetype, count: p.count }))
      ctx.replicateTips = synthesis.replicateTips
    }

    if (!ctx.researchSummary && !ctx.hookPatterns && !ctx.replicateTips) return undefined
    return ctx
  }

  const sendMessage = async (text: string, attachment?: ChatAttachment) => {
    // Keep newlines (pasted briefs are multi-line); just normalize CRLF and cap length.
    const safeText = text.replace(/\r\n/g, '\n').trim().slice(0, MAX_INPUT_CHARS)
    if (!safeText && !attachment) return

    // What the chat bubble shows: the text plus a paperclip note for the attached file.
    const displayContent = attachment
      ? safeText
        ? `${safeText}\n\n📎 ${attachment.name}`
        : `📎 ${attachment.name}`
      : safeText

    // 5.1: mid-clarification typed answer — route to the HOOK's answerClarification so the
    // user's free-text refines the ranking prompt AND Phase 2 (ranking) actually fires.
    // The STORE action only flips status→'running' + saves the answer; it never calls
    // analyzeMutation.mutate(), which left the run stuck spinning on step 4 forever.
    // Skip this shortcut when a file is attached — the clarification sub-flow can't carry
    // bytes, so route the whole thing through the main agent loop (which sees the file).
    if (safeText && !attachment && useAnalysisStore.getState().status === 'clarifying') {
      addMessage({ role: 'user', content: safeText, type: 'text' })
      answerAnalysisClarification(safeText, currentRun.current?.signal)
      return
    }

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

    addMessage({ role: 'user', content: displayContent, type: 'text' })

    const controller = new AbortController()
    currentRun.current = controller
    thinkingRef.current = true
    setIsThinking(true)
    try {
      const history = buildHistory() // live state — includes the user message just added above
      // Attach the file's bytes to the turn we just added. Ephemeral — it rides this one
      // agent turn only; the persisted history keeps just the text note built above.
      if (attachment && history.length > 0) {
        const last = history[history.length - 1]
        if (last.role === 'user') {
          last.parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } })
        }
      }
      const callModel = (h: GeminiTurn[], repairNote?: string) =>
        callGeminiWithTools(
          geminiKeys,
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
        const reply = await callGeminiContent(geminiKeys, action.message, buildContentContext(), signal)
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
      const handles = (args.handles as string[]) ?? []
      // 2.4: add marker imperatively before startReelAnalysis resets the store, so
      // React batching can't mask the 0→non-empty activeHandles edge in ChatPage's effect.
      const convId = useConversationsStore.getState().activeId
      useReelAnalysisStore.getState().setReelConversationId(convId)
      addMessage({
        role: 'assistant',
        type: 'reel',
        content: `Analyzing reels for ${handles.map((h: string) => `@${h}`).join(', ')}.`,
      })
      startReelAnalysis(handles, signal)
      return
    }

    if (name === 'analyze_single_reel') {
      const urls = (args.reelUrls as string[]) ?? []
      const convId = useConversationsStore.getState().activeId ?? ''
      launchReelUrlRuns('single-reel', urls, convId, (rid, url, sig) => void startSingleReel(rid, url, sig))
      return
    }

    if (name === 'repurpose_reel') {
      const clientHandle = args.clientHandle ? `@${String(args.clientHandle)}` : 'this client'
      addMessage({
        role: 'assistant',
        type: 'repurpose',
        content: `Repurposing this reel for ${clientHandle}…`,
      })
      startRepurpose(
        {
          sourceReelUrl: String(args.sourceReelUrl ?? ''),
          shortCode: args.shortCode ? String(args.shortCode) : undefined,
          clientHandle: args.clientHandle ? String(args.clientHandle) : undefined,
          pastedScripts: Array.isArray(args.pastedScripts) ? (args.pastedScripts as string[]) : [],
        },
        signal,
      )
      return
    }

    if (name === 'get_reel_transcript') {
      const urls = (args.reelUrls as string[]) ?? []
      const convId = useConversationsStore.getState().activeId ?? ''
      launchReelUrlRuns('transcript', urls, convId, (rid, url, sig) => void startTranscript(rid, url, sig))
      return
    }

    if (name === 'discover_by_location') {
      const city = String(args.city ?? '')
      const niche = String(args.niche ?? '')
      const convId = useConversationsStore.getState().activeId
      launchHeavyRun('discovery', [city, niche].filter(Boolean).join(' ') || 'discovery', convId, 'Finding creators…', (runSignal) => {
        discover({ city, niche, depth: (args.depth as 'standard' | 'deep') ?? 'standard', clientName: '' }, runSignal)
      })
      return
    }

    // discover_competitors
    const handles = (args.knownHandles as string[]) ?? []
    const niche = String(args.niche ?? '')
    const segment = String(args.segment ?? 'all')
    const mode = (args.mode as 'precise' | 'broad') ?? 'precise'
    const nicheContext = segment !== 'all' && niche ? `${niche} — ${segment}` : niche

    if (handles.length > 0) {
      analyze({ handles, depth: 'standard', clientName: '', nicheContext, mode }, signal)
      return
    }

    // Niche-only bootstrap: hashtag-author seeds feed the graph walk, while the knowledge + IG
    // search sources (run inside discoverCompetitors from nicheContext) carry recall. If even the
    // hashtag seeds are empty we STILL proceed when a niche is present — the speculative sources
    // can build the whole pool from the niche alone; only bail when there is genuinely nothing.
    const { hashtags } = await generateHashtags(geminiKeys, '', niche, 'standard', signal)
    const seeds = await scrapeHashtagUsernames(hashtags, apifyKeys, signal)
    if (signal.aborted) return
    if (seeds.length === 0 && !niche) {
      bot(`Couldn't find accounts for "${niche}" automatically. Know any @handles I can start from?`)
      return
    }
    analyze({ handles: seeds.slice(0, SEED_LIMIT), depth: 'standard', clientName: '', nicheContext, mode }, signal)
  }

  // 2.2: exposed so ChatPage can abort in-flight runs on conversation switch/delete,
  // preventing results from landing in the wrong conversation.
  const abort = () => {
    currentRun.current?.abort()
    stopLingeringProgress()
  }

  return { sendMessage, isThinking, abort }
}
