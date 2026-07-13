/**
 * I1 regression: abandoning a clarifying competitor run (via freshenAnalysis / conversation
 * switch) must remove it from the runs registry.
 *
 * Before the fix, freshenAnalysis() called startChat() which transitioned the analysis status
 * from 'clarifying' → 'chatting' — a non-terminal state. The competitor done/error cleanup
 * effect only fires on 'done' | 'error', so the run was never removed. The cockpit pane
 * stayed visible with "Waiting for your answer…" but no ClarificationCard — a zombie pane.
 *
 * Fix: freshenAnalysis now reads competitorRunConversationId from the analysis store and
 * removes any live competitor run BEFORE calling startChat().
 *
 * Test strategy: replicate the freshenAnalysis logic (competitor-run removal + startChat +
 * resetDiscovery) in a pure helper and assert the registry state.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRunOfKind } from './runsStore'
import { useAnalysisStore } from './analysisStore'
import { disposeController } from '../lib/runControllers'

// ---- mirror of freshenAnalysis from ChatPage (post I1 fix) ----
function freshenAnalysis(activeConversationId: string): void {
  const competitorConvId =
    useAnalysisStore.getState().runConversationId ?? activeConversationId
  const abandonedCompRun = selectActiveRunOfKind(
    useRunsStore.getState(),
    'competitor',
    competitorConvId,
  )
  if (abandonedCompRun) {
    useRunsStore.getState().removeRun(abandonedCompRun.id)
    disposeController(abandonedCompRun.id)
  }
  useAnalysisStore.getState().startChat()
}

beforeEach(() => {
  useRunsStore.setState({ runs: {}, seq: 0 })
  useAnalysisStore.setState({ status: 'chatting', runConversationId: null } as Parameters<typeof useAnalysisStore.setState>[0])
})

describe('I1 regression — freshenAnalysis removes live competitor run', () => {
  it('removes a clarifying competitor run when freshenAnalysis is called', () => {
    // Simulate a competitor run that is live (status: clarifying in the analysis store)
    useAnalysisStore.setState({ status: 'clarifying', runConversationId: 'conv-A' } as Parameters<typeof useAnalysisStore.setState>[0])
    useRunsStore.getState().createRun({
      conversationId: 'conv-A',
      kind: 'competitor',
      targetLabel: 'foodie.sg',
      progress: 'Waiting for your answer…',
    })

    // Verify it exists before the call
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'competitor', 'conv-A')).toBeDefined()

    freshenAnalysis('conv-A')

    // After freshenAnalysis, the competitor run must be gone
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'competitor', 'conv-A')).toBeUndefined()
    // And the analysis status is reset to chatting
    expect(useAnalysisStore.getState().status).toBe('chatting')
  })

  it('does nothing when no competitor run is live (safe no-op)', () => {
    useAnalysisStore.setState({ status: 'chatting', runConversationId: null } as Parameters<typeof useAnalysisStore.setState>[0])

    // No runs created — should not throw
    expect(() => freshenAnalysis('conv-B')).not.toThrow()
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'competitor', 'conv-B')).toBeUndefined()
  })

  it('targets the run in the competitor run conversation, not the active conversation', () => {
    // Competitor run started in conv-A, user has since switched to conv-B
    useAnalysisStore.setState({ status: 'clarifying', runConversationId: 'conv-A' } as Parameters<typeof useAnalysisStore.setState>[0])
    useRunsStore.getState().createRun({
      conversationId: 'conv-A',
      kind: 'competitor',
      targetLabel: 'foodie.sg',
      progress: 'Waiting for your answer…',
    })

    // activeConversationId is now conv-B (user switched away)
    freshenAnalysis('conv-B')

    // Run in conv-A (where it actually lives) must be removed
    expect(selectActiveRunOfKind(useRunsStore.getState(), 'competitor', 'conv-A')).toBeUndefined()
  })
})
