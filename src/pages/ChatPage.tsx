/**
 * ChatPage — conversational entry point for the analysis pipeline.
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
 * T-routing: watches discoveryStore.status to navigate to /discover/progress when
 *   location discovery pipeline fires; resets discoveryStore on mount if done/error
 *   to prevent re-navigation from a previous run.
 */

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Bot, Send } from 'lucide-react'
import { useAnalysisStore } from '../store/analysisStore'
import { useDiscoveryStore } from '../store/discoveryStore'
import { useKeysStore } from '../store/keysStore'
import { useConversation } from '../hooks/useConversation'
import { ChatMessage, TypingIndicator } from '../components/ChatMessage'

const EXAMPLE_PROMPTS = [
  'Indian food bloggers in Mumbai',
  'Fitness creators focused on women',
  'Personal finance influencers in Delhi',
]

export function ChatPage() {
  const navigate = useNavigate()
  const analysisStore = useAnalysisStore()
  const { status, conversationMessages, startChat, reset } = analysisStore
  const discoveryStatus = useDiscoveryStore((s) => s.status)
  const resetDiscovery = useDiscoveryStore((s) => s.reset)
  const { isReady } = useKeysStore()
  const { sendMessage, confirmSeeds } = useConversation()

  const [inputText, setInputText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const ready = isReady()
  const canSend = status === 'chatting' && inputText.trim().length > 0 && ready

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

  // Mount reset: if a prior discovery run is in any non-idle state, clear it so we
  // don't immediately navigate to /discover/progress (done/running) or get stuck with
  // a locked confirming UI. 'error' is intentionally excluded here — the error-recovery
  // effect below handles that case with proper error surfacing.
  useEffect(() => {
    if (discoveryStatus === 'done' || discoveryStatus === 'running' || discoveryStatus === 'confirming') {
      resetDiscovery()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Navigate to progress page when competitor analysis pipeline starts
  useEffect(() => {
    if (status === 'running') {
      navigate('/progress')
    }
  }, [status, navigate])

  // Navigate to discovery progress when location discovery pipeline starts
  useEffect(() => {
    if (discoveryStatus === 'running') {
      navigate('/discover/progress')
    }
  }, [discoveryStatus, navigate])

  // Recover from a failed discovery — surface as chat error message, then reset
  useEffect(() => {
    if (discoveryStatus === 'error') {
      const errMsg = useDiscoveryStore.getState().error ?? 'Discovery failed — please try again.'
      analysisStore.addMessage({ role: 'assistant', content: errMsg, timestamp: Date.now(), type: 'error' })
      analysisStore.setStatus('chatting')
      resetDiscovery()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryStatus, resetDiscovery])

  // Scroll to bottom whenever messages change or typing indicator appears
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversationMessages, status])

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

  const hasMessages = conversationMessages.length > 0
  const isDiscovering = status === 'discovering'

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
        {!hasMessages ? (
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
          // T17: messages pushed to bottom via flex spacer
          <div className="min-h-full flex flex-col px-4 pt-4 pb-2">
            {/* Spacer pushes content toward the bottom */}
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
                  optionsDisabled={status !== 'confirming'}
                />
              ))}

              {/* T12: animated typing indicator while discovering */}
              {isDiscovering && <TypingIndicator />}
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
                status === 'discovering'
                  ? 'Searching for accounts…'
                  : status === 'confirming'
                  ? 'Select an option above to continue…'
                  : 'Describe a niche, location, or paste handles…'
              }
              maxLength={500}
              rows={1}
              // T5: disabled when not in chatting state
              disabled={status !== 'chatting'}
              aria-label="Message input"
              className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none disabled:bg-slate-50 disabled:text-slate-400 leading-relaxed"
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
