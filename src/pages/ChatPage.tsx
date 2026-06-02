/**
 * ChatPage — single-surface agentic interface.
 *
 * All pipeline states (running, clarifying, done, error) render inline in the
 * chat — no navigation to separate result pages. Results, selection, and reel
 * analysis all happen here.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { AlertTriangle, Bot, Send, CheckCircle, X, Video } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useKeysStore } from '../store/keysStore'
import { useConversation } from '../hooks/useConversation'
import { useCompetitorAnalysis } from '../hooks/useCompetitorAnalysis'
import { useActivePipeline } from '../hooks/useActivePipeline'
import { useReelAnalysis } from '../hooks/useReelAnalysis'
import { ChatMessage, ProgressBubble, TypingIndicator } from '../components/ChatMessage'
import { ClarificationCard } from '../components/ClarificationCard'
import { CompetitorCard } from '../components/CompetitorCard'
import { DiscoveryCard } from '../components/DiscoveryCard'
import { InlineReelResults } from '../components/InlineReelResults'
import { COMPETITOR_CATEGORIES, DISCOVERY_CATEGORIES } from '../shared/utils/categories'
import { MIN_LOCATION_RESULTS } from '../hooks/useLocationDiscovery'

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
  const { sendMessage, confirmSeeds, isConfirmingPending, isConfirmingLocked, isAnswering } = useConversation()
  const { answerClarification, isPending: clarificationPending } = useCompetitorAnalysis()
  const { startAnalysis: startReelAnalysis, activeHandles, creatorStates, synthesisStatus, synthesis, synthesisError, reset: resetReel } = useReelAnalysis()

  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const analysisErrorHandledRef = useRef(false)

  // Selection state — shared across competitor + discovery results
  const [selectedHandles, setSelectedHandles] = useState<string[]>([])
  const [selectionWarning, setSelectionWarning] = useState<string | null>(null)

  const ready = isReady()
  // Reel run state (derived from the reel store). A run is "running" until synthesis
  // reaches a terminal state; "done" once synthesis succeeds or fails.
  const isReelRunning = activeHandles.length > 0 && synthesisStatus !== 'done' && synthesisStatus !== 'failed'
  const isReelDone = activeHandles.length > 0 && (synthesisStatus === 'done' || synthesisStatus === 'failed')
  const isInPipeline = ['running', 'clarifying', 'done', 'error'].includes(status) ||
    ['running', 'done', 'error'].includes(discoveryStatus)
  const canSend =
    (status === 'chatting' || status === 'confirming' || activePipeline.followUpAllowed) &&
    inputText.trim().length > 0 &&
    ready &&
    !isConfirmingPending &&
    !isConfirmingLocked &&
    !isReelRunning &&
    !isAnswering

  // Initialise chat state on mount
  useEffect(() => {
    if (status === 'idle') {
      startChat()
    } else if (
      status === 'done' ||
      status === 'error' ||
      status === 'discovering' ||
      status === 'confirming' ||
      status === 'running' ||
      status === 'clarifying'
    ) {
      reset()
      startChat()
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

  // Auto-focus textarea when entering confirming state
  useEffect(() => {
    if (status === 'confirming') {
      textareaRef.current?.focus()
    }
  }, [status])

  // Scroll to bottom whenever messages or pipeline state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversationMessages, status, discoveryStatus, currentStep, activePipeline.step, activeHandles, creatorStates, synthesisStatus, isAnswering])

  const resetTextareaHeight = () => {
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleSend = async () => {
    if (!canSend) return
    const text = inputText.trim()
    setInputText('')
    resetTextareaHeight()
    await sendMessage(text)
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
  const isDiscovering = status === 'discovering'
  const isAnalysisRunning = status === 'running'
  const isAnalysisClarifying = status === 'clarifying'
  const isAnalysisDone = status === 'done'
  const isDiscoveryRunning = activePipeline.activePipelineId === 'discovery' && activePipeline.isRunning
  const isDiscoveryDone = activePipeline.activePipelineId === 'discovery' && activePipeline.isDone
  const showInlineContent = isAnalysisRunning || isAnalysisClarifying || isAnalysisDone ||
    isDiscoveryRunning || isDiscoveryDone

  // Profile maps + cohort ER for card rendering
  const profileMap = new Map(inputProfiles.map((p) => [p.username, p]))
  const allERValues = competitors
    .map((c) => profileMap.get(c.username)?.engagementRate)
    .filter((er): er is number => er !== null && er !== undefined)
  const cohortAvgER = allERValues.length > 0
    ? allERValues.reduce((a, b) => a + b, 0) / allERValues.length
    : 3.0

  const discoveryProfileMap = new Map(discoveryProfiles.map((p) => [p.username, p]))
  const discoveryERValues = discoveryResults
    .map((r) => discoveryProfileMap.get(r.username)?.engagementRate)
    .filter((er): er is number => er !== null && er !== undefined)
  const discoveryAvgER = discoveryERValues.length > 0
    ? discoveryERValues.reduce((a, b) => a + b, 0) / discoveryERValues.length
    : 3.0

  const topCompetitors = competitors.filter((c) => c.category === 'top').sort((a, b) => a.rank - b.rank)
  const trendingCompetitors = competitors.filter((c) => c.category === 'trending').sort((a, b) => a.rank - b.rank)
  const topDiscovery = discoveryResults.filter((r) => r.category === 'top').sort((a, b) => a.rank - b.rank)
  const trendingDiscovery = discoveryResults.filter((r) => r.category === 'trending').sort((a, b) => a.rank - b.rank)

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
          <div className="px-4 pt-4 pb-6">
            <div role="log" aria-live="polite" aria-label="Conversation" className="flex flex-col gap-4">

              {/* Conversation messages */}
              {conversationMessages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  onOptionSelect={confirmSeeds}
                  optionsDisabled={status !== 'confirming' || isConfirmingPending}
                />
              ))}

              {/* Typing indicators */}
              {isDiscovering && <TypingIndicator />}
              {isConfirmingPending && <TypingIndicator />}
              {isAnswering && <TypingIndicator />}

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

              {/* ── Competitor analysis results ───────────────────────── */}
              {isAnalysisDone && (
                <>
                  {/* Completion bubble */}
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center mt-0.5">
                      <Bot size={14} className="text-[#E07B3A]" />
                    </div>
                    <div className="flex flex-col gap-2 max-w-[80%]">
                      <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm leading-relaxed">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle size={14} className="text-success flex-shrink-0" />
                          <span className="font-semibold text-primary">Analysis complete</span>
                        </div>
                        <p className="text-secondary">
                          Found {competitors.length} competitor{competitors.length !== 1 ? 's' : ''}
                          {niche ? ` in the ${niche} space` : ''}.
                          Ranked by engagement, location fit, and partnership readiness.
                        </p>
                        {analysisDidExpand && (
                          <p className="text-xs text-warning mt-1.5">
                            Sparse niche — results may be limited. Try a different reference account for a broader pool.
                          </p>
                        )}
                      </div>
                      <button
                        onClick={handleStartOver}
                        className="self-start px-4 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
                      >
                        Start over
                      </button>
                    </div>
                  </div>

                  {/* AI summary — violet AI tint + Gemini eyebrow per DESIGN.md */}
                  {summary && (
                    <div className="px-4 py-3 bg-[rgba(167,139,250,0.08)] border border-[#A78BFA]/20 rounded-xl">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#A78BFA] mb-1">✦ Gemini</p>
                      <p className="text-sm text-[#C4B5FD] leading-relaxed">{summary}</p>
                    </div>
                  )}

                  {/* Card grid */}
                  {topCompetitors.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
                        {COMPETITOR_CATEGORIES.top.sectionLabel}
                      </p>
                      <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                        {topCompetitors.map((c) => (
                          <CompetitorCard
                            key={c.username}
                            competitor={c}
                            profile={profileMap.get(c.username)}
                            cohortAvgER={cohortAvgER}
                            isSelected={selectedHandles.includes(c.username)}
                            onSelect={activeHandles.length === 0 ? handleToggleSelect : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {trendingCompetitors.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
                        {COMPETITOR_CATEGORIES.trending.sectionLabel}
                      </p>
                      <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                        {trendingCompetitors.map((c) => (
                          <CompetitorCard
                            key={c.username}
                            competitor={c}
                            profile={profileMap.get(c.username)}
                            cohortAvgER={cohortAvgER}
                            isSelected={selectedHandles.includes(c.username)}
                            onSelect={activeHandles.length === 0 ? handleToggleSelect : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Selection CTA */}
                  {selectedHandles.length > 0 && activeHandles.length === 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => setSelectedHandles([])}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#A09080] border border-[#3D2E1E] rounded-xl hover:text-[#F5E6D3] hover:border-[#5C4A30] transition-colors"
                      >
                        <X size={13} />
                        Clear
                      </button>
                      <button
                        onClick={handleAnalyzeReels}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#E07B3A] text-[#1A1410] rounded-xl hover:bg-[#C96A2A] transition-colors"
                      >
                        <Video size={14} />
                        Analyze {selectedHandles.length} creator{selectedHandles.length !== 1 ? 's' : ''} reels
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ── Discovery results ─────────────────────────────────── */}
              {isDiscoveryDone && (
                <>
                  {/* Completion bubble */}
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center mt-0.5">
                      <Bot size={14} className="text-[#E07B3A]" />
                    </div>
                    <div className="flex flex-col gap-2 max-w-[80%]">
                      <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm leading-relaxed">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle size={14} className="text-success flex-shrink-0" />
                          <span className="font-semibold text-primary">Discovery complete</span>
                        </div>
                        <p className="text-secondary">
                          Found {discoveryResults.length} creator{discoveryResults.length !== 1 ? 's' : ''}
                          {discoveryCity ? ` in ${discoveryCity}` : ''}.
                          Filtered for location signals and partnership readiness.
                        </p>
                        {discoveryDidExpand && (
                          <p className="text-xs text-warning mt-1.5">
                            Expanded search with a second hashtag batch — initial pass found fewer than {MIN_LOCATION_RESULTS} creators in this city.
                          </p>
                        )}
                        {discoveryLocationRelaxed && (
                          <p className="text-xs text-warning mt-1.5">
                            Location filter relaxed — showing all niche-relevant creators; some may not be locally based.
                          </p>
                        )}
                      </div>
                      <button
                        onClick={handleStartOver}
                        className="self-start px-4 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
                      >
                        Start over
                      </button>
                    </div>
                  </div>

                  {/* Card grid */}
                  {topDiscovery.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
                        {DISCOVERY_CATEGORIES.top.sectionLabel}
                      </p>
                      <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                        {topDiscovery.map((r) => (
                          <DiscoveryCard
                            key={r.username}
                            result={r}
                            profile={discoveryProfileMap.get(r.username)}
                            cohortAvgER={discoveryAvgER}
                            isSelected={selectedHandles.includes(r.username)}
                            onSelect={activeHandles.length === 0 ? handleToggleSelect : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {trendingDiscovery.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[#7A6A54] uppercase tracking-wide mb-3">
                        {DISCOVERY_CATEGORIES.trending.sectionLabel}
                      </p>
                      <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
                        {trendingDiscovery.map((r) => (
                          <DiscoveryCard
                            key={r.username}
                            result={r}
                            profile={discoveryProfileMap.get(r.username)}
                            cohortAvgER={discoveryAvgER}
                            isSelected={selectedHandles.includes(r.username)}
                            onSelect={activeHandles.length === 0 ? handleToggleSelect : undefined}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Selection CTA */}
                  {selectedHandles.length > 0 && activeHandles.length === 0 && (
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={() => setSelectedHandles([])}
                        className="flex items-center gap-1.5 px-3 py-2 text-sm text-[#A09080] border border-[#3D2E1E] rounded-xl hover:text-[#F5E6D3] hover:border-[#5C4A30] transition-colors"
                      >
                        <X size={13} />
                        Clear
                      </button>
                      <button
                        onClick={handleAnalyzeReels}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[#E07B3A] text-[#1A1410] rounded-xl hover:bg-[#C96A2A] transition-colors"
                      >
                        <Video size={14} />
                        Analyze {selectedHandles.length} creator{selectedHandles.length !== 1 ? 's' : ''} reels
                      </button>
                    </div>
                  )}
                </>
              )}

              {/* ── Inline reel analysis ──────────────────────────────── */}
              {activeHandles.length > 0 && (
                <>
                  {/* Header bubble */}
                  <div className="flex items-start gap-2">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(167,139,250,0.12)] flex items-center justify-center mt-0.5">
                      <Video size={14} className="text-[#A78BFA]" />
                    </div>
                    <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm leading-relaxed max-w-[80%]">
                      <span className="font-semibold text-primary">Analyzing reels</span>
                      <p className="text-secondary mt-0.5">
                        Scraping and analyzing reels for {activeHandles.map(h => `@${h}`).join(', ')} — this takes {activeHandles.length * 2}–{activeHandles.length * 3} min.
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
                    <button
                      onClick={handleStartOver}
                      className="self-start px-4 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
                    >
                      Start over
                    </button>
                  )}
                </>
              )}

            </div>
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-surface border-t border-[rgba(245,237,214,0.08)] px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleTextareaInput}
              placeholder={
                isReelRunning
                  ? 'Analyzing reels — this takes a few minutes…'
                  : isInPipeline
                  ? 'Analysis in progress…'
                  : status === 'discovering'
                  ? 'Searching for accounts…'
                  : status === 'confirming' && isConfirmingLocked
                  ? 'Pick one of the options above ↑'
                  : status === 'confirming'
                  ? 'Or describe what you want…'
                  : 'Describe a niche, location, or paste handles…'
              }
              maxLength={500}
              rows={1}
              disabled={
                (status !== 'chatting' && status !== 'confirming' && !activePipeline.followUpAllowed) ||
                isConfirmingPending ||
                isConfirmingLocked ||
                isReelRunning ||
                isAnswering
              }
              aria-label="Message input"
              className={`w-full px-3 py-2.5 text-sm bg-[#1A1410] text-primary border rounded-xl focus:outline-none focus:ring-1 focus:ring-[#E07B3A] focus:border-[#E07B3A] resize-none disabled:opacity-40 disabled:cursor-not-allowed leading-relaxed placeholder:text-muted ${
                status === 'confirming' && !isConfirmingPending
                  ? 'border-[rgba(224,123,58,0.35)] ring-1 ring-[rgba(224,123,58,0.12)]'
                  : 'border-[rgba(245,237,214,0.12)]'
              }`}
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
