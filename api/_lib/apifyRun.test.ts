import { describe, it, expect, vi, afterEach } from 'vitest'
import { getApifyKeys, apifyRunSync, type KeyRing } from './apifyRun'

const saved = { ...process.env }
afterEach(() => {
  process.env = { ...saved }
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('getApifyKeys', () => {
  it('collects numbered + csv keys, trimmed, non-empty', () => {
    process.env.APIFY_KEY_1 = 'a'
    process.env.APIFY_KEY_2 = ''
    process.env.APIFY_KEYS = ' b , c ,'
    // Defensive: clear any other numbered keys so the exact returned array is asserted
    // (mirrors api/apify.test.ts's beforeEach convention).
    for (let i = 3; i <= 10; i++) delete process.env[`APIFY_KEY_${i}`]
    expect(getApifyKeys()).toEqual(['a', 'b', 'c'])
  })
  it('empty when nothing set', () => {
    for (let i = 1; i <= 10; i++) delete process.env[`APIFY_KEY_${i}`]
    delete process.env.APIFY_KEYS
    expect(getApifyKeys()).toEqual([])
  })
})

/** fetch double returning a stubbed upstream Response per call, from a status/body queue.
 *  Each entry is either a status number (200 defaults to an array body), or a tuple of
 *  [status, jsonBody] to control the parsed body (needed for the non-array/error-message
 *  parse branch). Mirrors api/apify.test.ts's fetchReturning(). */
function fetchReturning(entries: Array<number | [number, unknown]>) {
  let i = 0
  return vi.fn(async () => {
    const entry = entries[i++] ?? 200
    const [status, jsonBody] = Array.isArray(entry) ? entry : [entry, [{ ok: true }]]
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: `status ${status}`,
      json: async () => jsonBody,
    } as unknown as Response
  })
}

describe('apifyRunSync', () => {
  it('rotates to the next key after a 429, then returns the dataset items', async () => {
    const f = fetchReturning([429, [200, [{ id: 1 }]]])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1', 'k2'], i: 0 }
    const result = await apifyRunSync('some~actor', {}, ring)
    expect(f).toHaveBeenCalledTimes(2)
    expect(result).toEqual([{ id: 1 }])
  })

  it('rotates to the next key after a 402 (credit exhausted)', async () => {
    const f = fetchReturning([402, [200, [{ id: 2 }]]])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1', 'k2'], i: 0 }
    const result = await apifyRunSync('some~actor', {}, ring)
    expect(f).toHaveBeenCalledTimes(2)
    expect(result).toEqual([{ id: 2 }])
  })

  it('does NOT rotate on a permanent-failure status (400) — throws immediately', async () => {
    const f = fetchReturning([400])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1', 'k2'], i: 0 }
    await expect(apifyRunSync('some~actor', {}, ring)).rejects.toThrow(
      /Apify some~actor failed: HTTP 400/,
    )
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('does NOT rotate on a permanent-failure status (404) — throws immediately', async () => {
    const f = fetchReturning([404])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1', 'k2'], i: 0 }
    await expect(apifyRunSync('some~actor', {}, ring)).rejects.toThrow(
      /Apify some~actor failed: HTTP 404/,
    )
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('exhausts the ring and surfaces the {error:{message}} body on a non-array 200 response', async () => {
    const f = fetchReturning([[200, { error: { message: 'boom' } }]])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1'], i: 0 }
    await expect(apifyRunSync('some~actor', {}, ring)).rejects.toThrow(
      /all 1 key\(s\) failed \(boom\)/,
    )
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('exhausts the ring and surfaces a generic message on a non-array body with no error.message', async () => {
    const f = fetchReturning([[200, { unexpected: true }]])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1'], i: 0 }
    await expect(apifyRunSync('some~actor', {}, ring)).rejects.toThrow(
      /all 1 key\(s\) failed \(non-array response\)/,
    )
  })

  it('rolls over across all rotate-eligible keys and throws the last error once exhausted', async () => {
    const f = fetchReturning([429, 402])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1', 'k2'], i: 0 }
    await expect(apifyRunSync('some~actor', {}, ring)).rejects.toThrow(
      /all 2 key\(s\) failed \(HTTP 402\)/,
    )
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('advances the ring cursor (round-robin) across calls', async () => {
    const f = fetchReturning([[200, [{ id: 1 }]]])
    vi.stubGlobal('fetch', f)
    const ring: KeyRing = { keys: ['k1', 'k2'], i: 0 }
    await apifyRunSync('some~actor', {}, ring)
    expect(ring.i).toBe(1)
  })

  it('aborts via the AbortController after the actor timeout elapses', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const ring: KeyRing = { keys: ['k1'], i: 0 }
    const promise = apifyRunSync('some~actor', {}, ring)
    const assertion = expect(promise).rejects.toThrow(/timeout after \d+ms/)
    await vi.advanceTimersByTimeAsync(90_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws "no keys configured" when the ring is empty', async () => {
    const ring: KeyRing = { keys: [], i: 0 }
    await expect(apifyRunSync('some~actor', {}, ring)).rejects.toThrow(
      /all 0 key\(s\) failed \(no keys configured\)/,
    )
  })
})
