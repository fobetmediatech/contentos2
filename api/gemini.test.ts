/**
 * Unit tests for the /api/gemini proxy — focused on the key-failover added so a single revoked /
 * invalid key sitting in the GEMINI_API_KEY/GEMINI_KEYS pool can't intermittently fail requests
 * for the team (the symptom: some chat turns 400 with "API key not valid" while others succeed,
 * purely by which shuffled key the request drew). Mirrors api/apify.test.ts's setup: mock the
 * Clerk gate at the @clerk/backend boundary and stub global fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const verifyTokenMock = vi.hoisted(() => vi.fn())
vi.mock('@clerk/backend', () => ({ verifyToken: verifyTokenMock }))

import handler, { isInvalidKeyError } from './gemini.js'

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
const CALL = { model: 'gemini-2.5-flash', endpoint: 'generateContent', body: {} }

const KEY_INVALID = JSON.stringify({
  error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] },
})
const BAD_PROMPT = JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Invalid value at contents[0].parts' } })
const OK = JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })

/** fetch double returning a stubbed upstream Response per call, from a [status, bodyText] queue. */
function fetchReturning(entries: Array<[number, string]>) {
  let i = 0
  return vi.fn(async () => {
    const [status, bodyText] = entries[i++] ?? [200, OK]
    return { status, body: { cancel: vi.fn() }, text: async () => bodyText } as unknown as Response
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyTokenMock.mockResolvedValue({ sub: 'user_123' })
  process.env.CLERK_SECRET_KEY = 'sk_test_clerk'
  delete process.env.GEMINI_KEYS
  for (let i = 1; i <= 10; i++) delete process.env[`GEMINI_KEY_${i}`]
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_KEYS
})

describe('isInvalidKeyError', () => {
  it('detects a revoked/invalid key body', () => {
    expect(isInvalidKeyError(KEY_INVALID)).toBe(true)
    expect(isInvalidKeyError('{"error":{"message":"API_KEY_INVALID"}}')).toBe(true)
  })
  it('does NOT match a genuine bad-prompt 400', () => {
    expect(isInvalidKeyError(BAD_PROMPT)).toBe(false)
  })
})

describe('/api/gemini key failover', () => {
  it('rolls past a revoked key in the pool to a valid one (returns 200)', async () => {
    process.env.GEMINI_API_KEY = 'bad,good'
    const f = fetchReturning([[400, KEY_INVALID], [200, OK]])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', CALL, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(2) // skipped the dead key, tried the next
    expect(res.statusCode).toBe(200)
    expect(res.body).toBe(OK)
  })

  it('surfaces the invalid-key error only when EVERY key is bad', async () => {
    process.env.GEMINI_API_KEY = 'bad1,bad2'
    const f = fetchReturning([[400, KEY_INVALID], [400, KEY_INVALID]])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', CALL, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(2)
    expect(res.statusCode).toBe(400)
    expect(res.body).toBe(KEY_INVALID)
  })

  it('passes a genuine bad-prompt 400 straight back without burning other keys', async () => {
    process.env.GEMINI_API_KEY = 'good1,good2'
    const f = fetchReturning([[400, BAD_PROMPT]])
    vi.stubGlobal('fetch', f)
    const res = mockRes()
    await handler(mockReq('POST', CALL, AUTHED), res as never)
    expect(f).toHaveBeenCalledTimes(1) // not a key problem → returned immediately
    expect(res.statusCode).toBe(400)
  })
})
