/**
 * ConversationSwitcher — the multi-conversation history control (Phase 2 stage 5).
 *
 * A compact dropdown of past chats (switch / delete) + a "New chat" button, shown above the
 * transcript. Chai-dark styling per DESIGN.md: warm surfaces, saffron for the active marker,
 * error-red for delete. No violet (this is navigation chrome, not Gemini-generated content).
 */

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Plus, MessageSquare, Trash2, Check } from 'lucide-react'
import type { Conversation } from '../store/conversationsStore'

interface Props {
  conversations: Conversation[]
  activeId: string
  onSwitch: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function ConversationSwitcher({ conversations, activeId, onSwitch, onNew, onDelete }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = conversations.find((c) => c.id === activeId)

  // Close the dropdown on outside click or Escape.
  useEffect(() => {
    if (!open) return
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onMouse)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouse)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="flex items-center justify-between gap-2">
      <div ref={ref} className="relative min-w-0">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex items-center gap-1.5 max-w-[55vw] px-3 py-1.5 text-sm rounded-xl bg-[#2C2218] border border-[rgba(245,237,214,0.08)] text-[#C4A882] hover:text-[#F5EDD6] hover:border-[rgba(245,237,214,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E07B3A] transition-colors"
          aria-label="Switch conversation"
        >
          <MessageSquare size={14} className="flex-shrink-0 text-[#8B7D6B]" />
          <span className="truncate">{active?.title ?? 'Chat'}</span>
          <ChevronDown size={14} className="flex-shrink-0 text-[#8B7D6B]" />
        </button>

        {open && (
          <div className="absolute left-0 z-20 mt-1.5 w-72 max-h-80 overflow-y-auto bg-[#3D3025] border border-[rgba(245,237,214,0.12)] rounded-xl shadow-lg py-1.5">
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => {
                  onSwitch(c.id)
                  setOpen(false)
                }}
                className={`group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#4A3C2E] transition-colors ${
                  c.id === activeId ? 'text-[#F5EDD6]' : 'text-[#C4A882]'
                }`}
              >
                {c.id === activeId ? (
                  <Check size={13} className="flex-shrink-0 text-[#E07B3A]" />
                ) : (
                  <span className="w-[13px] flex-shrink-0" />
                )}
                <span className="flex-1 min-w-0 truncate text-sm">{c.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(c.id)
                  }}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-[#8B7D6B] hover:text-[#E05C5C] focus-visible:text-[#E05C5C] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E05C5C] rounded transition-opacity"
                  aria-label={`Delete conversation: ${c.title}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onNew}
        className="flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 text-sm font-medium rounded-xl bg-[#2C2218] border border-[rgba(245,237,214,0.08)] text-[#C4A882] hover:text-[#F5EDD6] hover:border-[#E07B3A]/40 transition-colors"
      >
        <Plus size={14} />
        New chat
      </button>
    </div>
  )
}
