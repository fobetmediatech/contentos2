/**
 * ChatMessage — renders a single conversation bubble.
 *
 * Variants:
 *   text     — plain text bubble (user or assistant)
 *   options  — assistant bubble + pill choices below (rendered by ChatOptions)
 *   error    — red bubble with retry affordance
 *
 * T12: animated typing indicator for 'discovering' state
 * T13: error bubble variant (bg-red-50 border-red-200)
 * T15: Lucide Bot/User icon circles instead of emoji
 */

import { Bot, User } from 'lucide-react'
import type { ChatMessage as ChatMessageType } from '../store/analysisStore'
import { ChatOptions } from './ChatOptions'

interface ChatMessageProps {
  message: ChatMessageType
  onOptionSelect?: (option: string) => void
  /** If true, option buttons are disabled (analysis already fired) */
  optionsDisabled?: boolean
}

export function ChatMessage({ message, onOptionSelect, optionsDisabled }: ChatMessageProps) {
  const isUser = message.role === 'user'
  const isError = message.type === 'error'

  if (isUser) {
    return (
      <div className="flex items-end justify-end gap-2">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-sm bg-indigo-600 text-white text-sm leading-relaxed">
          {message.content}
        </div>
        {/* T15: User icon circle */}
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
          <User size={14} className="text-slate-500" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2">
      {/* T15: Bot icon circle */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
        <Bot size={14} className="text-indigo-600" />
      </div>
      <div className="flex flex-col gap-2 max-w-[80%]">
        <div
          className={`px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed ${
            isError
              ? 'bg-red-50 border border-red-200 text-red-800'  // T13: error variant
              : 'bg-white border border-slate-200 text-slate-800'
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
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
        <Bot size={14} className="text-indigo-600" />
      </div>
      <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-white border border-slate-200">
        <div className="flex gap-1 items-center h-4">
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
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
