/**
 * Conversations store — multi-conversation history (Phase 2 stage 5).
 *
 * Single source of truth for the chat transcript: every conversation lives here keyed by id,
 * with one `activeId`. What used to be analysisStore.conversationMessages is now just the
 * active conversation's `messages`. analysisStore keeps ONLY analysis state (status,
 * competitors, …); the transcript moved here so chats can be listed, switched, and deleted.
 *
 * Persisted under `contentos-conversations` via the import-safe storage wrapper.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabaseStorage } from './supabaseStorage'
import type { ChatMessage } from './analysisStore'

export interface Conversation {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

const TITLE_MAX = 40
const MESSAGE_CAP = 50

/** Title a conversation from its first user message (truncated), else "New chat". */
export function deriveConversationTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return 'New chat'
  const t = firstUser.content.trim()
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t
}

/** Conversations as a list, most-recently-updated first (for the switcher). */
export function sortConversations(conversations: Record<string, Conversation>): Conversation[] {
  return Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt)
}

// Monotonic id sequence with a per-load epoch — same approach as analysisStore, so ids stay
// unique across reloads even though the seq resets to 0 each load.
let _seq = 0
const _epoch = Date.now().toString(36)
const nextId = (prefix: string) => `${prefix}-${_epoch}-${_seq++}`

function freshConversation(): Conversation {
  const now = Date.now()
  return { id: nextId('conv'), title: 'New chat', messages: [], createdAt: now, updatedAt: now }
}

function makeInitial(): { conversations: Record<string, Conversation>; activeId: string } {
  const c = freshConversation()
  return { conversations: { [c.id]: c }, activeId: c.id }
}

// ----- Legacy single-chat migration -----
// Before multi-conversation history, the transcript lived in analysisStore.conversationMessages.
// The pure helpers below are kept (exported + tested) even though the one-time localStorage
// migration hook was removed with the cloud-first storage swap.

/** Wrap a legacy transcript into a Conversation. Timestamps derive from the messages themselves
 *  (deterministic — no Date.now()), so a migrated chat sorts where it actually happened. */
export function buildMigratedConversation(messages: ChatMessage[]): Conversation {
  const createdAt = messages[0]?.timestamp ?? 0
  const updatedAt = messages[messages.length - 1]?.timestamp ?? createdAt
  return {
    id: nextId('conv'),
    title: deriveConversationTitle(messages),
    messages: messages.slice(-MESSAGE_CAP),
    createdAt,
    updatedAt,
  }
}

/**
 * Decide whether to migrate the legacy `contentos-chat` blob. Pure + testable: returns a fresh
 * Conversation to adopt, or null when there's nothing to migrate — no/invalid legacy data, an
 * empty transcript, or the user already has real post-refactor history (never clobber it).
 */
export function migrateLegacyChat(
  legacyRaw: string | null,
  current: { conversations: Record<string, Conversation> },
): Conversation | null {
  if (!legacyRaw) return null
  let messages: unknown
  try {
    messages = (JSON.parse(legacyRaw) as { state?: { conversationMessages?: unknown } })?.state?.conversationMessages
  } catch {
    return null // corrupt blob — ignore
  }
  if (!Array.isArray(messages) || messages.length === 0) return null
  // Only seed when the store is at its fresh default (all conversations empty). If the user has
  // chatted since the refactor, the legacy transcript is stale — leave their history untouched.
  if (Object.values(current.conversations).some((c) => c.messages.length > 0)) return null
  return buildMigratedConversation(messages as ChatMessage[])
}

interface ConversationsState {
  conversations: Record<string, Conversation>
  activeId: string
  /** Append a message to the active conversation (assigns id + timestamp, caps at 50). */
  addMessage: (message: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => void
  /** Append to a SPECIFIC conversation — e.g. snapshot a reel run into the chat it started in,
   *  even if the user has since switched away. No-op if that conversation no longer exists. */
  addMessageTo: (
    conversationId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: number },
  ) => void
  /** Start a fresh conversation (no-op when the active one is already empty). */
  startNew: () => void
  switchTo: (id: string) => void
  deleteConversation: (id: string) => void
  renameActive: (title: string) => void
  reset: () => void
}

export const useConversationsStore = create<ConversationsState>()(persist((set, get) => ({
  ...makeInitial(),

  addMessageTo: (conversationId, message) =>
    set((state) => {
      const conv = state.conversations[conversationId]
      if (!conv) return {}
      const msg: ChatMessage = {
        ...message,
        id: message.id ?? nextId('msg'),
        timestamp: message.timestamp ?? Date.now(),
      }
      const messages = [...conv.messages, msg].slice(-MESSAGE_CAP)
      // Auto-title from the first user message; once titled (or renamed) it sticks.
      const title = conv.title === 'New chat' ? deriveConversationTitle(messages) : conv.title
      return {
        conversations: {
          ...state.conversations,
          [conv.id]: { ...conv, messages, title, updatedAt: Date.now() },
        },
      }
    }),

  addMessage: (message) => get().addMessageTo(get().activeId, message),

  startNew: () =>
    set((state) => {
      const active = state.conversations[state.activeId]
      if (active && active.messages.length === 0) return {} // already on a blank chat
      const c = freshConversation()
      return { conversations: { ...state.conversations, [c.id]: c }, activeId: c.id }
    }),

  switchTo: (id) => set((state) => (state.conversations[id] ? { activeId: id } : {})),

  deleteConversation: (id) =>
    set((state) => {
      if (!state.conversations[id]) return {}
      const rest = { ...state.conversations }
      delete rest[id]
      if (id !== state.activeId) return { conversations: rest }
      // Deleting the active conversation: fall back to the most-recent remaining, or a fresh
      // blank when none are left (the chat is never without an active conversation).
      const remaining = sortConversations(rest)
      if (remaining.length === 0) return makeInitial()
      return { conversations: rest, activeId: remaining[0].id }
    }),

  renameActive: (title) =>
    set((state) => {
      const active = state.conversations[state.activeId]
      if (!active) return {}
      return { conversations: { ...state.conversations, [active.id]: { ...active, title } } }
    }),

  reset: () => set(makeInitial()),
}), {
  name: 'contentos-conversations',
  storage: supabaseStorage,
  skipHydration: true,
  partialize: (s) => ({ conversations: s.conversations, activeId: s.activeId }),
  version: 1,
  // Identity migration for v1 — any future schema change adds a numbered case here.
  migrate: (state) => state,
}))
