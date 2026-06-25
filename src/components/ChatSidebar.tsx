// src/components/ChatSidebar.tsx
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, MessageSquare, Trash2, Menu, X } from 'lucide-react'
import type { Conversation } from '../store/conversationsStore'

const STORAGE_KEY = 'chat-sidebar-open'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSwitch: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function ChatSidebar({ conversations, activeId, onSwitch, onNew, onDelete }: Props) {
  // `open` = desktop collapse (≥md, persisted). `mobileOpen` = the <md off-canvas drawer.
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'false' } catch { return true }
  })
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(open)) } catch { /* unavailable */ }
  }, [open])

  // Full content shows on desktop when expanded, and inside the mobile drawer when open.
  // (When the mobile drawer is closed it's translated off-canvas, so its content is hidden anyway.)
  const showFull = open || mobileOpen

  return (
    <>
      {/* Mobile: hamburger to open the drawer (hidden on desktop and while the drawer is open) */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open chat history"
        className={`md:hidden fixed top-16 left-3 z-30 p-2 rounded-lg bg-[#2C2218] border border-[rgba(245,237,214,0.08)] text-[#C4A882] hover:text-[#F5EDD6] transition-colors shadow-lg ${mobileOpen ? 'hidden' : ''}`}
      >
        <Menu size={16} aria-hidden="true" />
      </button>

      {/* Mobile: backdrop behind the drawer */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar: fixed off-canvas drawer on mobile, in-flow column on desktop. */}
      <div
        className={`flex flex-col h-full bg-[#2C2218] border-r border-[rgba(245,237,214,0.08)] overflow-hidden
          fixed inset-y-0 left-0 z-50 w-[260px] transition-transform duration-[280ms] ease-in-out
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
          md:static md:z-auto md:translate-x-0 md:flex-shrink-0 md:transition-[width] ${open ? 'md:w-[220px]' : 'md:w-10'}`}
      >
        {showFull ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-3 pt-4 pb-2 flex-shrink-0">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#7A6A54]">
                Chats
              </span>
              {/* Desktop collapse */}
              <button
                onClick={() => setOpen(false)}
                className="hidden md:inline-flex p-1 rounded-lg text-[#7A6A54] hover:text-[#C4A882] hover:bg-[#3D3025] transition-colors"
                aria-label="Collapse sidebar"
              >
                <ChevronLeft size={14} aria-hidden="true" />
              </button>
              {/* Mobile close */}
              <button
                onClick={() => setMobileOpen(false)}
                className="md:hidden p-1 rounded-lg text-[#7A6A54] hover:text-[#C4A882] hover:bg-[#3D3025] transition-colors"
                aria-label="Close chat history"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            {/* New chat */}
            <div className="px-2 pb-2 flex-shrink-0">
              <button
                onClick={() => { onNew(); setMobileOpen(false) }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-[#C4A882] border border-[rgba(245,237,214,0.08)] hover:border-[#E07B3A]/40 hover:text-[#F5EDD6] hover:bg-[#3D3025] transition-colors"
              >
                <Plus size={14} className="flex-shrink-0 text-[#E07B3A]" aria-hidden="true" />
                <span>New chat</span>
              </button>
            </div>

            {/* Conversation list */}
            <div className="flex-1 overflow-y-auto px-2 pb-4">
              {conversations.map((c) => {
                const isActive = activeId != null && c.id === activeId
                return (
                  <div
                    key={c.id}
                    className={`group relative w-full flex items-center gap-2 px-3 py-2 rounded-xl transition-colors mb-0.5 ${
                      isActive
                        ? 'bg-[#3D3025] text-[#F5EDD6]'
                        : 'text-[#C4A882] hover:bg-[#3D3025] hover:text-[#F5EDD6]'
                    }`}
                  >
                    {/* Active indicator */}
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-[#E07B3A] rounded-full" />
                    )}
                    <button
                      onClick={() => { onSwitch(c.id); setMobileOpen(false) }}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E07B3A] rounded"
                    >
                      <MessageSquare size={13} className={`flex-shrink-0 ${isActive ? 'text-[#E07B3A]' : 'text-[#7A6A54]'}`} aria-hidden="true" />
                      <span className="flex-1 min-w-0 truncate text-sm">{c.title}</span>
                    </button>
                    <button
                      onClick={() => onDelete(c.id)}
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-[#7A6A54] hover:text-[#E05C5C] transition-opacity rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#E05C5C]"
                      aria-label={`Delete "${c.title}"`}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          /* Collapsed (desktop only): single expand button */
          <div className="flex flex-col items-center pt-4">
            <button
              onClick={() => setOpen(true)}
              className="p-2 rounded-lg text-[#7A6A54] hover:text-[#C4A882] hover:bg-[#3D3025] transition-colors"
              aria-label="Expand sidebar"
            >
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </>
  )
}
