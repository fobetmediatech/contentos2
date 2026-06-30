/**
 * ChatPage — single-surface agentic interface.
 *
 * All pipeline states (running, clarifying, done, error) render inline in the
 * chat — no navigation to separate result pages. Results, selection, and reel
 * analysis all happen here.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Bot, ChevronDown, Send, Video } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useConversationsStore, sortConversations } from '../store/conversationsStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useKeysStore } from '../store/keysStore'
import { useAgentConversation } from '../hooks/useAgentConversation'
import { useCompetitorAnalysis } from '../hooks/useCompetitorAnalysis'
import { useActivePipeline } from '../hooks/useActivePipeline'
import { useReelAnalysis } from '../hooks/useReelAnalysis'
import { useReelAnalysisStore } from '../store/reelAnalysisStore'
import { ChatMessage, ProgressBubble, TypingIndicator } from '../components/ChatMessage'
import { useElapsedTime, formatElapsed } from '../hooks/useElapsedTime'
import { ClarificationCard } from '../components/ClarificationCard'
import { CompetitorResultMessage } from '../components/CompetitorResultMessage'
import { DiscoveryResultMessage } from '../components/DiscoveryResultMessage'
import { ChatSidebar } from '../components/ChatSidebar'
import { InlineReelResults } from '../components/InlineReelResults'
import { ReelResultMessage } from '../components/ReelResultMessage'
import { SingleReelResultMessage } from '../components/SingleReelResultMessage'
import RepurposeResultMessage from '../components/RepurposeResultMessage'
import { TranscriptResultMessage } from '../components/TranscriptResultMessage'
import { useSingleReelStore } from '../store/singleReelStore'
import { useRepurposeStore } from '../store/repurposeStore'
import { useTranscriptStore } from '../store/transcriptStore'
import { PIPELINE_REGISTRY } from '../tools/registry'
import type { NormalizedProfile } from '../lib/transformers'
import type { ChatMessage as ChatMessageData } from '../store/analysisStore'
import { useCorpusStore } from '../store/corpusStore'
import { toast } from '../lib/toast'
import { harvestCompetitors, harvestDiscovery, harvestReelContent } from '../lib/corpusHarvest'
import { buildReelResultPayload } from '../lib/reelSnapshot'
import { addShownProfiles, getShownProfiles } from '../lib/competitorCache'
import { mergeCompetitorResults } from '../components/competitorResultView'
import { alreadyCollectedMessage } from '../lib/errorMessages'
import { TARGET_PER_CATEGORY } from '../hooks/useCompetitorAnalysis'
import type { CompetitorResultPayload } from '../domain/chat'

// Tool chips shown in the empty state — one per independent tool, so all three
// are discoverable at a glance. Tapping prefills the input with a representative prompt.
const TOOL_CHIPS: { tool: string; example: string; hint: string }[] = [
  { tool: 'Find competitors', example: 'Top fitness creators like @nike.training', hint: 'See who is winning in a niche' },
  { tool: 'Discover by city', example: 'Food bloggers in Mumbai', hint: 'Find creators based in a location' },
  { tool: 'Break down hooks', example: "Analyze @garyvee's reel hooks", hint: 'Reverse-engineer viral hook patterns' },
  { tool: 'Analyze one reel', example: 'https://www.instagram.com/reel/...', hint: 'Paste a reel link for a full breakdown + transcript' },
]

// Slim a profile before it's snapshotted into a persisted result message: drop the heavy
// fields the result cards never render (bio, related handles, top hashtags) so the localStorage
// payload stays small. Keeps everything the cards show (name, followers, verified, ER, avatar).
function trimProfile(p: NormalizedProfile): NormalizedProfile {
  return { ...p, biography: '', relatedHandles: [], topHashtags: [] }
}

// Stable empty reference for an empty/missing conversation — handing a fresh [] to effect
// deps each render would re-run the scroll effect needlessly.
const EMPTY_MESSAGES: ChatMessageData[] = []

export function ChatPage() {
  // Per-field selectors so a deep-reel progress tick (unrelated field) doesn't re-render
  // the entire competitor card grid. Each selector returns a scalar or stable reference.
  const status = useAnalysisStore((s) => s.status)
  const currentStep = useAnalysisStore((s) => s.currentStep)
  const pendingDiscovery = useAnalysisStore((s) => s.pendingDiscovery)
  const competitors = useAnalysisStore((s) => s.competitors)
  const candidateProfiles = useAnalysisStore((s) => s.candidateProfiles)
  const summary = useAnalysisStore((s) => s.summary)
  const niche = useAnalysisStore((s) => s.niche)
  const stepProgressDetail = useAnalysisStore((s) => s.stepProgressDetail)
  const analysisDidExpand = useAnalysisStore((s) => s.didExpand)
  const analysisError = useAnalysisStore((s) => s.error)
  const startChat = useAnalysisStore((s) => s.startChat)
  const setStatus = useAnalysisStore((s) => s.setStatus)

  // The chat transcript lives in conversationsStore now (multi-conversation history). Select
  // only STABLE values (the raw record + active id + action fns) — never a freshly-computed
  // array, or useSyncExternalStore loops forever. Derive the list/messages in the render body.
  const conversations = useConversationsStore((s) => s.conversations)
  const activeConversationId = useConversationsStore((s) => s.activeId)
  const addMessage = useConversationsStore((s) => s.addMessage)
  const addMessageTo = useConversationsStore((s) => s.addMessageTo)
  const startNew = useConversationsStore((s) => s.startNew)
  const switchConversation = useConversationsStore((s) => s.switchTo)
  const deleteConversation = useConversationsStore((s) => s.deleteConversation)
  // Keep the `conversationMessages` name so the rest of this component is unchanged.
  const conversationMessages = conversations[activeConversationId]?.messages ?? EMPTY_MESSAGES
  const conversationList = useMemo(() => sortConversations(conversations), [conversations])

  // 2.1: runConversationId — the conversation each pipeline run belongs to, so results
  // and errors land in the right chat even when the user switches mid-run.
  const competitorRunConversationId = useAnalysisStore((s) => s.runConversationId)
  const discoveryRunConversationId = useDiscoveryStore((s) => s.runConversationId)

  const discoveryStatus = useDiscoveryStore((s) => s.status)
  const discoveryError = useDiscoveryStore((s) => s.error)
  const discoveryDidExpand = useDiscoveryStore((s) => s.didExpand)
  const discoveryCity = useDiscoveryStore((s) => s.params?.city ?? '')
  const discoveryResults = useDiscoveryStore((s) => s.results)
  const discoveryProfiles = useDiscoveryStore((s) => s.candidateProfiles)
  const discoveryLocationRelaxed = useDiscoveryStore((s) => s.locationFilterRelaxed)
  const discoveryNiche = useDiscoveryStore((s) => s.niche)
  const resetDiscovery = useDiscoveryStore((s) => s.reset)
  const activePipeline = useActivePipeline()

  const { isReady: _isReady } = useKeysStore()
  // Phase 1 graduated: the turn-based agent loop is THE conversation engine (the old
  // useConversation wizard is retired). Input stays live; a new message steers (latest-wins).
  const agentConv = useAgentConversation()
  const { analyze, answerClarification, isPending: clarificationPending } = useCompetitorAnalysis()
  const { startAnalysis: startReelAnalysis, activeHandles, creatorStates, synthesisStatus, synthesis, synthesisError, reset: resetReel } = useReelAnalysis()
  // Which conversation the current reel run belongs to — gates the live block to that chat and
  // routes its snapshot there on supersede (results-as-messages parity with competitor/discovery).
  const reelConversationId = useReelAnalysisStore((s) => s.reelConversationId)
  const setReelConversationId = useReelAnalysisStore((s) => s.setReelConversationId)
  // Which conversation the current single-reel run belongs to — gates its live block to that
  // chat (mirrors reelConversationId; the single-reel store calls this field `conversationId`).
  const singleReelConversationId = useSingleReelStore((s) => s.conversationId)
  // Repurpose run state — drives the live progress marker; the finished result is snapshotted
  // into the conversation (kind 'repurpose') by the effect below, then the store is reset.
  const repurposeStatus = useRepurposeStore((s) => s.status)
  const repurposeConversationId = useRepurposeStore((s) => s.conversationId)
  const repurposeError = useRepurposeStore((s) => s.error)
  const resetRepurpose = useRepurposeStore((s) => s.reset)
  // Which conversation the current transcript run belongs to — independent from single-reel.
  const transcriptConversationId = useTranscriptStore((s) => s.conversationId)
  const transcriptStatus = useTranscriptStore((s) => s.status)
  const resetTranscript = useTranscriptStore((s) => s.reset)

  const [inputText, setInputText] = useState('')
  const [isNearBottom, setIsNearBottom] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const analysisErrorHandledRef = useRef(false)
  const competitorResultArmedRef = useRef(false) // armed while a competitor run is live; fires once on done
  // Initialize from the (possibly persisted) reel state: if a finished reel run was restored
  // on reload, activeHandles is already non-empty, so seed the ref true — otherwise the marker
  // effect would see a 0→active edge and append a SECOND reel marker below the restored one.
  const reelActiveRef = useRef(activeHandles.length > 0)
  const discoveryResultArmedRef = useRef(false) // armed while a discovery run is live; fires once on done
  const reelContentArmedRef = useRef(false) // armed while a reel run is live; harvests content once on synthesis done
  const repurposeArmedRef = useRef(false) // armed while a repurpose run is live; snapshots once on done
  const transcriptArmedRef = useRef(false) // armed while a transcript run is live; snapshots once on done

  // Selection state — shared across competitor + discovery results
  const [selectedHandles, setSelectedHandles] = useState<string[]>([])

  // Phase 1: keys are server-side — isReady() always returns true; the !ready banner is removed.
  // Kept as a local const to avoid touching canSend / disabled props throughout.
  const ready = _isReady()
  // Reel run state (derived from the reel store). A run is "running" until synthesis
  // reaches a terminal state; "done" once synthesis succeeds or fails.
  const isReelDone = activeHandles.length > 0 && (synthesisStatus === 'done' || synthesisStatus === 'failed')
  const canSend = ready && inputText.trim().length > 0

  // On mount: the active conversation is restored by conversationsStore. analysisStore isn't
  // persisted, so its status is 'idle' on reload — make it live. (A dead transient from a
  // mid-run that can't resume is likewise dropped to 'chatting'.)
  useEffect(() => {
    if (status !== 'chatting' && status !== 'done') setStatus('chatting')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (discoveryStatus === 'done') {
      resetDiscovery()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Analysis error → surface as chat message in the conversation the run started in (2.1).
  useEffect(() => {
    if (status === 'error' && analysisError && !analysisErrorHandledRef.current) {
      analysisErrorHandledRef.current = true
      addMessageTo(competitorRunConversationId ?? activeConversationId, { role: 'assistant', content: analysisError, timestamp: Date.now(), type: 'error' })
      setStatus('chatting')
    }
    if (status !== 'error') {
      analysisErrorHandledRef.current = false
    }
  }, [status, analysisError, addMessageTo, competitorRunConversationId, activeConversationId, setStatus])

  // Discovery error → surface as chat message in the conversation the run started in (2.1).
  useEffect(() => {
    if (discoveryStatus === 'error') {
      const errMsg = discoveryError ?? 'Discovery failed — please try again.'
      addMessageTo(discoveryRunConversationId ?? activeConversationId, { role: 'assistant', content: errMsg, type: 'error' })
      setStatus('chatting')
      resetDiscovery()
    }
  }, [discoveryStatus, discoveryError, addMessageTo, discoveryRunConversationId, activeConversationId, setStatus, resetDiscovery])

  // Results-as-messages (Phase 2): when a competitor run finishes, SNAPSHOT it into the
  // conversation as a `type:'result'` message (persists + interleaves), then flip status back
  // to 'chatting'. Armed only while a real run is live (running/clarifying) so it fires exactly
  // once per run and never on a stale/restored status. Profiles are trimmed to the ranked
  // competitors to keep the persisted payload small.
  useEffect(() => {
    if (status === 'running' || status === 'clarifying') {
      competitorResultArmedRef.current = true
    } else if (status === 'done' && competitorResultArmedRef.current) {
      competitorResultArmedRef.current = false
      const convId = competitorRunConversationId ?? activeConversationId
      const handles = new Set(competitors.map((c) => c.username))
      // Match against candidateProfiles (the scraped competitors), NOT inputProfiles (the user's
      // reference accounts) — the ranked competitors live in the candidate set, so this is what
      // gives cards their metrics and feeds the corpus real creators.
      const matched = candidateProfiles.filter((p) => handles.has(p.username))

      // Carry forward previously-shown RELEVANT (non-thumbs-downed) accounts so each run renders the
      // full accumulated set (carried + new) together. Read the latest prior competitor result in
      // this conversation; on a first run there is none, so carried is empty (just the new results).
      const corpus = useCorpusStore.getState().creators
      const priorMsgs = useConversationsStore.getState().conversations[convId]?.messages ?? []
      const prior = [...priorMsgs]
        .reverse()
        .find((m) => m.type === 'result' && m.result?.kind === 'competitor')?.result as
        | CompetitorResultPayload
        | undefined
      const carriedComp = (prior?.competitors ?? []).filter((c) => corpus[c.username]?.feedback !== 'dismissed')
      const carriedProfiles = (prior?.profiles ?? []).filter((p) => corpus[p.username]?.feedback !== 'dismissed')

      // Merge + re-rank the whole set (fresh wins on dups); merge profiles (fresh wins).
      const mergedComp = mergeCompetitorResults(carriedComp, competitors)
      const profMap = new Map<string, NormalizedProfile>()
      for (const p of carriedProfiles) profMap.set(p.username, p)
      for (const p of matched.map(trimProfile)) profMap.set(p.username, p)
      const mergedProfiles = [...profMap.values()]

      // 2.1: route to the conversation the run started in, not the currently-active one.
      addMessageTo(convId, {
        role: 'assistant',
        type: 'result',
        content: `Found ${mergedComp.length} competitor${mergedComp.length !== 1 ? 's' : ''}${niche ? ` in ${niche}` : ''}.`,
        result: {
          kind: 'competitor',
          competitors: mergedComp,
          summary,
          niche: niche || prior?.niche || '',
          profiles: mergedProfiles,
          didExpand: analysisDidExpand,
          // Re-run context for "Start over": same handles + reused clarification answer.
          handles: useAnalysisStore.getState().params?.handles ?? prior?.handles ?? [],
          nicheContext: useAnalysisStore.getState().params?.nicheContext ?? prior?.nicheContext ?? '',
          clarificationAnswer: useAnalysisStore.getState().clarificationAnswer ?? prior?.clarificationAnswer ?? '',
        },
      })
      // Write shown profiles (username → category) to the per-conversation cache so a rerun
      // excludes them and tracks per-category relevant counts. Fire-and-forget, best-effort.
      void addShownProfiles(
        convId,
        useAnalysisStore.getState().params?.handles ?? [],
        competitors.map((c) => ({ username: c.username, category: c.category })),
      ).catch(() => {})
      // Remember these creators in the cross-search corpus (untrimmed, so topHashtags
      // survive as signal). Fire-and-forget — a corpus write never blocks the chat.
      void useCorpusStore
        .getState()
        .remember(harvestCompetitors(competitors, matched, niche, Date.now()))
        .catch(() => {})
      setStatus('chatting')
    }
  }, [status, competitors, summary, niche, candidateProfiles, analysisDidExpand, addMessageTo, competitorRunConversationId, activeConversationId, setStatus])

  // 2.4: Reset reelActiveRef when a run ends so the next run can add its marker.
  // The marker itself is now added imperatively in handleAnalyzeReels / dispatchTool
  // to avoid React batching masking the 0→non-empty activeHandles edge on back-to-back runs.
  useEffect(() => {
    if (activeHandles.length === 0) {
      reelActiveRef.current = false
    }
  }, [activeHandles])

  // Results-as-messages (stage 2): snapshot a finished DISCOVERY run into the conversation as
  // a `type:'result'` message, then reset the discovery store. Armed only while a real run is
  // live so it fires once. Profiles trimmed to the ranked creators to keep the payload small.
  useEffect(() => {
    if (discoveryStatus === 'running') {
      discoveryResultArmedRef.current = true
    } else if (discoveryStatus === 'done' && discoveryResultArmedRef.current) {
      discoveryResultArmedRef.current = false
      const handles = new Set(discoveryResults.map((r) => r.username))
      const matched = discoveryProfiles.filter((p) => handles.has(p.username))
      // 2.1: route to the conversation the run started in, not the currently-active one.
      addMessageTo(discoveryRunConversationId ?? activeConversationId, {
        role: 'assistant',
        type: 'result',
        content: `Found ${discoveryResults.length} creator${discoveryResults.length !== 1 ? 's' : ''}${discoveryCity ? ` in ${discoveryCity}` : ''}.`,
        result: {
          kind: 'discovery',
          results: discoveryResults,
          city: discoveryCity,
          profiles: matched.map(trimProfile),
          didExpand: discoveryDidExpand,
          locationRelaxed: discoveryLocationRelaxed,
        },
      })
      // Remember these creators in the cross-search corpus (untrimmed for signal).
      void useCorpusStore
        .getState()
        .remember(harvestDiscovery(discoveryResults, matched, discoveryCity, discoveryNiche, Date.now()))
        .catch(() => {})
      resetDiscovery()
    }
  }, [discoveryStatus, discoveryResults, discoveryCity, discoveryNiche, discoveryProfiles, discoveryDidExpand, discoveryLocationRelaxed, addMessageTo, discoveryRunConversationId, activeConversationId, resetDiscovery])

  // Snapshot a finished repurpose run into the conversation, then reset the store. Armed only
  // while a real run is live so it fires once. The persisted payload carries everything the
  // result card needs, so it survives reload independent of the (reset) transient store.
  useEffect(() => {
    const running = repurposeStatus === 'building-profile' || repurposeStatus === 'analyzing-source' || repurposeStatus === 'rewriting'
    if (running) {
      repurposeArmedRef.current = true
    } else if (repurposeStatus === 'done' && repurposeArmedRef.current) {
      repurposeArmedRef.current = false
      const s = useRepurposeStore.getState()
      if (s.conversationId && s.voiceProfile && s.rewrite) {
        addMessageTo(s.conversationId, {
          role: 'assistant',
          type: 'result',
          content: `Repurposed in @${s.voiceProfile.handle.replace('__scripts__', 'pasted ')}'s voice.`,
          result: {
            kind: 'repurpose',
            sourceReelUrl: s.sourceReelUrl,
            clientHandle: s.clientHandle,
            voiceProfile: s.voiceProfile,
            rewrite: s.rewrite,
            sourceTranscript: s.sourceTranscript,
          },
        })
      }
      resetRepurpose()
    } else if (repurposeStatus === 'error' && repurposeArmedRef.current) {
      repurposeArmedRef.current = false
      const s = useRepurposeStore.getState()
      addMessageTo(s.conversationId ?? activeConversationId, {
        role: 'assistant',
        type: 'error',
        content: s.error || 'Could not repurpose this reel.',
      })
      resetRepurpose()
    }
  }, [repurposeStatus, addMessageTo, activeConversationId, resetRepurpose])

  // Snapshot a finished transcript run into the conversation, then reset the store.
  // Armed only while a real run is live so it fires once per run.
  useEffect(() => {
    if (transcriptStatus === 'running') {
      transcriptArmedRef.current = true
    } else if (transcriptStatus === 'done' && transcriptArmedRef.current) {
      transcriptArmedRef.current = false
      const s = useTranscriptStore.getState()
      if (s.conversationId && s.result) {
        addMessageTo(s.conversationId, {
          role: 'assistant',
          type: 'result',
          content: 'Transcript ready.',
          result: {
            kind: 'transcript',
            reelUrl: s.reelUrl ?? '',
            transcript: s.result.transcript,
            segments: s.result.segments,
          },
        })
      }
      resetTranscript()
    } else if (transcriptStatus === 'failed' && transcriptArmedRef.current) {
      transcriptArmedRef.current = false
      const s = useTranscriptStore.getState()
      addMessageTo(s.conversationId ?? activeConversationId, {
        role: 'assistant',
        type: 'error',
        content: s.error || 'Could not transcribe that reel.',
      })
      resetTranscript()
    }
  }, [transcriptStatus, addMessageTo, activeConversationId, resetTranscript])

  // Reel → corpus content: when a reel run's synthesis finishes, harvest each analyzed reel
  // into the corpus as content tied to its creator (the "content" half of the corpus). Armed
  // while the run is live so it fires exactly once — and NOT on reload, where the reel store
  // restores with synthesisStatus 'done' but the ref starts false (the content was already
  // harvested during the original run).
  useEffect(() => {
    if (synthesisStatus === 'running') {
      reelContentArmedRef.current = true
    } else if (synthesisStatus === 'done' && reelContentArmedRef.current) {
      reelContentArmedRef.current = false
      void useCorpusStore.getState().rememberContent(harvestReelContent(creatorStates, Date.now())).catch(() => {})
    }
  }, [synthesisStatus, creatorStates])

  // Scroll to bottom when content changes, but only when the user is near the bottom.
  // When they've scrolled up to read history, auto-scroll would yank them away.
  useEffect(() => {
    if (isNearBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [conversationMessages, status, discoveryStatus, currentStep, activePipeline.step, activeHandles, creatorStates, synthesisStatus, isNearBottom])

  const handleScrollContainer = () => {
    const el = scrollContainerRef.current
    if (!el) return
    setIsNearBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 120)
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    setIsNearBottom(true)
  }

  const resetTextareaHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleSend = async () => {
    if (!canSend) return
    const text = inputText.trim()
    setInputText('')
    resetTextareaHeight()
    await agentConv.sendMessage(text)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  // Reset the transient analysis state (results live in the conversation's messages, so this
  // just clears the live status/selection without touching history).
  const freshenAnalysis = () => {
    startChat()
    resetDiscovery()
    setSelectedHandles([])
  }

  // Snapshot the CURRENT (finished) reel run into the conversation it ran in, BEFORE a new run
  // resets the global store. Reads the live store (getState) so it's accurate at call time.
  // Guard: only a terminal run with a known home conversation snapshots — an in-flight or
  // never-started run is skipped (interrupted runs are intentionally dropped).
  const snapshotCurrentReelRun = () => {
    const s = useReelAnalysisStore.getState()
    const terminal =
      s.synthesisStatus === 'done' || s.synthesisStatus === 'failed'
    if (!s.reelConversationId || s.activeHandles.length === 0 || !terminal) return
    addMessageTo(s.reelConversationId, {
      role: 'assistant',
      type: 'result',
      content: `Reel breakdown for ${s.activeHandles.map((h) => `@${h}`).join(', ')}.`,
      result: buildReelResultPayload({
        handles: s.activeHandles,
        creatorStates: s.creatorStates,
        synthesis: s.synthesis,
      }),
    })
  }

  const handleStartOver = () => {
    snapshotCurrentReelRun() // preserve the finished run in its conversation before reset wipes it
    resetReel()
    startNew() // a fresh conversation — the finished one stays in history (switchable)
    freshenAnalysis()
  }

  // Competitor "Start over": re-run the SAME handles in the SAME conversation to fill the gap
  // toward 5 relevant (non-thumbs-downed) per category, reusing the first run's
  // clarification answer silently. Legacy payloads (no handles) fall back to the blank reset.
  const handleCompetitorStartOver = async (payload: CompetitorResultPayload) => {
    const handles = payload.handles ?? []
    if (handles.length === 0) {
      handleStartOver()
      return
    }
    const convId = activeConversationId
    // Pre-scrape stop: BOTH categories already full? Friendly message instead of a 60s re-scrape.
    const shownMap = await getShownProfiles(convId, handles)
    const dismissed = new Set(
      Object.values(useCorpusStore.getState().creators)
        .filter((c) => c.feedback === 'dismissed')
        .map((c) => c.username.toLowerCase()),
    )
    const relTop = Object.entries(shownMap).filter(([u, cat]) => cat === 'top' && !dismissed.has(u)).length
    const relTrend = Object.entries(shownMap).filter(([u, cat]) => cat === 'trending' && !dismissed.has(u)).length
    if (relTop >= TARGET_PER_CATEGORY && relTrend >= TARGET_PER_CATEGORY) {
      addMessageTo(convId, { role: 'assistant', content: alreadyCollectedMessage(TARGET_PER_CATEGORY * 2), type: 'text' })
      return
    }
    // No startNew() → same conversation → same cache key → the shown-set keeps accumulating.
    analyze(
      { handles, depth: 'standard', clientName: '', nicheContext: payload.nicheContext ?? '' },
      undefined,
      payload.clarificationAnswer ?? '',
    )
  }

  const handleSwitchConversation = (id: string) => {
    // 2.2: abort any in-flight run so it doesn't complete and write results into the new conversation.
    agentConv.abort()
    switchConversation(id)
    freshenAnalysis()
  }

  const handleDeleteConversation = (id: string) => {
    agentConv.abort()
    deleteConversation(id)
    freshenAnalysis()
  }

  const handleToggleSelect = (handle: string) => {
    setSelectedHandles((prev) => {
      if (prev.includes(handle)) return prev.filter((h) => h !== handle)
      if (prev.length >= 5) {
        toast('Select up to 5 creators at a time')
        return prev
      }
      return [...prev, handle]
    })
  }

  const handleAnalyzeReels = () => {
    const handles = [...selectedHandles]
    setSelectedHandles([])
    snapshotCurrentReelRun() // if a finished reel run is on screen, preserve it before this supersedes it
    // 2.4: set conversation binding + add marker BEFORE startReelAnalysis resets the store,
    // so back-to-back runs each get their own marker regardless of React batching.
    reelActiveRef.current = true
    setReelConversationId(activeConversationId)
    addMessage({
      role: 'assistant',
      type: 'reel',
      content: `Analyzing reels for ${handles.map((h) => `@${h}`).join(', ')}.`,
    })
    startReelAnalysis(handles)  // sets activeHandles in the reel store
  }

  // Pipeline-targeted retry: re-fire the reel pipeline for the SAME handles directly (no agent
  // loop / re-routing), reusing the existing reel marker. Used by the failed-state Retry button.
  const handleRetryReels = () => {
    const handles = [...activeHandles]
    if (handles.length === 0) return
    setReelConversationId(activeConversationId) // re-bind in case the store reset cleared it
    startReelAnalysis(handles)
  }

  // Derived booleans
  const hasMessages = conversationMessages.length > 0
  // Only the most recent reel marker renders the live block (the store holds one run); older
  // markers no-op. Empty when no reel run has started this session.
  const lastReelMarkerId = [...conversationMessages].reverse().find((m) => m.type === 'reel')?.id
  // Same one-live-run rule for single-reel: only the latest marker in the owning conversation
  // renders the live block — older/cross-conversation markers no-op (prevents ghost renders).
  const lastSingleReelMarkerId = [...conversationMessages].reverse().find((m) => m.type === 'single-reel')?.id
  // Same one-live-run rule for repurpose: only the latest marker in the owning conversation
  // renders the live progress block — older / cross-conversation markers no-op.
  const lastRepurposeMarkerId = [...conversationMessages].reverse().find((m) => m.type === 'repurpose')?.id
  // Same one-live-run rule for transcript: only the latest marker in the owning conversation renders.
  const lastTranscriptMarkerId = [...conversationMessages].reverse().find((m) => m.type === 'transcript')?.id
  const isAnalysisRunning = status === 'running'
  const isAnalysisClarifying = status === 'clarifying'
  const isAnalysisDone = status === 'done'
  const isDiscoveryRunning = activePipeline.activePipelineId === 'discovery' && activePipeline.isRunning
  const isDiscoveryDone = activePipeline.activePipelineId === 'discovery' && activePipeline.isDone
  const showInlineContent = isAnalysisRunning || isAnalysisClarifying || isAnalysisDone ||
    isDiscoveryRunning || isDiscoveryDone
  const isReelRunning = activeHandles.length > 0 && synthesisStatus !== 'done' && synthesisStatus !== 'failed'
  // Live elapsed timers — the honest "how long has this been running" signal for each pipeline.
  const analysisElapsed = useElapsedTime(isAnalysisRunning)
  const discoveryElapsed = useElapsedTime(isDiscoveryRunning)
  const reelElapsed = useElapsedTime(isReelRunning)

  // When the pipeline pauses for a clarification, pull the card into view even if the user
  // scrolled up — otherwise the run silently stalls awaiting an answer they can't see.
  // (scrollIntoView fires scroll events that refresh isNearBottom via the onScroll handler.)
  useEffect(() => {
    if (isAnalysisClarifying) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [isAnalysisClarifying])
  const showRunPlaceholder = agentConv.isThinking || isAnalysisRunning || isDiscoveryRunning || isReelRunning
  const lastUserMessage = useMemo(
    () => [...conversationMessages].reverse().find((m) => m.role === 'user')?.content,
    [conversationMessages],
  )

  // (Competitor + discovery card derivations now live in their result-message components,
  // computed from the snapshotted payload.)

  return (
    <div className="h-full flex flex-row bg-chai">
      <ChatSidebar
        conversations={conversationList}
        activeId={activeConversationId}
        onSwitch={handleSwitchConversation}
        onNew={handleStartOver}
        onDelete={handleDeleteConversation}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      {/* ── Message area ──────────────────────────────────────────────── */}
      {!isNearBottom && (
        <button
          onClick={scrollToBottom}
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors shadow-lg ${
            isAnalysisClarifying
              ? 'bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] animate-pulse'
              : 'bg-[var(--color-surface)] border border-[rgba(var(--accent-rgb),0.40)] text-[var(--color-accent)] hover:bg-[var(--color-surface-raised)]'
          }`}
        >
          <ChevronDown size={12} />
          {isAnalysisClarifying ? 'Action needed — choose a direction' : 'Jump to latest'}
        </button>
      )}
      <div ref={scrollContainerRef} onScroll={handleScrollContainer} className="flex-1 overflow-y-auto">
        {!hasMessages && !showInlineContent ? (
          // Welcome / empty state
          <div className="h-full flex flex-col items-center justify-center px-6 py-12">
            <div className="w-12 h-12 rounded-full bg-[rgba(var(--accent-rgb),0.12)] flex items-center justify-center mb-4">
              <Bot size={22} className="text-[var(--color-accent)]" />
            </div>
            <h2 className="font-serif italic text-2xl text-primary mb-1.5 tracking-tight">
              What do you want to research?
            </h2>
            <p className="text-sm text-secondary text-center max-w-sm leading-relaxed">
              Three tools, one chat — find competitors, discover creators by city, or break down what makes reels go viral. Just describe it.
            </p>
            <div className="mt-6 flex flex-col gap-2 w-full max-w-sm">
              {TOOL_CHIPS.map(({ tool, example, hint }) => (
                <button
                  key={tool}
                  onClick={() => {
                    if (!ready) return
                    setInputText(example)
                    textareaRef.current?.focus()
                  }}
                  disabled={!ready}
                  className="group px-3.5 py-2.5 text-left bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-xl hover:border-[var(--color-accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="block text-xs font-semibold text-[var(--color-accent-light)] mb-0.5">{tool}</span>
                  <span className="block text-sm text-secondary group-hover:text-primary transition-colors">"{example}"</span>
                  <span className="block text-[11px] text-muted mt-0.5">{hint}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          // DESIGN.md: chat is a centered, max-width column (not full-bleed) — this is what
          // makes it read as a focused conversation instead of a sprawling dashboard.
          <div className="px-4 pt-4 pb-6 max-w-4xl mx-auto w-full">
            <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-4">

              {/* Conversation messages */}
              {conversationMessages.map((message) =>
                message.type === 'result' && message.result?.kind === 'competitor' ? (
                  // Results-as-messages: a finished competitor run renders inline, in place,
                  // and survives reload (the payload is persisted in conversationMessages).
                  <CompetitorResultMessage
                    key={message.id}
                    payload={message.result}
                    selectedHandles={selectedHandles}
                    onToggleSelect={handleToggleSelect}
                    onClearSelection={() => setSelectedHandles([])}
                    onAnalyzeReels={handleAnalyzeReels}
                    onStartOver={() => void handleCompetitorStartOver(message.result as CompetitorResultPayload)}
                    reelActive={isReelRunning}
                  />
                ) : message.type === 'result' && message.result?.kind === 'discovery' ? (
                  <DiscoveryResultMessage
                    key={message.id}
                    payload={message.result}
                    selectedHandles={selectedHandles}
                    onToggleSelect={handleToggleSelect}
                    onClearSelection={() => setSelectedHandles([])}
                    onAnalyzeReels={handleAnalyzeReels}
                    onStartOver={handleStartOver}
                    reelActive={isReelRunning}
                  />
                ) : message.type === 'result' && message.result?.kind === 'reel' ? (
                  // A superseded/finished reel run, snapshotted into this conversation. Renders
                  // statically from the payload — immune to the live store moving on.
                  <ReelResultMessage
                    key={message.id}
                    payload={message.result}
                    onSuggest={(text) => {
                      setInputText(text)
                      textareaRef.current?.focus()
                    }}
                    onStartOver={handleStartOver}
                  />
                ) : message.type === 'result' && message.result?.kind === 'repurpose' ? (
                  // A finished repurpose run, snapshotted into this conversation. Renders
                  // statically from the persisted payload — survives reload.
                  <RepurposeResultMessage key={message.id} payload={message.result} />
                ) : message.type === 'result' && message.result?.kind === 'transcript' ? (
                  // A finished transcript run, snapshotted into this conversation. Renders
                  // statically from the persisted payload — survives new runs and reload.
                  <TranscriptResultMessage key={message.id} payload={message.result} />
                ) : message.type === 'reel' ? (
                  // Reel block renders in place at the LATEST reel marker (the store holds one
                  // live run). Older markers + a restored marker with no live run no-op.
                  message.id === lastReelMarkerId && activeHandles.length > 0 && reelConversationId === activeConversationId ? (
                    <Fragment key={message.id}>
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(var(--ai-rgb),0.12)] flex items-center justify-center mt-0.5">
                          <Video size={14} className="text-[var(--color-ai-tint)]" />
                        </div>
                        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(var(--border-rgb),0.08)] text-sm leading-relaxed max-w-[80%]">
                          <span className="font-semibold text-primary">Analyzing reels</span>
                          <p className="text-secondary mt-0.5">
                            Scraping and analyzing reels for {activeHandles.map((h) => `@${h}`).join(', ')}.
                          </p>
                          <p className="text-xs font-mono text-muted mt-1 tabular-nums">
                            {formatElapsed(reelElapsed)} elapsed · usually {activeHandles.length * 2}–{activeHandles.length * 4} min
                            {reelElapsed > activeHandles.length * 240 ? ' (taking longer than usual — hang tight)' : ''}
                          </p>
                        </div>
                      </div>

                      <InlineReelResults
                        handles={activeHandles}
                        creatorStates={creatorStates}
                        synthesisStatus={synthesisStatus}
                        synthesis={synthesis}
                        synthesisError={synthesisError}
                        onSuggest={(text) => {
                          setInputText(text)
                          textareaRef.current?.focus()
                        }}
                      />

                      {isReelDone && (
                        <div className="self-start flex items-center gap-2">
                          {synthesisStatus === 'failed' && (
                            <button
                              onClick={handleRetryReels}
                              className="px-4 py-2 text-sm font-semibold text-white bg-[var(--color-accent)] rounded-xl hover:bg-[var(--color-accent-hover)] transition-colors"
                            >
                              Retry analysis
                            </button>
                          )}
                          <button
                            onClick={handleStartOver}
                            className="px-4 py-2 text-sm text-secondary border border-[rgba(var(--border-rgb),0.10)] rounded-xl hover:bg-surface-raised transition-colors"
                          >
                            Start over
                          </button>
                        </div>
                      )}
                    </Fragment>
                  ) : null
                ) : message.type === 'single-reel' ? (
                  // Single-reel case study renders inline from the live single-reel store
                  // (one active run at a time — the component reads the store directly). Only the
                  // LATEST marker in the owning conversation renders; older / cross-conversation
                  // markers no-op (mirrors the reel branch's last-marker + same-conversation guard).
                  message.id === lastSingleReelMarkerId && singleReelConversationId === activeConversationId ? (
                    <div key={message.id} className="my-2">
                      <SingleReelResultMessage />
                    </div>
                  ) : null
                ) : message.type === 'repurpose' ? (
                  // Repurpose progress renders in place at the LATEST repurpose marker in the
                  // owning conversation while the run is live; older / cross-conversation markers
                  // no-op (mirrors the single-reel branch's last-marker + same-conversation guard).
                  message.id === lastRepurposeMarkerId
                  && repurposeConversationId === activeConversationId
                  && (repurposeStatus === 'building-profile' || repurposeStatus === 'analyzing-source' || repurposeStatus === 'rewriting' || repurposeStatus === 'error') ? (
                    <div key={message.id} className="my-2 text-sm text-muted flex items-center gap-2">
                      {repurposeStatus === 'error' ? (
                        <span className="text-[var(--color-accent)]">{repurposeError || 'Could not repurpose this reel.'}</span>
                      ) : (
                        <>
                          <span className="inline-block w-3 h-3 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin" />
                          <span>
                            {repurposeStatus === 'building-profile' && PIPELINE_REGISTRY.repurpose.steps[0]}
                            {repurposeStatus === 'analyzing-source' && PIPELINE_REGISTRY.repurpose.steps[1]}
                            {repurposeStatus === 'rewriting' && PIPELINE_REGISTRY.repurpose.steps[2]}
                            …
                          </span>
                        </>
                      )}
                    </div>
                  ) : null
                ) : message.type === 'transcript' ? (
                  // Transcript-only view — independent store + API (/api/get-transcript).
                  // Only the latest marker in the owning conversation renders.
                  message.id === lastTranscriptMarkerId && transcriptConversationId === activeConversationId ? (
                    <div key={message.id} className="my-2">
                      <TranscriptResultMessage />
                    </div>
                  ) : null
                ) : (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    // A clarification pill is just the user's next message (TD1).
                    onOptionSelect={agentConv.sendMessage}
                    optionsDisabled={agentConv.isThinking}
                    onRetry={message.type === 'error' && lastUserMessage ? () => agentConv.sendMessage(lastUserMessage) : undefined}
                  />
                ),
              )}

              {/* Typing indicators */}
              {agentConv.isThinking && <TypingIndicator />}

              {/* ── Competitor analysis progress ──────────────────────── */}
              {(isAnalysisRunning || isAnalysisClarifying) && (
                <>
                  <ProgressBubble
                    currentStep={isAnalysisClarifying ? 5 : currentStep}
                    label={
                      isAnalysisClarifying
                        ? 'Waiting for your answer below.'
                        : stepProgressDetail
                        ? `${stepProgressDetail}…`
                        : 'Analyzing competitors — this takes up to 2 minutes…'
                    }
                    onStop={isAnalysisRunning ? agentConv.abort : undefined}
                    elapsedSec={isAnalysisRunning ? analysisElapsed : undefined}
                  />
                  {isAnalysisClarifying && pendingDiscovery && (
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(var(--accent-rgb),0.12)] flex items-center justify-center mt-0.5">
                        <Bot size={14} className="text-[var(--color-accent)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <ClarificationCard
                          question={pendingDiscovery.clarificationQuestion}
                          candidateCount={pendingDiscovery.candidateProfiles.length}
                          onAnswer={answerClarification}
                          disabled={clarificationPending}
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Location discovery progress ───────────────────────── */}
              {isDiscoveryRunning && (
                <ProgressBubble
                  currentStep={activePipeline.step}
                  steps={activePipeline.stepLabels}
                  label={activePipeline.progressLabel ?? undefined}
                  onStop={agentConv.abort}
                  elapsedSec={discoveryElapsed}
                />
              )}

              {/* Competitor results now render inline as a type:'result' message (Phase 2). */}

              {/* Discovery results now render inline as a type:'result' message (Phase 2 stage 2). */}

              {/* Reel analysis now renders in place at its `type:'reel'` marker (above). */}

            </div>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-surface border-t border-[rgba(var(--border-rgb),0.08)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* Centered to the same max-width as the conversation column above. */}
        <div className="flex items-end gap-2 max-w-4xl mx-auto w-full">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleTextareaInput}
              placeholder={showRunPlaceholder ? 'Ask a follow-up — or type new instructions to redirect (this stops the current run)' : 'Describe a niche, location, or paste handles…'}
              maxLength={500}
              rows={1}
              disabled={!ready}
              aria-label="Message input"
              className="w-full px-3 py-2.5 text-sm bg-[var(--color-bg)] text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] resize-none disabled:opacity-40 disabled:cursor-not-allowed leading-relaxed placeholder:text-muted"
            />
            {inputText.length >= 400 && (
              <span
                className={`absolute bottom-2.5 right-2.5 text-[10px] font-mono tabular-nums ${
                  inputText.length >= 480 ? 'text-danger' : 'text-muted'
                }`}
              >
                {inputText.length}/500
              </span>
            )}
          </div>

          <button
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={15} />
          </button>
        </div>

        <p className="mt-1.5 text-[10px] font-mono text-muted">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
      </div>
    </div>
  )
}
