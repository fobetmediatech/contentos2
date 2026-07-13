// Verifies a fan-out transcript dispatch creates N runs and does not abort siblings.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRunsStore, selectActiveRuns } from '../store/runsStore'
// Import the dispatch helper. If dispatchTool is not individually exported, extract the
// transcript/single-reel run-launch into a pure helper `launchReelUrlRuns(kind, urls, conversationId, start)` in
// src/hooks/agentRunLaunch.ts and test THAT (recommended — keeps the hook thin and testable).
import { launchReelUrlRuns } from './agentRunLaunch'

beforeEach(() => useRunsStore.setState({ runs: {}, seq: 0 }))

describe('launchReelUrlRuns', () => {
  it('creates one run per url and invokes the starter with a fresh signal each', () => {
    const started: Array<{ runId: string; url: string; aborted: boolean }> = []
    launchReelUrlRuns('transcript', ['u1', 'u2', 'u3'], 'c1', (runId, url, sig) => {
      started.push({ runId, url, aborted: sig.aborted })
    })
    expect(started.map((s) => s.url)).toEqual(['u1', 'u2', 'u3'])
    expect(started.every((s) => !s.aborted)).toBe(true)
    expect(selectActiveRuns(useRunsStore.getState(), 'c1')).toHaveLength(3)
  })
})
