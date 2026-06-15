/**
 * Unit tests for the /api/apify proxy — focused on the key-failover behavior added so a
 * single rate-limited (429) or credit-exhausted (402) Apify key can't fail the whole
 * pipeline for the team. Mirrors the analyze-reel-video handler test setup: mock the Clerk
 * gate at the @clerk/backend boundary and stub global fetch.
 *
 * vi.mock factory vars use vi.hoisted() (factories hoist above module-level consts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const verifyTokenMock = vi.hoisted(() => vi.fn())
vi.mock('@clerk/backend', () => ({ verifyToken: verifyTokenMock }))

import handler from './apify.js'

// Minimal req/res doubles. req.body is the pre-parsed object (Vercel parses JSON).
// res must support BOTH .status().json() (errors) and .status().setHeader().end() (passthrough).
interface MockRes {
  statusCode: number
  body: unknown
  headers: Record<string, string>
  status: (s: number) => MockRes
  json: (b: unknown) => MockRes
  setHeader: (k: string, v: string) => MockRes
  end: (t: unknown) => MockRes
}
function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200, body: undefined, headers: {},
    status(s) { this.statusCode = s; return this },
    json(b) { this.body = b; return this },
    setHeader(k, v) { this.headers[k] = v; return this },
    end(t) { this.body = t; return this },
  }
  return res
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockReq = (method: string, body?: unknown, headers: Record<string, string> = {}): any => ({ method, body, headers })
const AUTHED = { authorization: 'Bearer tok_valid' }
const START = { operation: 'start', actorId: 'apify~instagram-scraper', input: {} }

/** fetch double that returns a stubbed upstream Response per call, from a status queue. */
function fetchReturning(statuses: number[]) {
  let i = 0
  return vi.fn(async () => {
    const status = statuses[i++] ?? 200
    return {
      status,
      body: { cancel: vi.fn() },               // handler cancels the body before retrying
      text: async () => JSON.stringify({ status }),
    } as unknown as Response
  })
}

/** fetch double that records the Authorization header (key) + url of each call. */
function fetchRecording(status = 200) {
  const calls: { url: string; auth?: string }[] = []
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
    calls.push({ url: String(url), auth })
    return { status, body: { cancel: vi.fn() }, text: async () => '{}' } as unknown as Response
  })
  return Object.assign(fn, { calls })
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ sub: 'user_123' })
  process.env.CLERK_SECRET_KEY = 'sk_test_clerk'
  process.env.APIFY_KEYS = 'k1,k2,k3'
  // ensure no numbered keys leak in from the environment
  for (let i = 1; i <= 10; i++) delete process.env[`APIFY_KEY_${i}`]
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.APIFY_KEYS
})

describe('/api/apify key failover', () => {
  it('retries on the next key after a 429, then returns the success', async () => {
    const f = fetchReturning([429, 200])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', START, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(2)        // rolled past the hot key
    expect(res.statusCode).toBe(200)
  })

  it('retries on the next key after a 402 (credit exhausted)', async () => {
    const f = fetchReturning([402, 200])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', START, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(200)
  })

  it('does NOT retry a non-retryable status (e.g. 400) — passes it straight back', async () => {
    const f = fetchReturning([400])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', START, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(1)
    expect(res.statusCode).toBe(400)
  })

  it('returns the last 429 once every key in the pool is exhausted', async () => {
    const f = fetchReturning([429, 429, 429])  // 3 keys, all rate limited
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', START, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(3)
    expect(res.statusCode).toBe(429)           // no hang — surfaces the 429
  })

  it('rejects an unauthenticated request before touching Apify', async () => {
    const f = fetchReturning([200])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', START, {}), res as never)   // no Bearer token
    expect(res.statusCode).toBe(401)
    expect(f).not.toHaveBeenCalled()
  })

  it('rejects a non-allowlisted actor', async () => {
    const f = fetchReturning([200])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', { operation: 'start', actorId: 'evil~actor', input: {} }, AUTHED), res as never)
    expect(res.statusCode).toBe(400)
    expect(f).not.toHaveBeenCalled()
  })
})

// Key affinity: an Apify run is owned by the account that started it, so poll/fetch/abort
// MUST reuse that same key — otherwise Apify 403s (the bug the smoke test surfaced).
describe('/api/apify key affinity (run lifecycle pinning)', () => {
  it('start reports the key index it used via x-apify-key-index header', async () => {
    process.env.APIFY_KEYS = 'solo'                  // single key → deterministic index 0
    const f = fetchRecording(200)
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', START, AUTHED), res as never)
    expect(res.statusCode).toBe(200)
    expect(res.headers['x-apify-key-index']).toBe('0')
    expect(f.calls[0].auth).toBe('Bearer solo')
  })

  it('poll reuses the pinned key — single call, no cross-account failover', async () => {
    const f = fetchRecording(200)                    // keys = k1,k2,k3 (from beforeEach)
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', { operation: 'poll', runId: 'run1', keyIndex: 1 }, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(1)               // does NOT shuffle across accounts
    expect(f.calls[0].auth).toBe('Bearer k2')        // keys[1]
    expect(f.calls[0].url).toContain('/actor-runs/run1')
  })

  it('fetch reuses the pinned key', async () => {
    const f = fetchRecording(200)
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', { operation: 'fetch', datasetId: 'ds1', keyIndex: 2 }, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.calls[0].auth).toBe('Bearer k3')        // keys[2]
    expect(f.calls[0].url).toContain('/datasets/ds1/items')
  })

  it('poll WITHOUT a keyIndex falls back to failover (legacy / pre-deploy runs)', async () => {
    const f = fetchReturning([429, 200])             // first key rate-limited → rolls over
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', { operation: 'poll', runId: 'run1' }, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(200)
  })

  it('poll with an out-of-range keyIndex ignores it and falls back to failover', async () => {
    const f = fetchReturning([429, 200])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', { operation: 'poll', runId: 'run1', keyIndex: 99 }, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(2)               // invalid index → not pinned → failover
    expect(res.statusCode).toBe(200)
  })
})
