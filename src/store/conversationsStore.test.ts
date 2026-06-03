/**
 * Tests for the conversations store — multi-conversation history (Phase 2 stage 5).
 *
 * Single source of truth: all chats live here keyed by id, with one activeId. The transcript
 * that used to live in analysisStore.conversationMessages is now the active conversation's
 * messages. Pure helpers (title derivation + sort) are tested in isolation; store behaviors
 * (add / new / switch / delete / cap) are driven through getState().
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useConversationsStore, deriveConversationTitle, sortConversations, migrateLegacyChat } from './conversationsStore'
import type { Conversation } from './conversationsStore'
import type { ChatMessage } from './analysisStore'

// A legacy `contentos-chat` persist envelope (zustand v0 shape): { state: { conversationMessages } }.
const legacyBlob = (messages: unknown[]) =>
  JSON.stringify({ state: { conversationMessages: messages }, version: 0 })

const freshStore = () => ({ conversations: { c1: { id: 'c1', title: 'New chat', messages: [], createdAt: 0, updatedAt: 0 } as Conversation } })

const msg = (content: string, role: 'user' | 'assistant' = 'user'): Omit<ChatMessage, 'id' | 'timestamp'> => ({
  role,
  content,
  type: 'text',
})

beforeEach(() => {
  useConversationsStore.getState().reset()
})

describe('deriveConversationTitle', () => {
  it('uses the first user message, truncated', () => {
    const m = [
      { id: '1', role: 'assistant', content: 'Hi! What can I research?', timestamp: 1, type: 'text' },
      { id: '2', role: 'user', content: 'Top fitness creators like @nike.training in a really long sentence that keeps going', timestamp: 2, type: 'text' },
    ] as ChatMessage[]
    const t = deriveConversationTitle(m)
    expect(t.startsWith('Top fitness creators')).toBe(true)
    expect(t.length).toBeLessThanOrEqual(40)
  })

  it('falls back to "New chat" when there is no user message yet', () => {
    expect(deriveConversationTitle([])).toBe('New chat')
    expect(
      deriveConversationTitle([{ id: '1', role: 'assistant', content: 'hello', timestamp: 1, type: 'text' }] as ChatMessage[]),
    ).toBe('New chat')
  })
})

describe('sortConversations', () => {
  it('orders by updatedAt, most-recent first', () => {
    const conv = (id: string, updatedAt: number): Conversation => ({ id, title: id, messages: [], createdAt: 0, updatedAt })
    const sorted = sortConversations({ a: conv('a', 100), b: conv('b', 300), c: conv('c', 200) })
    expect(sorted.map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('migrateLegacyChat', () => {
  it('adopts a legacy transcript into a conversation when the store is fresh', () => {
    const messages = [
      { id: 'm1', role: 'user', content: 'Find vegan chefs in Pune', timestamp: 100, type: 'text' },
      { id: 'm2', role: 'assistant', content: 'On it!', timestamp: 200, type: 'text' },
    ]
    const conv = migrateLegacyChat(legacyBlob(messages), freshStore())
    expect(conv).not.toBeNull()
    expect(conv!.messages).toHaveLength(2)
    expect(conv!.title.startsWith('Find vegan chefs')).toBe(true)
    expect(conv!.createdAt).toBe(100) // first message timestamp
    expect(conv!.updatedAt).toBe(200) // last message timestamp
  })

  it('returns null when there is nothing to migrate', () => {
    expect(migrateLegacyChat(null, freshStore())).toBeNull()
    expect(migrateLegacyChat('not json{', freshStore())).toBeNull()
    expect(migrateLegacyChat(legacyBlob([]), freshStore())).toBeNull()
  })

  it('never clobbers real post-refactor history', () => {
    const messages = [{ id: 'm1', role: 'user', content: 'old chat', timestamp: 1, type: 'text' }]
    const storeWithHistory = {
      conversations: {
        c1: { id: 'c1', title: 'Active', messages: [{ id: 'x', role: 'user', content: 'new', timestamp: 9, type: 'text' }] as ChatMessage[], createdAt: 0, updatedAt: 9 },
      },
    }
    expect(migrateLegacyChat(legacyBlob(messages), storeWithHistory)).toBeNull()
  })
})

describe('conversationsStore', () => {
  it('starts with a single active empty conversation', () => {
    const s = useConversationsStore.getState()
    expect(Object.keys(s.conversations)).toHaveLength(1)
    expect(s.conversations[s.activeId].messages).toEqual([])
  })

  it('addMessage appends to the active conversation', () => {
    useConversationsStore.getState().addMessage(msg('hello there'))
    const s = useConversationsStore.getState()
    expect(s.conversations[s.activeId].messages).toHaveLength(1)
    expect(s.conversations[s.activeId].messages[0].content).toBe('hello there')
    expect(s.conversations[s.activeId].messages[0].id).toBeTruthy() // id assigned
  })

  it('addMessageTo appends to a SPECIFIC conversation even when it is not the active one', () => {
    // Reel snapshots land in the conversation the run started in, not wherever the user
    // has since navigated — addMessageTo targets that conversation explicitly.
    useConversationsStore.getState().addMessage(msg('chat A'))
    const a = useConversationsStore.getState().activeId
    useConversationsStore.getState().startNew()
    const b = useConversationsStore.getState().activeId // active is now B

    useConversationsStore.getState().addMessageTo(a, msg('snapshot into A', 'assistant'))
    const s = useConversationsStore.getState()
    expect(s.activeId).toBe(b) // active conversation unchanged
    expect(s.conversations[a].messages.map((m) => m.content)).toEqual(['chat A', 'snapshot into A'])
    expect(s.conversations[b].messages).toEqual([]) // B untouched
  })

  it('addMessageTo is a no-op when the target conversation no longer exists', () => {
    useConversationsStore.getState().addMessageTo('deleted-id', msg('orphan'))
    const s = useConversationsStore.getState()
    expect(s.conversations[s.activeId].messages).toEqual([])
  })

  it('auto-titles the active conversation from the first user message', () => {
    useConversationsStore.getState().addMessage(msg('What can you do?', 'assistant'))
    useConversationsStore.getState().addMessage(msg('Find vegan chefs in Pune', 'user'))
    const s = useConversationsStore.getState()
    expect(s.conversations[s.activeId].title.startsWith('Find vegan chefs')).toBe(true)
  })

  it('startNew creates a fresh active conversation, keeping the old one', () => {
    useConversationsStore.getState().addMessage(msg('first chat'))
    const firstId = useConversationsStore.getState().activeId
    useConversationsStore.getState().startNew()
    const s = useConversationsStore.getState()
    expect(s.activeId).not.toBe(firstId)
    expect(Object.keys(s.conversations)).toHaveLength(2)
    expect(s.conversations[s.activeId].messages).toEqual([])
    expect(s.conversations[firstId].messages[0].content).toBe('first chat')
  })

  it('startNew is a no-op when the active conversation is already empty', () => {
    const firstId = useConversationsStore.getState().activeId
    useConversationsStore.getState().startNew()
    expect(useConversationsStore.getState().activeId).toBe(firstId)
    expect(Object.keys(useConversationsStore.getState().conversations)).toHaveLength(1)
  })

  it('switchTo changes the active conversation; new messages go to it', () => {
    useConversationsStore.getState().addMessage(msg('chat A'))
    const a = useConversationsStore.getState().activeId
    useConversationsStore.getState().startNew()
    useConversationsStore.getState().addMessage(msg('chat B'))
    const b = useConversationsStore.getState().activeId

    useConversationsStore.getState().switchTo(a)
    expect(useConversationsStore.getState().activeId).toBe(a)
    useConversationsStore.getState().addMessage(msg('back in A'))
    const s = useConversationsStore.getState()
    expect(s.conversations[a].messages.map((m) => m.content)).toEqual(['chat A', 'back in A'])
    expect(s.conversations[b].messages.map((m) => m.content)).toEqual(['chat B'])
  })

  it('deleting the active conversation switches to the most recent remaining', () => {
    useConversationsStore.getState().addMessage(msg('chat A'))
    const a = useConversationsStore.getState().activeId
    useConversationsStore.getState().startNew()
    useConversationsStore.getState().addMessage(msg('chat B'))
    const b = useConversationsStore.getState().activeId

    useConversationsStore.getState().deleteConversation(b)
    const s = useConversationsStore.getState()
    expect(s.conversations[b]).toBeUndefined()
    expect(s.activeId).toBe(a)
  })

  it('deleting the last conversation leaves a fresh empty active one', () => {
    const only = useConversationsStore.getState().activeId
    useConversationsStore.getState().deleteConversation(only)
    const s = useConversationsStore.getState()
    expect(Object.keys(s.conversations)).toHaveLength(1)
    expect(s.conversations[s.activeId].messages).toEqual([])
  })

  it('caps each conversation at 50 messages', () => {
    for (let i = 0; i < 60; i++) useConversationsStore.getState().addMessage(msg(`m${i}`))
    const s = useConversationsStore.getState()
    expect(s.conversations[s.activeId].messages).toHaveLength(50)
    expect(s.conversations[s.activeId].messages[49].content).toBe('m59') // newest kept
  })
})
