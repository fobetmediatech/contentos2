/**
 * Live FX rates for the Payments INR summary.
 *
 * Per-payment rows keep their original currency; only the top summary boxes are
 * consolidated into INR. We fetch current rates (base INR) from a free, no-key service
 * and cache them via react-query. A built-in fallback table keeps the total working if
 * the service is unreachable.
 *
 * NOTE: this converts at the CURRENT rate, not the rate on each payment's date — it's an
 * at-a-glance consolidated figure, not an accounting-grade historical conversion.
 */

/** INR per 1 unit of currency. Approximate fallback used if the live fetch fails. */
export const FALLBACK_RATES_TO_INR: Record<string, number> = {
  INR: 1,
  USD: 83,
  EUR: 90,
  GBP: 105,
  AED: 22.6,
}

const RATES_URL = 'https://open.er-api.com/v6/latest/INR'

/**
 * Fetch current rates as "INR per 1 unit of <currency>". The API returns the inverse
 * (units of <currency> per 1 INR, since base=INR), so each rate is reciprocated.
 * Throws on network/HTTP/payload errors — callers fall back to FALLBACK_RATES_TO_INR.
 */
export async function fetchRatesToInr(signal?: AbortSignal): Promise<Record<string, number>> {
  const res = await fetch(RATES_URL, { signal })
  if (!res.ok) throw new Error(`fx ${res.status}`)
  const json = (await res.json()) as { result?: string; rates?: Record<string, number> }
  if (json.result !== 'success' || !json.rates) throw new Error('fx bad payload')
  const out: Record<string, number> = { INR: 1 }
  for (const [code, perInr] of Object.entries(json.rates)) {
    if (typeof perInr === 'number' && perInr > 0) out[code] = 1 / perInr
  }
  return out
}

/** Convert an amount in `currency` to INR using the rate map (fallback rate 1 if unknown). */
export function toInr(amount: number, currency: string, rates: Record<string, number>): number {
  const r = rates[currency] ?? FALLBACK_RATES_TO_INR[currency] ?? 1
  return amount * r
}
