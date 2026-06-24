/**
 * ChatMessage — renders a single conversation bubble.
 *
 * Variants:
 *   text     — plain text bubble (user or assistant)
 *   options  — assistant bubble + pill choices below (rendered by ChatOptions)
 *   error    — red bubble with retry affordance
 *
 * T12: animated typing indicator for 'discovering' state
 * T13: error bubble variant (warm danger tokens — rgba(224,92,92,…))
 * T15: Lucide Bot/User icon circles instead of emoji
 */

import { Bot, Check, Loader2, RefreshCw, Square, User } from 'lucide-react'
import { formatElapsed } from '../hooks/useElapsedTime'
import type { ChatMessage as ChatMessageType } from '../store/analysisStore'
import { STEP_LABELS } from '../store/analysisStore'
import { ChatOptions } from './ChatOptions'

interface ChatMessageProps {
  message: ChatMessageType
  onOptionSelect?: (option: string) => void
  /** If true, option buttons are disabled (analysis already fired) */
  optionsDisabled?: boolean
  /** Called when the user taps Retry on an error bubble. */
  onRetry?: () => void
}

export function ChatMessage({ message, onOptionSelect, optionsDisabled, onRetry }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isError = message.type === 'error'

  if (isUser) {
    return (
      <div className="flex items-end justify-end gap-2">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-[#E07B3A] text-white text-sm leading-relaxed">
          {message.content}
        </div>
        {/* T15: User icon circle */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-surface-raised flex items-center justify-center">
          <User size={14} className="text-secondary" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2">
      {/* T15: Bot icon circle */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center">
        <Bot size={14} className="text-[#E07B3A]" />
      </div>
      <div className="flex flex-col gap-2 max-w-[80%]">
        <div
          className={`px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed whitespace-pre-wrap ${
            isError
              ? 'bg-[rgba(224,92,92,0.1)] border border-[rgba(224,92,92,0.2)] text-danger'
              : 'bg-surface border border-[rgba(245,237,214,0.08)] text-primary'
          }`}
        >
          {/* Render bold markdown (**text**) in messages */}
          {renderContent(message.content)}
        </div>
        {/* T16: pill layout for options */}
        {/* AD1: "Quick picks:" label shown when confirming state is active (!optionsDisabled) */}
        {message.type === 'options' && message.options && onOptionSelect && (
          <ChatOptions
            options={message.options}
            onSelect={onOptionSelect}
            disabled={optionsDisabled}
            label={optionsDisabled ? undefined : 'Quick picks:'}
          />
        )}
        {isError && onRetry && (
          <button
            onClick={onRetry}
            className="self-start flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#E05C5C] border border-[rgba(224,92,92,0.25)] rounded-lg hover:bg-[rgba(224,92,92,0.08)] transition-colors"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * T12: Animated typing indicator — 3 pulsing dots.
 * Shown while status === 'discovering'.
 */
export function TypingIndicator() {
  return (
    <div className="flex items-end gap-2">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center">
        <Bot size={14} className="text-[#E07B3A]" />
      </div>
      <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-surface border border-[rgba(245,237,214,0.08)]">
        <div className="flex gap-1 items-center h-4">
          <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce" />
        </div>
      </div>
    </div>
  )
}

interface ProgressBubbleProps {
  /** Status label shown above the steps (e.g. "Analyzing competitors…") */
  label?: string
  /** Current active step (1-based). */
  currentStep: number
  /** Custom step labels. When omitted, uses competitor analysis STEP_LABELS. */
  steps?: string[]
  /** Called when the user taps Stop — aborts the current run. */
  onStop?: () => void
  /** Live seconds elapsed for the running pipeline — shown as an honest progress signal. */
  elapsedSec?: number
}

/**
 * ProgressBubble — inline progress tracker styled as a bot chat bubble.
 * Replaces the standalone centered progress block so pipeline state stays
 * in the same visual lane as the rest of the conversation.
 */
export function ProgressBubble({ label, currentStep, steps, onStop, elapsedSec }: ProgressBubbleProps) {
  const allLabels: Record<number, string> = steps
    ? Object.fromEntries(steps.map((l, i) => [i + 1, l]))
    : (STEP_LABELS as Record<number, string>)
  const stepCount = steps ? steps.length : Object.keys(STEP_LABELS).length
  const stepIndices = Array.from({ length: stepCount }, (_, i) => i + 1)

  return (
    <div className="flex items-start gap-2">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(224,123,58,0.12)] flex items-center justify-center mt-0.5">
        <Bot size={14} className="text-[#E07B3A]" />
      </div>
      <div className="flex flex-col gap-2 min-w-[220px] max-w-[80%]">
        {label && (
          <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm text-secondary leading-relaxed">
            {label}
          </div>
        )}
        <div role="status" aria-live="polite" className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] flex flex-col gap-2.5">
          {stepIndices.map((step) => {
            const isDone = step < currentStep
            const isActive = step === currentStep
            return (
              <div
                key={step}
                className={`flex items-center gap-2.5 transition-opacity ${!isDone && !isActive ? 'opacity-35' : ''}`}
              >
                <div
                  className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                    isDone
                      ? 'bg-[rgba(76,175,125,0.15)] text-success'
                      : isActive
                      ? 'bg-[#E07B3A] text-white'
                      : 'bg-surface-raised text-muted'
                  }`}
                >
                  {isDone ? (
                    <Check size={11} strokeWidth={2.5} />
                  ) : isActive ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    step
                  )}
                </div>
                <span
                  className={`text-sm ${
                    isActive ? 'text-primary font-medium' : isDone ? 'text-secondary' : 'text-muted'
                  }`}
                >
                  {allLabels[step] ?? `Step ${step}`}
                </span>
              </div>
            )
          })}
          {elapsedSec ? (
            <span className="self-start text-[11px] font-mono text-[#7A6A54] tabular-nums">{formatElapsed(elapsedSec)} elapsed</span>
          ) : null}
          {onStop && (
            <button
              onClick={onStop}
              className="self-start flex items-center gap-1.5 mt-1 px-3 py-1.5 text-xs text-muted border border-[rgba(245,237,214,0.10)] rounded-lg hover:text-secondary hover:border-[rgba(245,237,214,0.2)] transition-colors"
            >
              <Square size={10} />
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Render inline **bold** markdown in assistant messages. */
function renderContent(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  )
}
