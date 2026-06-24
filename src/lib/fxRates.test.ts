import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchRatesToInr, toInr, FALLBACK_RATES_TO_INR } from './fxRates'

describe('toInr', () => {
  const rates = { INR: 1, AED: 22.6, USD: 83 }

  it('keeps INR amounts unchanged', () => {
    expect(toInr(400_000, 'INR', rates)).toBe(400_000)
  })

  it('converts a foreign amount using the INR-per-unit rate', () => {
    expect(toInr(16_000, 'AED', rates)).toBeCloseTo(16_000 * 22.6, 5)
  })

  it('falls back to the built-in table for a currency missing from the live map', () => {
    expect(toInr(100, 'GBP', { INR: 1 })).toBe(100 * FALLBACK_RATES_TO_INR.GBP)
  })

  it('treats a totally unknown currency as 1:1 (never NaN)', () => {
    expect(toInr(100, 'XYZ', { INR: 1 })).toBe(100)
  })
})

describe('fetchRatesToInr', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reciprocates the API rates (units-per-INR → INR-per-unit) and forces INR=1', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: 'success', rates: { INR: 1, USD: 0.012, AED: 0.0442 } }),
    })) as unknown as typeof fetch)

    const map = await fetchRatesToInr()
    expect(map.INR).toBe(1)
    expect(map.USD).toBeCloseTo(1 / 0.012, 5)
    expect(map.AED).toBeCloseTo(1 / 0.0442, 5)
  })

  it('throws on a non-ok response (caller falls back)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })) as unknown as typeof fetch)
    await expect(fetchRatesToInr()).rejects.toThrow()
  })

  it('throws on a malformed payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: 'error' }) })) as unknown as typeof fetch)
    await expect(fetchRatesToInr()).rejects.toThrow()
  })
})
