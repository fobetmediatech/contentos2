/**
 * ChatPage — single-surface agentic interface.
 *
 * All pipeline states (running, clarifying, done, error) render inline in the
 * chat — no navigation to separate result pages. Results, selection, and reel
 * analysis all happen here.
 */

import { Fragment, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AlertTriangle, Bot, Send, Video } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useKeysStore } from '../store/keysStore'
import { useAgentConversation } from '../hooks/useAgentConversation'
import { useCompetitorAnalysis } from '../hooks/useCompetitorAnalysis'
import { useActivePipeline } from '../hooks/useActivePipeline'
import { useReelAnalysis } from '../hooks/useReelAnalysis'
import { ChatMessage, ProgressBubble, TypingIndicator } from '../components/ChatMessage'
import { ClarificationCard } from '../components/ClarificationCard'
import { CompetitorResultMessage } from '../components/CompetitorResultMessage'
import { DiscoveryResultMessage } from '../components/DiscoveryResultMessage'
import { InlineReelResults } from '../components/InlineReelResults'

// Tool chips shown in the empty state — one per independent tool, so all three
// are discoverable at a glance. Tapping prefills the input with a representative prompt.
const TOOL_CHIPS: { tool: string; example: string; hint: string }[] = [
  { tool: 'Find competitors', example: 'Top fitness creators like @nike.training', hint: 'See who is winning in a niche' },
  { tool: 'Discover by city', example: 'Food bloggers in Mumbai', hint: 'Find creators based in a location' },
  { tool: 'Break down hooks', example: "Analyze @garyvee's reel hooks", hint: 'Reverse-engineer viral hook patterns' },
]

export function ChatPage() {
  const analysisStore = useAnalysisStore()
  const {
    status,
    conversationMessages,
    currentStep,
    pendingDiscovery,
    competitors,
    inputProfiles,
    summary,
    niche,
    stepProgressDetail,
    didExpand: analysisDidExpand,
    error: analysisError,
    startChat,
    reset,
    addMessage,
    setStatus,
  } = analysisStore

  const discoveryStatus = useDiscoveryStore((s) => s.status)
  const discoveryError = useDiscoveryStore((s) => s.error)
  const discoveryDidExpand = useDiscoveryStore((s) => s.didExpand)
  const discoveryCity = useDiscoveryStore((s) => s.params?.city ?? '')
  const discoveryResults = useDiscoveryStore((s) => s.results)
  const discoveryProfiles = useDiscoveryStore((s) => s.candidateProfiles)
  const discoveryLocationRelaxed = useDiscoveryStore((s) => s.locationFilterRelaxed)
  const resetDiscovery = useDiscoveryStore((s) => s.reset)
  const activePipeline = useActivePipeline()

  const { isReady } = useKeysStore()
  // Phase 1 graduated: the turn-based agent loop is THE conversation engine (the old
  // useConversation wizard is retired). Input stays live; a new message steers (latest-wins).
  const agentConv = useAgentConversation()
  const { answerClarification, isPending: clarificationPending } = useCompetitorAnalysis()
  const { startAnalysis: startReelAnalysis, startDeepReport, activeHandles, creatorStates, synthesisStatus, synthesis, synthesisError, deepReport, deepReportStatus, reset: resetReel } = useReelAnalysis()

  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const analysisErrorHandledRef = useRef(false)
  const competitorResultArmedRef = useRef(false) // armed while a competitor run is live; fires once on done
  const reelActiveRef = useRef(false) // tracks reel-run active edges to drop one position marker per run
  const discoveryResultArmedRef = useRef(false) // armed while a discovery run is live; fires once on done

  // Selection state — shared across competitor + discovery results
  const [selectedHandles, setSelectedHandles] = useState<string[]>([])
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null)

  const ready = isReady()
  // Reel run state (derived from the reel store). A run is "running" until synthesis
  // reaches a terminal state; "done" once synthesis succeeds or fails.
  const isReelDone = activeHandles.length > 0 && (synthesisStatus === 'done' || synthesisStatus === 'failed')
  // Input stays live during runs (TD3) — sending while something runs steers it (latest-wins).
  const canSend = ready && inputText.trim().length > 0

  // On mount: RESUME a persisted conversation if one exists (never wipe a restored
  // transcript — startChat() clears conversationMessages, which silently defeated persistence).
  // With no persisted chat, start fresh. A dead transient status (a mid-run state can't resume
  // after a reload/remount) is dropped to 'chatting' so the input is live with no stuck progress.
  useEffect(() => {
    if (conversationMessages.length === 0) {
      startChat()
    } else if (status !== 'chatting' && status !== 'done') {
      setStatus('chatting')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (discoveryStatus === 'done') {
      resetDiscovery()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Analysis error → surface as chat message
  useEffect(() => {
    if (status === 'error' && analysisError && !analysisErrorHandledRef.current) {
      analysisErrorHandledRef.current = true
      addMessage({ role: 'assistant', content: analysisError, timestamp: Date.now(), type: 'error' })
      setStatus('chatting')
    }
    if (status !== 'error') {
      analysisErrorHandledRef.current = false
    }
  }, [status, analysisError, addMessage, setStatus])

  // Discovery error → surface as chat message then reset.
  // M9: all read values are in deps (addMessage/setStatus/resetDiscovery are stable
  // Zustand refs). resetDiscovery flips status off 'error' immediately, so the guard
  // stops a re-fire — no duplicate error bubble.
  useEffect(() => {
    if (discoveryStatus === 'error') {
      const errMsg = discoveryError ?? 'Discovery failed — please try again.'
      addMessage({ role: 'assistant', content: errMsg, type: 'error' })
      setStatus('chatting')
      resetDiscovery()
    }
  }, [discoveryStatus, discoveryError, addMessage, setStatus, resetDiscovery])

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
      const handles = new Set(competitors.map((c) => c.username))
      addMessage({
        role: 'assistant',
        type: 'result',
        content: `Found ${competitors.length} competitor${competitors.length !== 1 ? 's' : ''}${niche ? ` in ${niche}` : ''}.`,
        result: {
          kind: 'competitor',
          competitors,
          summary,
          niche,
          profiles: inputProfiles.filter((p) => handles.has(p.username)),
          didExpand: analysisDidExpand,
        },
      })
      setStatus('chatting')
    }
  }, [status, competitors, summary, niche, inputProfiles, analysisDidExpand, addMessage, setStatus])

  // Reel position marker: when a reel run STARTS (activeHandles 0 → non-empty), drop a
  // `type:'reel'` marker into the conversation so the (live) reel block renders in place —
  // subsequent chats append BELOW it instead of piling above a bottom-pinned block. One
  // marker per run; the latest marker is the one that renders (older ones no-op).
  useEffect(() => {
    const active = activeHandles.length > 0
    if (active && !reelActiveRef.current) {
      reelActiveRef.current = true
      addMessage({
        role: 'assistant',
        type: 'reel',
        content: `Analyzing reels for ${activeHandles.map((h) => `@${h}`).join(', ')}.`,
      })
    } else if (!active) {
      reelActiveRef.current = false
    }
  }, [activeHandles, addMessage])

  // Results-as-messages (stage 2): snapshot a finished DISCOVERY run into the conversation as
  // a `type:'result'` message, then reset the discovery store. Armed only while a real run is
  // live so it fires once. Profiles trimmed to the ranked creators to keep the payload small.
  useEffect(() => {
    if (discoveryStatus === 'running') {
      discoveryResultArmedRef.current = true
    } else if (discoveryStatus === 'done' && discoveryResultArmedRef.current) {
      discoveryResultArmedRef.current = false
      const handles = new Set(discoveryResults.map((r) => r.username))
      addMessage({
        role: 'assistant',
        type: 'result',
        content: `Found ${discoveryResults.length} creator${discoveryResults.length !== 1 ? 's' : ''}${discoveryCity ? ` in ${discoveryCity}` : ''}.`,
        result: {
          kind: 'discovery',
          results: discoveryResults,
          city: discoveryCity,
          profiles: discoveryProfiles.filter((p) => handles.has(p.username)),
          didExpand: discoveryDidExpand,
          locationRelaxed: discoveryLocationRelaxed,
        },
      })
      resetDiscovery()
    }
  }, [discoveryStatus, discoveryResults, discoveryCity, discoveryProfiles, discoveryDidExpand, discoveryLocationRelaxed, addMessage, resetDiscovery])

  // Scroll to bottom whenever messages or pipeline state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversationMessages, status, discoveryStatus, currentStep, activePipeline.step, activeHandles, creatorStates, synthesisStatus])

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

  const handleStartOver = () => {
    reset()
    resetDiscovery()
    resetReel()
    startChat()
    setSelectedHandles([])
  }

  const handleToggleSelect = (handle: string) => {
    setSelectedHandles((prev) => {
      if (prev.includes(handle)) return prev.filter((h) => h !== handle)
      if (prev.length >= 5) {
        setSelectionWarning('Select up to 5 creators at a time')
        setTimeout(() => setSelectionWarning(null), 2500)
        return prev
      }
      return [...prev, handle]
    })
  }

  const handleAnalyzeReels = () => {
    const handles = [...selectedHandles]
    setSelectedHandles([])
    startReelAnalysis(handles)  // sets activeHandles in the reel store
  }

  // Derived booleans
  const hasMessages = conversationMessages.length > 0
  // Only the most recent reel marker renders the live block (the store holds one run); older
  // markers no-op. Empty when no reel run has started this session.
  const lastReelMarkerId = [...conversationMessages].reverse().find((m) => m.type === 'reel')?.id
  const isAnalysisRunning = status === 'running'
  const isAnalysisClarifying = status === 'clarifying'
  const isAnalysisDone = status === 'done'
  const isDiscoveryRunning = activePipeline.activePipelineId === 'discovery' && activePipeline.isRunning
  const isDiscoveryDone = activePipeline.activePipelineId === 'discovery' && activePipeline.isDone
  const showInlineContent = isAnalysisRunning || isAnalysisClarifying || isAnalysisDone ||
    isDiscoveryRunning || isDiscoveryDone

  // (Competitor + discovery card derivations now live in their result-message components,
  // computed from the snapshotted payload.)

  return (
    <div className="h-full flex flex-col bg-chai">
      {/* Keys-missing warning banner */}
      {!ready && (
        <div className="flex-shrink-0 flex items-start gap-2.5 px-4 py-2.5 bg-[rgba(217,119,6,0.08)] border-b border-[rgba(217,119,6,0.2)]">
          <AlertTriangle size={14} className="text-warning flex-shrink-0 mt-0.5" />
          <p className="text-xs text-secondary">
            Add your Gemini and Apify keys in{' '}
            <a href="/settings" className="underline font-medium text-[#F4A97B]">Settings</a>{' '}
            to get started.
          </p>
        </div>
      )}

      {/* Selection warning toast */}
      {selectionWarning && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 bg-[#2C2118] border border-[#E07B3A]/40 rounded-xl text-sm text-[#E07B3A] shadow-lg pointer-events-none">
          {selectionWarning}
        </div>
      )}

      {/* ── Message area ──────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages && !showInlineContent ? (
          // Welcome / empty state
          <div className="h-full flex flex-col items-center justify-center px-6 py-12">
            <div className="w-12 h-12 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center mb-4">
              <Bot size={22} className="text-[#E07B3A]" />
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
                  className="group px-3.5 py-2.5 text-left bg-surface border border-[rgba(245,237,214,0.08)] rounded-xl hover:border-[#E07B3A] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="block text-xs font-semibold text-[#F4A97B] mb-0.5">{tool}</span>
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
                    onStartOver={handleStartOver}
                    reelActive={activeHandles.length > 0}
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
                    reelActive={activeHandles.length > 0}
                  />
                ) : message.type === 'reel' ? (
                  // Reel block renders in place at the LATEST reel marker (the store holds one
                  // live run). Older markers + a restored marker with no live run no-op.
                  message.id === lastReelMarkerId && activeHandles.length > 0 ? (
                    <Fragment key={message.id}>
                      <div className="flex items-start gap-2">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(167,139,250,0.12)] flex items-center justify-center mt-0.5">
                          <Video size={14} className="text-[#A78BFA]" />
                        </div>
                        <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm leading-relaxed max-w-[80%]">
                          <span className="font-semibold text-primary">Analyzing reels</span>
                          <p className="text-secondary mt-0.5">
                            Scraping and analyzing reels for {activeHandles.map((h) => `@${h}`).join(', ')} — this takes {activeHandles.length * 2}–{activeHandles.length * 3} min.
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
                        onDeepReport={(handles) => void startDeepReport(handles)}
                        deepReport={deepReport}
                        deepReportStatus={deepReportStatus}
                      />

                      {isReelDone && (
                        <button
                          onClick={handleStartOver}
                          className="self-start px-4 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
                        >
                          Start over
                        </button>
                      )}
                    </Fragment>
                  ) : null
                ) : (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    // A clarification pill is just the user's next message (TD1).
                    onOptionSelect={agentConv.sendMessage}
                    optionsDisabled={agentConv.isThinking}
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
                        ? 'Help me rank the right accounts for your client.'
                        : stepProgressDetail
                        ? `${stepProgressDetail}…`
                        : 'Analyzing competitors — this takes up to 2 minutes…'
                    }
                  />
                  {isAnalysisClarifying && pendingDiscovery && (
                    <div className="flex items-start gap-2">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center mt-0.5">
                        <Bot size={14} className="text-[#E07B3A]" />
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
      <div className="flex-shrink-0 bg-surface border-t border-[rgba(245,237,214,0.08)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* Centered to the same max-width as the conversation column above. */}
        <div className="flex items-end gap-2 max-w-4xl mx-auto w-full">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleTextareaInput}
              // Input is always live — the agent handles every state — so the placeholder is
              // static (it must NOT track pipeline status, which lingers stale).
              placeholder="Describe a niche, location, or paste handles…"
              maxLength={500}
              rows={1}
              disabled={!ready}
              aria-label="Message input"
              className="w-full px-3 py-2.5 text-sm bg-[#1A1410] text-primary border border-[rgba(245,237,214,0.12)] rounded-xl focus:outline-none focus:ring-1 focus:ring-[#E07B3A] focus:border-[#E07B3A] resize-none disabled:opacity-40 disabled:cursor-not-allowed leading-relaxed placeholder:text-muted"
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
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-[#E07B3A] text-white hover:bg-[#C4612A] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={15} />
          </button>
        </div>

        <p className="mt-1.5 text-[10px] font-mono text-muted">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
