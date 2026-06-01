/**
 * ChatPage — conversational entry point for the analysis pipeline.
 *
 * All pipeline states (running, clarifying, done, error) now render inline
 * within the chat — no navigation to separate progress pages.
 *
 * Layout (T11): rendered inside AppLayout's noPadding mode (h-[100dvh] flex flex-col).
 * T5:  send button + textarea disabled when status !== 'chatting'.
 * T6:  maxLength=500, char counter shown at 400+ chars.
 * T7:  store reset on mount when status === 'done'.
 * T12: TypingIndicator shown while status === 'discovering'.
 * T14: role="log" aria-live="polite" on message list.
 * T17: message area is flex justify-center (empty) → justify-end (has messages).
 * T18: input container uses pb-[env(safe-area-inset-bottom)].
 * T23: status === 'error' on mount → reset + back to chatting.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bot, Send, CheckCircle, MapPin } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useKeysStore } from '../store/keysStore'
import { useConversation } from '../hooks/useConversation'
import { useCompetitorAnalysis } from '../hooks/useCompetitorAnalysis'
import { useActivePipeline } from '../hooks/useActivePipeline'
import { ChatMessage, TypingIndicator } from '../components/ChatMessage'
import { ProgressSteps } from '../components/ProgressSteps'
import { ClarificationCard } from '../components/ClarificationCard'

const EXAMPLE_PROMPTS = [
  'Indian food bloggers in Mumbai',
  'Fitness creators focused on women',
  'Personal finance influencers in Delhi',
]

export function ChatPage() {
  const navigate = useNavigate()
  const analysisStore = useAnalysisStore()
  const {
    status,
    conversationMessages,
    currentStep,
    pendingDiscovery,
    competitors,
    niche,
    error: analysisError,
    startChat,
    reset,
    addMessage,
    setStatus,
  } = analysisStore

  const discoveryStatus = useDiscoveryStore((s) => s.status)
  const discoveryError = useDiscoveryStore((s) => s.error)
  const resetDiscovery = useDiscoveryStore((s) => s.reset)
  const activePipeline = useActivePipeline()

  const { isReady } = useKeysStore()
  const { sendMessage, confirmSeeds, isConfirmingPending } = useConversation()
  const { answerClarification, isPending: clarificationPending } = useCompetitorAnalysis()

  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Guard: only emit one "analysis failed" chat message per error event
  const analysisErrorHandledRef = useRef(false)

  const ready = isReady()
  const isInPipeline = ['running', 'clarifying', 'done', 'error'].includes(status) ||
    ['running', 'done', 'error'].includes(discoveryStatus)
  // Allow sending when chatting, when following up after a pipeline completes,
  // or when in 'confirming' state so the user can type a direction instead of
  // clicking a button. isConfirmingPending re-locks while we await Gemini's mapping.
  const canSend =
    (status === 'chatting' || status === 'confirming' || activePipeline.followUpAllowed) &&
    inputText.trim().length > 0 &&
    ready &&
    !isConfirmingPending

  // T7 + T23: initialise chat state on mount
  useEffect(() => {
    if (status === 'idle') {
      startChat()
    } else if (status === 'done' || status === 'error') {
      reset()
      startChat()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Mount reset: clear stale discovery state so we don't immediately show old results
  useEffect(() => {
    if (discoveryStatus === 'done') {
      resetDiscovery()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Analysis error → surface as chat message + return to chatting
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

  // Discovery error → surface as chat message then reset
  useEffect(() => {
    if (discoveryStatus === 'error') {
      const errMsg = discoveryError ?? 'Discovery failed — please try again.'
      addMessage({ role: 'assistant', content: errMsg, timestamp: Date.now(), type: 'error' })
      setStatus('chatting')
      resetDiscovery()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryStatus, resetDiscovery])

  // Scroll to bottom whenever messages change or pipeline state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversationMessages, status, discoveryStatus, currentStep, activePipeline.step])

  const resetTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleSend = async () => {
    if (!canSend) return
    const text = inputText.trim()
    setInputText('')
    resetTextareaHeight()
    await sendMessage(text)
  }

  // Enter to send, Shift+Enter for newline
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Auto-grow textarea as user types
  const handleTextareaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  const handleStartOver = () => {
    reset()
    resetDiscovery()
    startChat()
  }

  const hasMessages = conversationMessages.length > 0
  const isDiscovering = status === 'discovering'

  // Competitor analysis inline states
  const isAnalysisRunning = status === 'running'
  const isAnalysisClarifying = status === 'clarifying'
  const isAnalysisDone = status === 'done'

  // Location discovery inline states (via bridge hook)
  const isDiscoveryRunning = activePipeline.activePipelineId === 'discovery' && activePipeline.isRunning
  const isDiscoveryDone = activePipeline.activePipelineId === 'discovery' && activePipeline.isDone

  const showInlineContent = isAnalysisRunning || isAnalysisClarifying || isAnalysisDone ||
    isDiscoveryRunning || isDiscoveryDone

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Keys-missing amber banner */}
      {!ready && (
        <div className="flex-shrink-0 flex items-start gap-2.5 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
          <AlertTriangle size={14} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            Add your Gemini and Apify keys in{' '}
            <a href="/settings" className="underline font-medium">
              Settings
            </a>{' '}
            to get started.
          </p>
        </div>
      )}

      {/* ── Message area ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!hasMessages && !showInlineContent ? (
          // T17: centered empty / welcome state
          <div className="h-full flex flex-col items-center justify-center px-6 py-12">
            <div className="w-12 h-12 rounded-full bg-indigo-100 flex items-center justify-center mb-4">
              <Bot size={22} className="text-indigo-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900 mb-1.5">
              What do you want to analyze?
            </h2>
            <p className="text-sm text-slate-500 text-center max-w-xs leading-relaxed">
              Describe a niche, creator space, or location and I'll discover relevant accounts for competitor analysis.
            </p>
            {/* Example prompt chips */}
            <div className="mt-6 flex flex-col gap-2 w-full max-w-xs">
              {EXAMPLE_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    if (!ready) return
                    setInputText(prompt)
                    textareaRef.current?.focus()
                  }}
                  disabled={!ready}
                  className="px-3 py-2 text-xs text-left text-slate-600 bg-white border border-slate-200 rounded-lg hover:border-indigo-300 hover:text-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          // T17: messages + inline pipeline content pushed to bottom
          <div className="min-h-full flex flex-col px-4 pt-4 pb-2">
            <div className="flex-1" aria-hidden="true" />

            {/* T14: accessible message log */}
            <div
              role="log"
              aria-live="polite"
              aria-label="Conversation"
              className="flex flex-col gap-4"
            >
              {conversationMessages.map((message, i) => (
                <ChatMessage
                  key={`${message.timestamp}-${i}`}
                  message={message}
                  onOptionSelect={confirmSeeds}
                  // Buttons are disabled when not in confirming state, or while
                  // we are awaiting Gemini's mapping of a typed reply (AD2).
                  optionsDisabled={status !== 'confirming' || isConfirmingPending}
                />
              ))}

              {/* T12: animated typing indicator while parsing intent */}
              {isDiscovering && <TypingIndicator />}

              {/* Typing indicator while Gemini maps a typed confirming-state reply (AD2) */}
              {isConfirmingPending && <TypingIndicator />}

              {/* ── Inline competitor analysis progress ──────────────────── */}
              {(isAnalysisRunning || isAnalysisClarifying) && (
                <div className="w-full max-w-2xl mx-auto py-2">
                  <p className="text-xs text-slate-500 text-center mb-4">
                    {isAnalysisClarifying
                      ? 'Help me rank the right accounts for your client.'
                      : "Analyzing competitors — this takes up to 2 minutes…"}
                  </p>
                  <ProgressSteps
                    currentStep={isAnalysisClarifying ? 5 : currentStep}
                  />
                  {isAnalysisClarifying && pendingDiscovery && (
                    <ClarificationCard
                      question={pendingDiscovery.clarificationQuestion}
                      candidateCount={pendingDiscovery.candidateProfiles.length}
                      onAnswer={answerClarification}
                      disabled={clarificationPending}
                    />
                  )}
                </div>
              )}

              {/* ── Inline location discovery progress ───────────────────── */}
              {isDiscoveryRunning && (
                <div className="w-full max-w-2xl mx-auto py-2">
                  <div className="flex items-center justify-center gap-2 mb-4">
                    <MapPin size={14} className="text-teal-600" />
                    <p className="text-xs text-slate-500">
                      {activePipeline.progressLabel}
                    </p>
                  </div>
                  <ProgressSteps currentStep={activePipeline.step} steps={activePipeline.stepLabels} />
                </div>
              )}

              {/* ── Competitor analysis done ──────────────────────────────── */}
              {isAnalysisDone && (
                <div className="w-full max-w-2xl mx-auto mt-2 rounded-xl border border-green-200 bg-green-50 p-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        Analysis complete — found {competitors.length} competitor{competitors.length !== 1 ? 's' : ''}
                        {niche ? ` in the ${niche} space` : ''}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Ranked by engagement, location fit, and partnership readiness.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => navigate('/results')}
                      className="flex-1 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      View full report →
                    </button>
                    <button
                      onClick={handleStartOver}
                      className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Start over
                    </button>
                  </div>
                </div>
              )}

              {/* ── Location discovery done ───────────────────────────────── */}
              {isDiscoveryDone && activePipeline.discoveryResults && (
                <div className="w-full max-w-2xl mx-auto mt-2 rounded-xl border border-teal-200 bg-teal-50 p-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle size={20} className="text-teal-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        Found {activePipeline.discoveryResults.length} creator{activePipeline.discoveryResults.length !== 1 ? 's' : ''}
                        {activePipeline.progressLabel ? ` — ${activePipeline.progressLabel.replace('Discovering creators in ', '').replace('…', '')}` : ''}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Filtered for location signals and partnership readiness.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={() => navigate(activePipeline.resultsPath)}
                      className="flex-1 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
                    >
                      View full report →
                    </button>
                    <button
                      onClick={handleStartOver}
                      className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Start over
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Anchor for auto-scroll */}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ────────────────────────────────────────────────────── */}
      {/* T18: pb-[env(safe-area-inset-bottom)] for iOS home bar */}
      <div className="flex-shrink-0 bg-white border-t border-slate-200 px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          {/* Textarea wrapper */}
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onInput={handleTextareaInput}
              placeholder={
                isInPipeline
                  ? 'Analysis in progress…'
                  : status === 'discovering'
                  ? 'Searching for accounts…'
                  : status === 'confirming'
                  ? 'Or describe what you want…'
                  : 'Describe a niche, location, or paste handles…'
              }
              maxLength={500}
              rows={1}
              // T5: disabled when not in chatting or confirming state (follow-up enabled when pipeline is done).
              // Also disabled while isConfirmingPending to prevent double-submit during Gemini mapping.
              disabled={
                (status !== 'chatting' && status !== 'confirming' && !activePipeline.followUpAllowed) ||
                isConfirmingPending
              }
              aria-label="Message input"
              className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none disabled:bg-slate-50 disabled:text-slate-400 leading-relaxed ${
                status === 'confirming' && !isConfirmingPending
                  ? 'border-indigo-300 ring-1 ring-indigo-100'
                  : 'border-slate-200'
              }`}
            />
            {/* T6: char counter shown at 400+ */}
            {inputText.length >= 400 && (
              <span
                className={`absolute bottom-2.5 right-2.5 text-[10px] tabular-nums ${
                  inputText.length >= 480 ? 'text-red-500' : 'text-slate-400'
                }`}
              >
                {inputText.length}/500
              </span>
            )}
          </div>

          {/* Send button — T5 */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            aria-label="Send message"
            className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={15} />
          </button>
        </div>

        <p className="mt-1.5 text-[10px] text-slate-400">
          Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
