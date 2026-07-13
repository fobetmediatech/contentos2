/**
 * ChatPage — single-surface agentic interface.
 *
 * All pipeline states (running, clarifying, done, error) render inline in the
 * chat — no navigation to separate result pages. Results, selection, and reel
 * analysis all happen here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { Bot, ChevronDown, Send, Paperclip, X } from 'lucide-react'
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
import { ReelResultMessage } from '../components/ReelResultMessage'
import { SingleReelResultMessage } from '../components/SingleReelResultMessage'
import RepurposeResultMessage from '../components/RepurposeResultMessage'
import { TranscriptResultMessage } from '../components/TranscriptResultMessage'
import { useRepurposeStore } from '../store/repurposeStore'
import { PIPELINE_REGISTRY } from '../tools/registry'
import { SlashCommandMenu } from '../components/SlashCommandMenu'
import { CHAT_TOOL_COMMANDS } from '../shared/utils/toolCommands'
import type { ChatToolCommand } from '../shared/utils/toolCommands'
import { useSlashMenu } from '../hooks/useSlashMenu'
import type { NormalizedProfile } from '../lib/transformers'
import type { ChatMessage as ChatMessageData } from '../store/analysisStore'
import { useCorpusStore } from '../store/corpusStore'
import { toast } from '../lib/toast'
import { harvestCompetitors, harvestDiscovery, harvestReelContent } from '../lib/corpusHarvest'
import { buildReelResultPayload } from '../lib/reelSnapshot'
import { addShownProfiles, getShownProfiles } from '../lib/competitorCache'
import { mergeCompetitorResults } from '../components/competitorResultView'
import { alreadyCollectedMessage } from '../lib/errorMessages'
import { MAX_INPUT_CHARS } from '../lib/constants'
import { readAttachment, ACCEPT_ATTR, type ChatAttachment } from '../lib/attachment'
import { TARGET_PER_CATEGORY } from '../hooks/useCompetitorAnalysis'
import type { CompetitorResultPayload } from '../domain/chat'
import { useRunsStore, selectActiveRuns, selectActiveRunOfKind } from '../store/runsStore'
import { RunCockpit } from '../components/runs/RunCockpit'
import { runToMessage } from './chatRunSnapshot'
import { competitorRunLabel, discoveryRunLabel, repurposeRunLabel, reelRunLabel } from './heavyRunLabels'
import { disposeController } from '../lib/runControllers'
import { launchHeavyRun } from '../hooks/agentRunLaunch'
import type { RunKind } from '../domain/runs'

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
  const analysisUnverified = useAnalysisStore((s) => s.unverified)
  const analysisError = useAnalysisStore((s) => s.error)
  const startChat = useAnalysisStore((s) => s.startChat)
  const setStatus = useAnalysisStore((s) => s.setStatus)

  // The chat transcript lives in conversationsStore now (multi-conversation history). Select
  // only STABLE values (the raw record + active id + action fns) — never a freshly-computed
  // array, or useSyncExternalStore loops forever. Derive the list/messages in the render body.
  const conversations = useConversationsStore((s) => s.conversations)
  const activeConversationId = useConversationsStore((s) => s.activeId)
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
  const discoveryCurrentStep = useDiscoveryStore((s) => s.currentStep)
  const discoveryStepProgressDetail = useDiscoveryStore((s) => s.stepProgressDetail)
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
  // Repurpose run state — drives the live progress marker; the finished result is snapshotted
  // into the conversation (kind 'repurpose') by the effect below, then the store is reset.
  const repurposeStatus = useRepurposeStore((s) => s.status)
  const repurposeConversationId = useRepurposeStore((s) => s.conversationId)
  const resetRepurpose = useRepurposeStore((s) => s.reset)
  // RunCockpit focus — tracks which pipeline pane is "active" for steering (Plan 2 uses this).
  // For Phase 1 it's just wired to the cockpit so the UI highlights the focused pane.
  const [focusedKind, setFocusedKind] = useState<RunKind | null>(null)

  const [inputText, setInputText] = useState('')
  // The tool armed via a "/" pick or a chip tap. While set, the input shows the
  // tool's placeholder and the user types only their own values; handleSend
  // wraps that raw input with the tool's routing template. null = free chat.
  const [armedTool, setArmedTool] = useState<ChatToolCommand | null>(null)
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
  const reelContentArmedRef = useRef(false) // armed while a reel run is live; harvests content + snapshots once on synthesis done
  const reelSnapshotFiredRef = useRef(false) // prevents double-snapshot when launchReelAnalysis runs snapshotCurrentReelRun after the effect already fired
  const repurposeArmedRef = useRef(false) // armed while a repurpose run is live; snapshots once on done
  // Registry snapshot: tracks run ids already snapshotted so we never double-add.
  const snapshottedRunIds = useRef<Set<string>>(new Set())

  // Selection state — shared across competitor + discovery results
  const [selectedHandles, setSelectedHandles] = useState<string[]>([])

  // Router state — the Memory page navigates here with creators to deep-analyze.
  const location = useLocation()
  const navigate = useNavigate()
  // Guards the Memory launch against StrictMode's double-effect + state clears.
  const memoryLaunchRef = useRef(false)

  // Phase 1: keys are server-side — isReady() always returns true; the !ready banner is removed.
  // Kept as a local const to avoid touching canSend / disabled props throughout.
  const ready = _isReady()
  // Reel run state (derived from the reel store). A run is "running" until synthesis
  // reaches a terminal state; "done" once synthesis succeeds or fails.
  const canSend = ready && (inputText.trim().length > 0 || attachment !== null)

  // Slash-command menu. Available any time the input is ready (not just the
  // empty welcome state) so it fixes mid-conversation misrouting, which is the
  // whole point of the feature (see plan-eng-review Issue 3). State lives in
  // this render tree but the logic is extracted for testability.
  // Arming a tool (from the menu or a chip): clear the input, show the tool's
  // placeholder, and refocus so the user types their own IDs. No fake example.
  const armTool = (command: ChatToolCommand) => {
    setArmedTool(command)
    setInputText('')
    textareaRef.current?.focus()
  }

  const slash = useSlashMenu({
    inputText,
    setInputText,
    ready,
    onSelectCommand: armTool,
  })

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
      const run = selectActiveRunOfKind(useRunsStore.getState(), 'discovery', discoveryRunConversationId ?? activeConversationId)
      if (run) { useRunsStore.getState().removeRun(run.id); disposeController(run.id) }
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
          // Web-fallback result (Apify down): handles are web-sourced + unverified, metrics estimated.
          unverified: analysisUnverified || undefined,
          // Re-run context for "Start over": same handles + reused clarification answer.
          handles: useAnalysisStore.getState().params?.handles ?? prior?.handles ?? [],
          nicheContext: useAnalysisStore.getState().params?.nicheContext ?? prior?.nicheContext ?? '',
          clarificationAnswer: useAnalysisStore.getState().clarificationAnswer ?? prior?.clarificationAnswer ?? '',
        },
      })
      // Unverified web-fallback results are NOT written to the learning stores: the handles weren't
      // scrape-verified and the metrics are estimates, so harvesting them would poison the shared
      // corpus and the per-conversation shown-cache with low-confidence data.
      if (!analysisUnverified) {
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
      }
      setStatus('chatting')
      const runDone = selectActiveRunOfKind(useRunsStore.getState(), 'competitor', competitorRunConversationId ?? activeConversationId)
      if (runDone) { useRunsStore.getState().removeRun(runDone.id); disposeController(runDone.id) }
    } else if (status === 'error' && competitorResultArmedRef.current) {
      competitorResultArmedRef.current = false
      const runErr = selectActiveRunOfKind(useRunsStore.getState(), 'competitor', competitorRunConversationId ?? activeConversationId)
      if (runErr) { useRunsStore.getState().removeRun(runErr.id); disposeController(runErr.id) }
    }
  }, [status, competitors, summary, niche, candidateProfiles, analysisDidExpand, analysisUnverified, addMessageTo, competitorRunConversationId, activeConversationId, setStatus])

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
      const run = selectActiveRunOfKind(useRunsStore.getState(), 'discovery', discoveryRunConversationId ?? activeConversationId)
      if (run) { useRunsStore.getState().removeRun(run.id); disposeController(run.id) }
    }
  }, [discoveryStatus, discoveryResults, discoveryCity, discoveryNiche, discoveryProfiles, discoveryDidExpand, discoveryLocationRelaxed, addMessageTo, discoveryRunConversationId, activeConversationId, resetDiscovery])

  // Progress-mirror: keep the discovery run's cockpit pane label in sync with the live step.
  useEffect(() => {
    const targetId = discoveryRunConversationId ?? activeConversationId
    const run = selectActiveRunOfKind(useRunsStore.getState(), 'discovery', targetId)
    if (run) useRunsStore.getState().updateRun(run.id, { progress: discoveryRunLabel(discoveryCurrentStep, discoveryStepProgressDetail) })
  }, [discoveryStatus, discoveryCurrentStep, discoveryStepProgressDetail, discoveryRunConversationId, activeConversationId])

  // Progress-mirror: keep the repurpose run's cockpit pane label in sync with the live step.
  // Use repurposeConversationId (the run's own conversation) so the label stays correct
  // even if the user switches conversations mid-run.
  useEffect(() => {
    const targetId = repurposeConversationId ?? activeConversationId
    const run = selectActiveRunOfKind(useRunsStore.getState(), 'repurpose', targetId)
    if (run) useRunsStore.getState().updateRun(run.id, { progress: repurposeRunLabel(repurposeStatus) })
  }, [repurposeStatus, repurposeConversationId, activeConversationId])

  // Progress-mirror: keep the competitor run's cockpit pane label in sync with the live step.
  useEffect(() => {
    const targetId = competitorRunConversationId ?? activeConversationId
    const run = selectActiveRunOfKind(useRunsStore.getState(), 'competitor', targetId)
    if (run) useRunsStore.getState().updateRun(run.id, { progress: competitorRunLabel(status, currentStep, stepProgressDetail) })
  }, [status, currentStep, stepProgressDetail, competitorRunConversationId, activeConversationId])

  // Progress-mirror: keep the reel run's cockpit pane label in sync with the live step.
  // Uses reelConversationId ?? activeConversationId so the label stays correct even if the
  // user switches conversations mid-run.
  useEffect(() => {
    const targetId = reelConversationId ?? activeConversationId
    const run = selectActiveRunOfKind(useRunsStore.getState(), 'reel', targetId)
    if (run) useRunsStore.getState().updateRun(run.id, { progress: reelRunLabel(creatorStates, synthesisStatus) })
  }, [creatorStates, synthesisStatus, reelConversationId, activeConversationId])

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
      // Use the run's own conversation id (captured before reset) so cleanup works
      // correctly even if the user switched conversations mid-run.
      const runDone = selectActiveRunOfKind(useRunsStore.getState(), 'repurpose', repurposeConversationId ?? activeConversationId)
      if (runDone) { useRunsStore.getState().removeRun(runDone.id); disposeController(runDone.id) }
    } else if (repurposeStatus === 'error' && repurposeArmedRef.current) {
      repurposeArmedRef.current = false
      const s = useRepurposeStore.getState()
      addMessageTo(s.conversationId ?? activeConversationId, {
        role: 'assistant',
        type: 'error',
        content: s.error || 'Could not repurpose this reel.',
      })
      resetRepurpose()
      // Same: use the run's own conversation id, not the currently-active one.
      const runErr = selectActiveRunOfKind(useRunsStore.getState(), 'repurpose', repurposeConversationId ?? activeConversationId)
      if (runErr) { useRunsStore.getState().removeRun(runErr.id); disposeController(runErr.id) }
    }
  }, [repurposeStatus, addMessageTo, activeConversationId, repurposeConversationId, resetRepurpose])

  // Registry snapshot effect: watches ALL runs in the store; when any run reaches a terminal
  // state (done/failed) and hasn't been snapshotted yet, adds it to the correct conversation
  // as a result/error message, then cleans up the run record + its AbortController.
  // This is the NEW path for runs managed via runsStore (transcript, single-reel, etc.).
  // The old per-store effects above still handle competitor/discovery/repurpose via their own
  // stores; they run in parallel and will be cleaned up in Task 11.
  const runs = useRunsStore((s) => s.runs)
  useEffect(() => {
    for (const run of Object.values(runs)) {
      if (run.status !== 'done' && run.status !== 'failed') continue
      if (snapshottedRunIds.current.has(run.id)) continue
      snapshottedRunIds.current.add(run.id)
      addMessageTo(run.conversationId, runToMessage(run))
      useRunsStore.getState().removeRun(run.id)
      disposeController(run.id)
    }
  }, [runs, addMessageTo])

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisStatus, creatorStates])

  // Reel-run cockpit cleanup: fires on every terminal synthesisStatus ('done' OR 'failed'),
  // decoupled from the arming sequence above. This covers the direct-to-failed path in
  // useReelAnalysis (env/single-reel-fn unavailable) that sets synthesisStatus straight to
  // 'failed' WITHOUT ever passing through 'running' — which meant reelContentArmedRef was
  // never armed and the cockpit pane was never removed (ghost pane stuck open forever).
  // By acting only when an active reel run still exists in the registry and removeRun
  // deletes it, this fires exactly once per run and covers both normal and direct-fail paths.
  useEffect(() => {
    if (synthesisStatus !== 'done' && synthesisStatus !== 'failed') return
    const targetId = reelConversationId ?? activeConversationId
    const run = selectActiveRunOfKind(useRunsStore.getState(), 'reel', targetId)
    if (!run) return
    snapshotCurrentReelRun() // idempotent via reelSnapshotFiredRef
    useRunsStore.getState().removeRun(run.id)
    disposeController(run.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synthesisStatus, reelConversationId, activeConversationId])

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
    const raw = inputText.trim()
    // If a tool is armed, wrap the user's raw input with its routing template so
    // the right pipeline fires; otherwise send the free-typed text as-is.
    const text = armedTool ? armedTool.buildPrompt(raw) : raw
    const file = attachment
    setInputText('')
    setArmedTool(null)
    setAttachment(null)
    slash.close()
    resetTextareaHeight()
    await agentConv.sendMessage(text, file ?? undefined)
  }

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be re-picked after removal
    if (!file) return
    try {
      setAttachment(await readAttachment(file))
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not attach that file.')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // The slash menu gets first crack at the event. If it consumed it (nav /
    // select / escape), stop — do NOT fall through to the send path.
    if (slash.handleKeyDown(e)) return
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

  // Snapshot the CURRENT (finished) reel run into the conversation it ran in.
  // Reads the live store (getState) so it's accurate at call time.
  // Guard: only a terminal run with a known home conversation snapshots — an in-flight or
  // never-started run is skipped (interrupted runs are intentionally dropped).
  // Double-snapshot guard: reelSnapshotFiredRef tracks whether the effect (or a prior call)
  // already snapshotted this run. Callers that run after the effect (launchReelAnalysis,
  // handleStartOver) will be no-ops, preventing a duplicate result message.
  const snapshotCurrentReelRun = () => {
    if (reelSnapshotFiredRef.current) return
    const s = useReelAnalysisStore.getState()
    const terminal =
      s.synthesisStatus === 'done' || s.synthesisStatus === 'failed'
    if (!s.reelConversationId || s.activeHandles.length === 0 || !terminal) return
    reelSnapshotFiredRef.current = true
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
    // The dedicated terminal-cleanup effect snapshots any finished reel run automatically
    // before it is removed from the cockpit; no manual snapshotCurrentReelRun() call needed here.
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

  // Core reel-analysis launch, given an explicit handle list. Used by the
  // in-chat "Analyze reels for selected creators" action (targets the current
  // conversation) AND by the Memory page (targets a freshly-created chat — see
  // the effect below). `conversationId` defaults to the active conversation.
  const launchReelAnalysis = (handles: string[], conversationId?: string) => {
    if (handles.length === 0) return
    const convId = conversationId ?? activeConversationId
    setSelectedHandles([])
    // The dedicated terminal-cleanup effect snapshots the previous run automatically before it
    // is removed; no manual snapshotCurrentReelRun() call needed here. Reset the guard so the
    // NEW run can snapshot when it completes.
    reelSnapshotFiredRef.current = false
    reelActiveRef.current = true
    setReelConversationId(convId)
    launchHeavyRun('reel', handles.map((h) => `@${h}`).join(', '), convId, 'Scraping reels…', (runSignal) => {
      startReelAnalysis(handles, runSignal)
    })
  }

  // Wrapper bound to the current selection — used as the onAnalyzeReels callback
  // (must take no meaningful args; result components call it from onClick).
  const handleAnalyzeReels = () => launchReelAnalysis([...selectedHandles])

  // Deep-analysis launch handoff from the Memory page: it navigates here with
  // `{ analyzeHandles: [...] }` in router state. Fire once, then clear the state
  // so a refresh or StrictMode re-run doesn't relaunch the same analysis.
  useEffect(() => {
    const handles = (location.state as { analyzeHandles?: string[] } | null)?.analyzeHandles
    if (!handles || handles.length === 0 || memoryLaunchRef.current) return
    // Defer the launch one macrotask. Launching synchronously in this mount
    // effect races useReelAnalysis's mount-count abort: in dev StrictMode
    // (mount → cleanup → mount), the cleanup drops mountCount to 0 and aborts
    // the run we just started, and the guard blocks the relaunch — leaving a
    // blank chat. By the time this timeout fires, the StrictMode churn has
    // settled and mountCount is stably 1. The ref is set inside the callback
    // (not before scheduling) so the cleared-then-rescheduled timer still fires.
    const timer = setTimeout(() => {
      memoryLaunchRef.current = true
      navigate('.', { replace: true, state: null })
      // Spin the analysis up in its own fresh chat (reuses a blank one if the
      // active conversation is already empty), then read the resulting id.
      startNew()
      launchReelAnalysis(handles, useConversationsStore.getState().activeId)
    }, 0)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // Pipeline-targeted retry: re-fire the reel pipeline for the SAME handles directly (no agent
  // loop / re-routing). Used by the cockpit pane Retry button if exposed.
  const handleRetryReels = () => {
    const handles = [...activeHandles]
    if (handles.length === 0) return
    const convId = reelConversationId ?? activeConversationId
    setReelConversationId(convId) // re-bind in case the store reset cleared it
    reelSnapshotFiredRef.current = false // reset guard for the retry run
    launchHeavyRun('reel', handles.map((h) => `@${h}`).join(', '), convId, 'Scraping reels…', (runSignal) => {
      startReelAnalysis(handles, runSignal)
    })
  }

  // Active runs for the current conversation — used for the inline single-run progress block
  // and passed to RunCockpit. useShallow prevents new-array identity from triggering rerenders.
  const activeRunsForConversation = useRunsStore(
    useShallow((s) => selectActiveRuns(s, activeConversationId ?? '')),
  )
  const singleActiveRun = activeRunsForConversation.length === 1 ? activeRunsForConversation[0] : null

  // Derived booleans
  const hasMessages = conversationMessages.length > 0
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
              One chat for every tool — find competitors, discover creators by city, break down reel hooks, or repurpose and transcribe reels. Just describe it, or type <span className="font-mono text-[var(--color-accent-light)]">/</span> to pick a tool.
            </p>
            <div className="mt-6 flex flex-col gap-2 w-full max-w-sm">
              {CHAT_TOOL_COMMANDS.map((command) => (
                <button
                  key={command.id}
                  onClick={() => {
                    if (!ready) return
                    armTool(command)
                  }}
                  disabled={!ready}
                  className="group px-3.5 py-2.5 text-left bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-xl hover:border-[var(--color-accent)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="block text-xs font-semibold text-[var(--color-accent-light)] mb-0.5">{command.label}</span>
                  <span className="block text-sm text-secondary group-hover:text-primary transition-colors">{command.hint}</span>
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
                ) : message.type === 'result' && message.result?.kind === 'single-reel' ? (
                  // A finished single-reel case study, snapshotted into this conversation.
                  // Renders statically from the persisted payload — survives reload.
                  <SingleReelResultMessage key={message.id} payload={message.result} />
                ) : message.type === 'reel' ? (
                  // Legacy type:'reel' markers (pre-cockpit) no-op silently — the cockpit
                  // pane now shows reel progress; the finished grid appears in the result message.
                  null
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

              {/* ── Competitor clarification card (cockpit pane replaces the progress bubble) ── */}
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

              {/* ── Location discovery progress now handled by RunCockpit ── */}

              {/* Competitor results now render inline as a type:'result' message (Phase 2). */}

              {/* Discovery results now render inline as a type:'result' message (Phase 2 stage 2). */}

              {/* Reel analysis: progress renders in the cockpit pane (RunCockpit below); finished runs appear as type:'result' / kind:'reel' result messages above. */}

            </div>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── RunCockpit + inline single-run progress ─────────────────────── */}
      {/* RunCockpit renders a grid/counter when 2+ runs are active; returns null for 0 or 1. */}
      {activeConversationId && (
        <div className="flex-shrink-0 px-4 max-w-4xl mx-auto w-full">
          <RunCockpit
            conversationId={activeConversationId}
            focusedKind={focusedKind}
            onFocusKind={setFocusedKind}
          />
          {/* When exactly one run is active (cockpit returns null), show a minimal inline
              progress row so the user can see the run's current step. */}
          {singleActiveRun && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-surface border border-[rgba(var(--border-rgb),0.08)] text-sm mb-2">
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-accent)] opacity-60 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--color-accent)]" />
              </span>
              <span className="text-secondary truncate">
                {singleActiveRun.progress || singleActiveRun.targetLabel || 'Running…'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Input area — blends into the chat canvas; the field is a soft pill ── */}
      <div className="flex-shrink-0 bg-chai px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* Armed-tool pill: shows which tool the next message routes to, with a
            clear (✕) to drop back to free chat. */}
        {armedTool && (
          <div className="max-w-4xl mx-auto w-full mb-1.5 flex">
            <span className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-medium bg-[rgba(var(--accent-rgb),0.12)] text-[var(--color-accent)]">
              {armedTool.label}
              <button
                type="button"
                onClick={() => {
                  setArmedTool(null)
                  textareaRef.current?.focus()
                }}
                aria-label={`Clear ${armedTool.label} tool`}
                className="rounded-full p-0.5 hover:bg-[rgba(var(--accent-rgb),0.20)] transition-colors"
              >
                <X size={12} />
              </button>
            </span>
          </div>
        )}
        {/* Centered to the same max-width as the conversation column above. */}
        <div className="max-w-4xl mx-auto w-full">
          {/* Selected-file chip — shows above the composer until sent or removed. */}
          {attachment && (
            <div className="mb-2 inline-flex items-center gap-2 max-w-full px-3 py-1.5 rounded-xl bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.10)] text-xs text-primary">
              <Paperclip size={13} className="flex-shrink-0 text-[var(--color-accent)]" />
              <span className="truncate">{attachment.name}</span>
              <span className="flex-shrink-0 font-mono text-[10px] text-muted">
                {attachment.size >= 1024 * 1024
                  ? `${(attachment.size / 1024 / 1024).toFixed(1)} MB`
                  : `${Math.max(1, Math.round(attachment.size / 1024))} KB`}
              </span>
              <button
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
                className="flex-shrink-0 text-muted hover:text-danger transition-colors"
              >
                <X size={13} />
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 w-full">
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ATTR}
              onChange={handleFilePick}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!ready}
              aria-label="Attach a document"
              title="Attach a PDF, image, or text file"
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full text-muted hover:text-[var(--color-accent)] hover:bg-[var(--color-surface)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Paperclip size={17} />
            </button>

            <div className="relative flex-1">
              {slash.open && (
                <SlashCommandMenu
                  commands={slash.commands}
                  highlightedIndex={slash.highlightedIndex}
                  onSelect={slash.onSelect}
                  onHighlight={slash.setHighlightedIndex}
                />
              )}
              <textarea
                ref={textareaRef}
                value={inputText}
                onChange={(e) => slash.onInputChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={handleTextareaInput}
                onBlur={slash.close}
                placeholder={
                  armedTool
                    ? armedTool.placeholder
                    : showRunPlaceholder
                      ? 'Ask a follow-up — or type new instructions to redirect (this stops the current run)'
                      : 'Describe a niche, location, or paste handles… (type / for tools)'
                }
                maxLength={MAX_INPUT_CHARS}
                rows={1}
                disabled={!ready}
                aria-label="Message input"
                className="w-full px-4 py-3 text-sm bg-[var(--color-surface)] text-primary border border-[rgba(var(--border-rgb),0.10)] rounded-2xl shadow-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)] focus:border-[var(--color-accent)] resize-none disabled:opacity-40 disabled:cursor-not-allowed leading-relaxed placeholder:text-muted"
              />
              {inputText.length >= MAX_INPUT_CHARS * 0.9 && (
                <span
                  className={`absolute bottom-2.5 right-2.5 text-[10px] font-mono tabular-nums ${
                    inputText.length >= MAX_INPUT_CHARS * 0.96 ? 'text-danger' : 'text-muted'
                  }`}
                >
                  {inputText.length}/{MAX_INPUT_CHARS}
                </span>
              )}
            </div>

            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-bg)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              <Send size={15} />
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-[10px] font-mono text-muted">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
      </div>
    </div>
  )
}
