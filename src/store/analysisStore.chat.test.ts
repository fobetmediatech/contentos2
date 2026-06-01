/**
 * Unit tests for analysisStore — coverage for the conversational actions added on
 * feat/conversational-agent:
 *
 *   startChat, setStatus, addMessage (50-message cap), setDiscoveredSeeds, setParsedIntent
 *   + the full chatting → discovering → confirming lifecycle
 *
 * Pure Zustand store — no mocking, no DOM.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useAnalysisStore } from './analysisStore'
import type { ChatMessage } from './analysisStore'

beforeEach(() => {
  useAnalysisStore.getState().reset()
})

function makeMsg(content: string, role: 'user' | 'assistant' = 'assistant'): ChatMessage {
  return { role, content, timestamp: Date.now(), type: 'text' }
}

describe('analysisStore — startChat', () => {
  it('transitions status to chatting', () => {
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().status).toBe('chatting')
  })

  it('resets conversationMessages', () => {
    useAnalysisStore.getState().addMessage(makeMsg('hello'))
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().conversationMessages).toHaveLength(0)
  })

  it('resets discoveredSeeds', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['handle1'])
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().discoveredSeeds).toHaveLength(0)
  })

  it('resets parsedIntent to null', () => {
    useAnalysisStore.getState().setParsedIntent({ needsClarification: true, question: 'What niche?' })
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().parsedIntent).toBeNull()
  })
})

describe('analysisStore — setStatus', () => {
  it('transitions to discovering', () => {
    useAnalysisStore.getState().startChat()
    useAnalysisStore.getState().setStatus('discovering')
    expect(useAnalysisStore.getState().status).toBe('discovering')
  })

  it('transitions to confirming', () => {
    useAnalysisStore.getState().setStatus('confirming')
    expect(useAnalysisStore.getState().status).toBe('confirming')
  })

  it('transitions to chatting', () => {
    useAnalysisStore.getState().setStatus('running')
    useAnalysisStore.getState().setStatus('chatting')
    expect(useAnalysisStore.getState().status).toBe('chatting')
  })
})

describe('analysisStore — addMessage', () => {
  it('appends a message to conversationMessages', () => {
    useAnalysisStore.getState().addMessage(makeMsg('Hi there'))
    expect(useAnalysisStore.getState().conversationMessages).toHaveLength(1)
    expect(useAnalysisStore.getState().conversationMessages[0].content).toBe('Hi there')
  })

  it('preserves message role and type', () => {
    const msg: ChatMessage = { role: 'user', content: 'Hello', timestamp: 1234, type: 'text' }
    useAnalysisStore.getState().addMessage(msg)
    const stored = useAnalysisStore.getState().conversationMessages[0]
    expect(stored.role).toBe('user')
    expect(stored.type).toBe('text')
  })

  it('appends options-type messages with options array', () => {
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'Pick a direction',
      timestamp: 1234,
      type: 'options',
      options: ['Option A', 'Option B'],
    }
    useAnalysisStore.getState().addMessage(msg)
    const stored = useAnalysisStore.getState().conversationMessages[0]
    expect(stored.type).toBe('options')
    expect(stored.options).toEqual(['Option A', 'Option B'])
  })

  it('caps at 50 messages — oldest messages are evicted', () => {
    // Add 55 messages — only the latest 50 should remain
    for (let i = 0; i < 55; i++) {
      useAnalysisStore.getState().addMessage(makeMsg(`msg-${i}`))
    }
    const messages = useAnalysisStore.getState().conversationMessages
    expect(messages).toHaveLength(50)
    // The first 5 (msg-0 through msg-4) should have been evicted
    expect(messages[0].content).toBe('msg-5')
    expect(messages[49].content).toBe('msg-54')
  })

  it('preserves all messages when under the 50-message cap', () => {
    for (let i = 0; i < 49; i++) {
      useAnalysisStore.getState().addMessage(makeMsg(`msg-${i}`))
    }
    expect(useAnalysisStore.getState().conversationMessages).toHaveLength(49)
  })
})

describe('analysisStore — setDiscoveredSeeds', () => {
  it('stores discovered seeds', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['handle1', 'handle2'])
    expect(useAnalysisStore.getState().discoveredSeeds).toEqual(['handle1', 'handle2'])
  })

  it('overwrites existing seeds', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['old'])
    useAnalysisStore.getState().setDiscoveredSeeds(['new1', 'new2'])
    expect(useAnalysisStore.getState().discoveredSeeds).toEqual(['new1', 'new2'])
  })

  it('stores empty array when discovery finds nothing', () => {
    useAnalysisStore.getState().setDiscoveredSeeds([])
    expect(useAnalysisStore.getState().discoveredSeeds).toHaveLength(0)
  })
})

describe('analysisStore — setParsedIntent', () => {
  it('stores a needsClarification intent', () => {
    const intent = { needsClarification: true as const, question: 'Which niche?' }
    useAnalysisStore.getState().setParsedIntent(intent)
    expect(useAnalysisStore.getState().parsedIntent).toEqual(intent)
  })

  it('stores a resolved intent', () => {
    const intent = {
      needsClarification: false as const,
      niche: 'food',
      location: 'Mumbai',
      knownHandles: [],
      depth: 'standard' as const,
      pipelineType: 'competitor' as const,
    }
    useAnalysisStore.getState().setParsedIntent(intent)
    expect(useAnalysisStore.getState().parsedIntent).toEqual(intent)
  })

  it('can be cleared back to null', () => {
    useAnalysisStore.getState().setParsedIntent({ needsClarification: true, question: 'Q' })
    useAnalysisStore.getState().setParsedIntent(null)
    expect(useAnalysisStore.getState().parsedIntent).toBeNull()
  })
})

describe('analysisStore — reset clears conversational fields', () => {
  it('clears conversationMessages on reset', () => {
    useAnalysisStore.getState().addMessage(makeMsg('hello'))
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().conversationMessages).toHaveLength(0)
  })

  it('clears discoveredSeeds on reset', () => {
    useAnalysisStore.getState().setDiscoveredSeeds(['h1'])
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().discoveredSeeds).toHaveLength(0)
  })

  it('clears parsedIntent on reset', () => {
    useAnalysisStore.getState().setParsedIntent({ needsClarification: true, question: 'Q' })
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().parsedIntent).toBeNull()
  })
})

describe('analysisStore — chatting → confirming lifecycle', () => {
  it('full flow: startChat → setStatus(discovering) → setDiscoveredSeeds → setStatus(confirming)', () => {
    // Always re-read getState() after each action — Zustand mutates store in place,
    // and the initially captured `store` reference is a stale snapshot.
    useAnalysisStore.getState().startChat()
    expect(useAnalysisStore.getState().status).toBe('chatting')

    useAnalysisStore.getState().setStatus('discovering')
    expect(useAnalysisStore.getState().status).toBe('discovering')

    useAnalysisStore.getState().setDiscoveredSeeds(['user1', 'user2'])
    expect(useAnalysisStore.getState().discoveredSeeds).toHaveLength(2)

    useAnalysisStore.getState().setStatus('confirming')
    expect(useAnalysisStore.getState().status).toBe('confirming')
  })

  it('0-seeds flow: setStatus back to chatting with error message', () => {
    useAnalysisStore.getState().startChat()
    useAnalysisStore.getState().setStatus('discovering')
    // 0 seeds found — back to chatting
    useAnalysisStore.getState().addMessage(makeMsg('Could not find accounts. Do you know any handles?'))
    useAnalysisStore.getState().setStatus('chatting')
    expect(useAnalysisStore.getState().status).toBe('chatting')
    expect(useAnalysisStore.getState().conversationMessages).toHaveLength(1)
  })
})

describe('analysisStore — candidateCount', () => {
  it('initialises to 0', () => {
    expect(useAnalysisStore.getState().candidateCount).toBe(0)
  })

  it('setResults persists candidateCount', () => {
    useAnalysisStore.getState().setResults(
      { competitors: [], niche: 'fitness', summary: 'test' },
      [],
      47,
    )
    expect(useAnalysisStore.getState().candidateCount).toBe(47)
  })

  it('reset clears candidateCount to 0', () => {
    useAnalysisStore.getState().setResults(
      { competitors: [], niche: 'fitness', summary: 'test' },
      [],
      23,
    )
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().candidateCount).toBe(0)
  })
})

describe('analysisStore — stepProgressDetail', () => {
  it('initialises to empty string', () => {
    expect(useAnalysisStore.getState().stepProgressDetail).toBe('')
  })

  it('reset clears stepProgressDetail', () => {
    useAnalysisStore.getState().setStepProgressDetail('Found 47 candidate accounts')
    useAnalysisStore.getState().reset()
    expect(useAnalysisStore.getState().stepProgressDetail).toBe('')
  })

  it('setStepProgressDetail persists the value until reset', () => {
    useAnalysisStore.getState().setStepProgressDetail('Found 23 candidate accounts')
    expect(useAnalysisStore.getState().stepProgressDetail).toBe('Found 23 candidate accounts')
  })
})
