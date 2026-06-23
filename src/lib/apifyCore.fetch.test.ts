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

// Mock the Clerk token source so we can assert a FRESH token is fetched per poll.
const getTokenMock = vi.hoisted(() => vi.fn())
vi.mock('./clerkToken', () => ({ getClerkSessionToken: getTokenMock }))

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

  it('reads the owning key index from the x-apify-key-index header', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: (h: string) => (h === 'x-apify-key-index' ? '2' : null) },
        json: () => Promise.resolve({ data: { id: 'r', status: 'READY', defaultDatasetId: 'd' } }),
      }),
    )
    const result = await startRun('actor-id', {}, 'api-key')
    expect(result.keyIndex).toBe(2) // threaded into poll/fetch so they hit the same account
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

  it('fetches a FRESH Clerk token on every poll (token-expiry guard)', async () => {
    // Regression: pollRun used to grab one token before the loop and reuse it for up to
    // 110-180s; Clerk tokens expire in ~60s, so slow reel-video scrapes 401'd mid-poll.
    getTokenMock.mockResolvedValueOnce('tok-1').mockResolvedValueOnce('tok-2')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makePollResponse('RUNNING'))
      .mockResolvedValueOnce(makePollResponse('SUCCEEDED', 'ds-ok'))
    vi.stubGlobal('fetch', fetchMock)
    const dsId = await pollRun('run-1', 'ignored-key')
    expect(dsId).toBe('ds-ok')
    expect(getTokenMock).toHaveBeenCalledTimes(2) // once PER poll, not once for the whole loop
    const h1 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    const h2 = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>
    expect(h1.Authorization).toBe('Bearer tok-1')
    expect(h2.Authorization).toBe('Bearer tok-2') // fresh token on the 2nd poll
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

  it('uses an IDLE timeout — a still-answering run keeps polling past the idle budget (deadline resets)', async () => {
    vi.useFakeTimers()
    try {
      const running = () => ({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: 'run-1', status: 'RUNNING', defaultDatasetId: 'ds-1' } }),
      })
      const succeeded = {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: 'run-1', status: 'SUCCEEDED', defaultDatasetId: 'ds-1' } }),
      }
      const mockFn = vi.fn()
        .mockResolvedValueOnce(running())
        .mockResolvedValueOnce(running())
        .mockResolvedValueOnce(running())
        .mockResolvedValueOnce(succeeded)
      vi.stubGlobal('fetch', mockFn)
      // Idle budget 6s. The run answers RUNNING at ~0/2/5s then SUCCEEDS at ~9.5s — PAST the 6s
      // budget but under the 12s hard ceiling. A non-resetting (old wall-clock) deadline would
      // POLL_TIMEOUT before the SUCCEEDED poll; the idle-reset keeps it alive to finish.
      const p = pollRun('run-1', 'k', undefined, 6000)
      await vi.advanceTimersByTimeAsync(20_000)
      await expect(p).resolves.toBe('ds-1')
      expect(mockFn).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
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

  it('sends operation=fetch with the dataset id to the proxy', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve([]),
    })
    vi.stubGlobal('fetch', mockFetch)
    await fetchDataset('ds-1', 'ignored-key')
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/apify')
    const body = JSON.parse(options.body as string)
    expect(body).toEqual({ operation: 'fetch', datasetId: 'ds-1' })
  })
})

// Key affinity threading: poll/fetch must echo the run's keyIndex back to the proxy so the
// SAME Apify account is used for the run lifecycle (a different account 403s the run).
describe('key affinity threading', () => {
  it('pollRun sends keyIndex to the proxy when provided', async () => {
    const f = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { id: 'r', status: 'SUCCEEDED', defaultDatasetId: 'd' } }),
    })
    vi.stubGlobal('fetch', f)
    await pollRun('run-1', 'ignored-key', undefined, undefined, 1)
    const body = JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toEqual({ operation: 'poll', runId: 'run-1', keyIndex: 1 })
  })

  it('fetchDataset sends keyIndex to the proxy when provided', async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
    vi.stubGlobal('fetch', f)
    await fetchDataset('ds-1', 'ignored-key', undefined, 3)
    const body = JSON.parse((f.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toEqual({ operation: 'fetch', datasetId: 'ds-1', keyIndex: 3 })
  })
})
