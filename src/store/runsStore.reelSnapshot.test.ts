/**
 * C1 regression: two consecutive agent-driven reel runs must BOTH produce snapshot messages.
 *
 * Before the fix, snapshotCurrentReelRun was guarded by a boolean ref (reelSnapshotFiredRef)
 * that was reset ONLY in launchReelAnalysis. The agent-loop `analyze_reels` path bypasses
 * launchReelAnalysis, so run #2's snapshot silently no-op'd — the ref was still true from run #1.
 *
 * Fix: the boolean ref was removed. Per-run dedup is now guaranteed by the terminal-cleanup
 * effect's `if (!run) return` + removeRun pattern. Once a run is removed, the effect no-ops for
 * it. This test asserts that invariant directly — two runs, both fully snapshotted.
 *
 * Test strategy: extract the core snapshot logic (reads reelAnalysisStore + writes to
 * conversationsStore) into a pure helper so it can be tested without a React component.
 * The helper mirrors what snapshotCurrentReelRun + the terminal-cleanup effect does in ChatPage.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRunOfKind } from './runsStore'
import { useReelAnalysisStore } from './reelAnalysisStore'
import { useConversationsStore } from './conversationsStore'
import { buildReelResultPayload } from '../lib/reelSnapshot'
import type { ChatMessage } from '../domain/chat'

type AddMessageTo = (
  conversationId: string,
  message: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string; timestamp?: number },
) => void

// ---- mirror of ChatPage.snapshotCurrentReelRun (no boolean ref guard) ----
function snapshotCurrentReelRun(addMessageTo: AddMessageTo): void {
  const s = useReelAnalysisStore.getState()
  const terminal = s.synthesisStatus === 'done' || s.synthesisStatus === 'failed'
  if (!s.reelConversationId || s.activeHandles.length === 0 || !terminal) return
  addMessageTo(s.reelConversationId, {
    role: 'assistant',
    type: 'result',
    content: `Reel breakdown for ${s.activeHandles.map((h) => `@${h}`).join(', ')}.`,
    result: buildReelResultPayload({
      handles: s.activeHandles,
      creatorStates: s.creatorStates,
      synthesis: s.synthesis,
    }),
  })
}

// ---- mirror of the terminal-cleanup effect body ----
function terminalCleanupEffect(
  synthesisStatus: string,
  reelConversationId: string | null,
  activeConversationId: string,
  addMessageTo: AddMessageTo,
): void {
  if (synthesisStatus !== 'done' && synthesisStatus !== 'failed') return
  const targetId = reelConversationId ?? activeConversationId
  const run = selectActiveRunOfKind(useRunsStore.getState(), 'reel', targetId)
  if (!run) return
  snapshotCurrentReelRun(addMessageTo)
  useRunsStore.getState().removeRun(run.id)
}

beforeEach(() => {
  useRunsStore.setState({ runs: {}, seq: 0 })
  useReelAnalysisStore.setState({
    activeHandles: [],
    reelConversationId: null,
    synthesisStatus: 'idle',
    synthesis: null,
    creatorStates: {},
    synthesisError: null,
    selectedHandles: [],
  })
  // Seed one conversation so addMessageTo has somewhere to write.
  const now = Date.now()
  useConversationsStore.setState({
    conversations: {
      'conv-A': { id: 'conv-A', title: 'Test', messages: [], createdAt: now, updatedAt: now },
    },
    activeId: 'conv-A',
  })
})

describe('C1 regression — consecutive reel runs both produce snapshot messages', () => {
  it('run #1 snapshots into the conversation message list', () => {
    // Simulate run #1 created
    useRunsStore.getState().createRun({ conversationId: 'conv-A', kind: 'reel', targetLabel: '@alice', progress: 'Scraping…' })

    // Simulate run #1 complete: set reel store to terminal state
    useReelAnalysisStore.setState({
      activeHandles: ['alice'],
      reelConversationId: 'conv-A',
      synthesisStatus: 'done',
      synthesis: null,
      creatorStates: { alice: { handle: 'alice', status: 'done', reels: [], analyses: {} } },
    })

    const addMessageTo = useConversationsStore.getState().addMessageTo

    // Fire the terminal-cleanup effect for run #1
    terminalCleanupEffect('done', 'conv-A', 'conv-A', addMessageTo)

    const msgs = useConversationsStore.getState().conversations['conv-A'].messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].type).toBe('result')
    expect(msgs[0].result?.kind).toBe('reel')
  })

  it('run #2 ALSO snapshots — not suppressed by run #1 (C1 fix)', () => {
    const addMessageTo = useConversationsStore.getState().addMessageTo

    // --- Run #1 ---
    useRunsStore.getState().createRun({ conversationId: 'conv-A', kind: 'reel', targetLabel: '@alice', progress: 'Scraping…' })
    useReelAnalysisStore.setState({
      activeHandles: ['alice'],
      reelConversationId: 'conv-A',
      synthesisStatus: 'done',
      synthesis: null,
      creatorStates: { alice: { handle: 'alice', status: 'done', reels: [], analyses: {} } },
    })
    terminalCleanupEffect('done', 'conv-A', 'conv-A', addMessageTo)

    // After run #1, the run is removed from registry
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'reel', 'conv-A')).toBeUndefined()

    // --- Run #2 (agent-driven — does NOT go through launchReelAnalysis) ---
    useRunsStore.getState().createRun({ conversationId: 'conv-A', kind: 'reel', targetLabel: '@bob', progress: 'Scraping…' })
    useReelAnalysisStore.setState({
      activeHandles: ['bob'],
      reelConversationId: 'conv-A',
      synthesisStatus: 'done',
      synthesis: null,
      creatorStates: { bob: { handle: 'bob', status: 'done', reels: [], analyses: {} } },
    })
    terminalCleanupEffect('done', 'conv-A', 'conv-A', addMessageTo)

    const msgs = useConversationsStore.getState().conversations['conv-A'].messages
    // Both runs must have produced a snapshot — NOT just one
    expect(msgs).toHaveLength(2)
    expect(msgs[0].type).toBe('result')
    expect(msgs[1].type).toBe('result')
    // Second snapshot must be for bob (not alice again)
    expect(msgs[1].content).toContain('@bob')
  })

  it('does not double-snapshot the same run (termination guard remains intact)', () => {
    const addMessageTo = useConversationsStore.getState().addMessageTo

    useRunsStore.getState().createRun({ conversationId: 'conv-A', kind: 'reel', targetLabel: '@alice', progress: 'Scraping…' })
    useReelAnalysisStore.setState({
      activeHandles: ['alice'],
      reelConversationId: 'conv-A',
      synthesisStatus: 'done',
      synthesis: null,
      creatorStates: { alice: { handle: 'alice', status: 'done', reels: [], analyses: {} } },
    })

    // Fire the effect twice for the same synthesisStatus (e.g. StrictMode double-fire)
    terminalCleanupEffect('done', 'conv-A', 'conv-A', addMessageTo)
    terminalCleanupEffect('done', 'conv-A', 'conv-A', addMessageTo) // second fire: run is already removed

    const msgs = useConversationsStore.getState().conversations['conv-A'].messages
    // Only one message — the registry-level dedup prevents double-snapshot
    expect(msgs).toHaveLength(1)
  })
})
