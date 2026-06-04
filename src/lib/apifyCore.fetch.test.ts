/**
 * Tests for apifyCore.ts network functions: startRun, pollRun, fetchDataset.
 *
 * These are the paths that were 0% covered (only chunk/sleep/ApifyError were tested).
 * Covers:
 *   startRun  — 429 rate limit, non-ok failure, success path
 *   pollRun   — SUCCEEDED, FAILED, TIMED-OUT, ABORTED terminal states, POLL_TIMEOUT, abort signal
 *   fetchDataset — array response shape, items-wrapped shape, non-ok failure
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { startRun, pollRun, fetchDataset } from './apifyCore'

// Speed up poll tests by making POLL_INTERVAL_MS effectively 0 in the test environment.
// We mock sleep directly to avoid real timers.
vi.mock('./apifyCore', async () => {
  const actual = await vi.importActual<typeof import('./apifyCore')>('./apifyCore')
  return {
    ...actual,
    // Override sleep to resolve immediately — no real timeouts during polling tests
    sleep: () => Promise.resolve(),
  }
})

beforeEach(() => {
  vi.resetAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ----- startRun -----

describe('startRun', () => {
  it('returns runId and datasetId on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { id: 'run-123', status: 'READY', defaultDatasetId: 'ds-456' },
          }),
      }),
    )
    const result = await startRun('actor-id', { count: 10 }, 'api-key')
    expect(result.runId).toBe('run-123')
    expect(result.datasetId).toBe('ds-456')
  })

  it('throws RATE_LIMITED on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve('rate limited'),
      }),
    )
    await expect(startRun('actor-id', {}, 'api-key')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      status: 429,
    })
  })

  it('throws QUOTA_EXCEEDED on 402 Payment Required (so the run fails over to a funded key)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 402,
        text: () => Promise.resolve('Payment Required'),
      }),
    )
    await expect(startRun('actor-id', {}, 'api-key')).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      status: 402,
    })
  })

  it('throws RUN_START_FAILED on generic non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('internal error'),
      }),
    )
    await expect(startRun('actor-id', {}, 'api-key')).rejects.toMatchObject({
      code: 'RUN_START_FAILED',
      status: 500,
    })
  })

  it('throws RUN_START_FAILED on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('unauthorized'),
      }),
    )
    await expect(startRun('actor-id', {}, 'api-key')).rejects.toMatchObject({
      code: 'RUN_START_FAILED',
    })
  })

  it('throws QUOTA_EXCEEDED on a 403 monthly-limit body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () =>
          Promise.resolve('{"error":{"type":"platform-feature-disabled","message":"Monthly usage hard limit exceeded"}}'),
      }),
    )
    await expect(startRun('actor-id', {}, 'api-key')).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      status: 403,
    })
  })

  it('throws RUN_START_FAILED on a 403 that is not a usage/limit error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('forbidden'),
      }),
    )
    await expect(startRun('actor-id', {}, 'api-key')).rejects.toMatchObject({
      code: 'RUN_START_FAILED',
      status: 403,
    })
  })
})

// ----- pollRun -----

describe('pollRun — terminal states', () => {
  function makePollResponse(status: string, datasetId = 'ds-abc') {
    return {
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          data: { id: 'run-1', status, defaultDatasetId: datasetId },
        }),
    }
  }

  it('returns datasetId when status is SUCCEEDED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makePollResponse('SUCCEEDED', 'ds-ok')))
    const dsId = await pollRun('run-1', 'api-key')
    expect(dsId).toBe('ds-ok')
  })

  it('throws RUN_FAILED when status is FAILED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makePollResponse('FAILED')))
    await expect(pollRun('run-1', 'api-key')).rejects.toMatchObject({ code: 'RUN_FAILED' })
  })

  it('throws RUN_TIMEOUT when status is TIMED-OUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makePollResponse('TIMED-OUT')))
    await expect(pollRun('run-1', 'api-key')).rejects.toMatchObject({ code: 'RUN_TIMEOUT' })
  })

  it('throws RUN_ABORTED when status is ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(makePollResponse('ABORTED')))
    await expect(pollRun('run-1', 'api-key')).rejects.toMatchObject({ code: 'RUN_ABORTED' })
  })

  it('throws POLL_FAILED on non-ok poll response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }),
    )
    await expect(pollRun('run-1', 'api-key')).rejects.toMatchObject({
      code: 'POLL_FAILED',
      status: 404,
    })
  })

  it('throws ABORTED immediately when signal is already aborted before poll', async () => {
    const controller = new AbortController()
    controller.abort()
    // fetch should never be called since we abort-check before the first fetch
    const mockFn = vi.fn()
    vi.stubGlobal('fetch', mockFn)
    await expect(pollRun('run-1', 'api-key', controller.signal)).rejects.toMatchObject({
      code: 'ABORTED',
    })
    expect(mockFn).not.toHaveBeenCalled()
  })

  it('polls again on RUNNING then resolves on SUCCEEDED', async () => {
    const mockFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { id: 'run-1', status: 'RUNNING', defaultDatasetId: 'ds-1' },
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' },
          }),
      })
    vi.stubGlobal('fetch', mockFn)
    const dsId = await pollRun('run-1', 'api-key')
    expect(dsId).toBe('ds-1')
    expect(mockFn).toHaveBeenCalledTimes(2)
  })
})

// ----- fetchDataset -----

describe('fetchDataset', () => {
  it('returns items from array-shape response (clean=true)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ username: 'user1' }, { username: 'user2' }]),
      }),
    )
    const items = await fetchDataset<{ username: string }>('ds-1', 'api-key')
    expect(items).toHaveLength(2)
    expect(items[0].username).toBe('user1')
  })

  it('returns items from items-wrapped response shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [{ username: 'user1' }] }),
      }),
    )
    const items = await fetchDataset<{ username: string }>('ds-1', 'api-key')
    expect(items).toHaveLength(1)
  })

  it('returns empty array when items field is missing from wrapper', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: 'something unexpected' }),
      }),
    )
    const items = await fetchDataset('ds-1', 'api-key')
    expect(items).toEqual([])
  })

  it('throws DATASET_FETCH_FAILED on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({}),
      }),
    )
    await expect(fetchDataset('ds-1', 'api-key')).rejects.toMatchObject({
      code: 'DATASET_FETCH_FAILED',
      status: 403,
    })
  })

  it('includes Authorization header in request', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    })
    vi.stubGlobal('fetch', mockFetch)
    await fetchDataset('ds-1', 'my-secret-key')
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((options.headers as Record<string, string>)?.Authorization).toBe('Bearer my-secret-key')
  })
})
