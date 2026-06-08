/**
 * Minimal chainable fake of the Supabase JS query builder for unit tests.
 *
 * Mirrors the fetch-mock style used in gemini.rotation.test.ts: tests queue the
 * results each terminal call should resolve to, then assert which tables / filters /
 * payloads were used. Only the methods our repository + storage adapter actually call
 * are implemented (select, in, eq, order, limit, maybeSingle, upsert, insert, update,
 * delete). Terminal awaits resolve to { data, error }.
 */
import { vi } from 'vitest'

type Result = { data: unknown; error: unknown }

export interface MockConfig {
  /** FIFO queues of results, one entry consumed per matching terminal call. */
  select?: unknown[]   // each entry = the `data` a select chain resolves to
  maybeSingle?: unknown[]
  insert?: unknown[]
  upsert?: unknown[]
  update?: unknown[]
  delete?: unknown[]
  error?: unknown      // if set, every terminal call resolves { data: null, error }
}

export function makeSupabaseMock(cfg: MockConfig) {
  const calls = {
    from: [] as string[],
    select: [] as unknown[],
    in: [] as Array<[string, unknown]>,
    eq: [] as Array<[string, unknown]>,
    order: [] as unknown[],
    limit: [] as number[],
    insert: [] as unknown[],
    upsert: [] as unknown[],
    update: [] as unknown[],
    delete: [] as number[],
  }
  const queues: Record<string, unknown[]> = {
    select: [...(cfg.select ?? [])],
    maybeSingle: [...(cfg.maybeSingle ?? [])],
    insert: [...(cfg.insert ?? [])],
    upsert: [...(cfg.upsert ?? [])],
    update: [...(cfg.update ?? [])],
    delete: [...(cfg.delete ?? [])],
  }
  const take = (k: string): Result =>
    cfg.error ? { data: null, error: cfg.error } : { data: queues[k].shift() ?? null, error: null }

  // A chain is thenable: awaiting it resolves the pending terminal result.
  function chain(terminalKey: string) {
    let pending: Result = take(terminalKey)
    const api: Record<string, unknown> = {
      select: (..._a: unknown[]) => { calls.select.push(_a); pending = take('select'); return api },
      in: (col: string, vals: unknown) => { calls.in.push([col, vals]); return api },
      eq: (col: string, val: unknown) => { calls.eq.push([col, val]); return api },
      order: (..._a: unknown[]) => { calls.order.push(_a); return api },
      limit: (n: number) => { calls.limit.push(n); return api },
      maybeSingle: () => { pending = take('maybeSingle'); return api },
      then: (res: (r: Result) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(pending).then(res, rej),
    }
    return api
  }

  const client = {
    from: vi.fn((table: string) => {
      calls.from.push(table)
      return {
        select: (..._a: unknown[]) => { calls.select.push(_a); return chain('select') },
        insert: (payload: unknown) => { calls.insert.push(payload); return chain('insert') },
        upsert: (payload: unknown, _opts?: unknown) => { calls.upsert.push(payload); return chain('upsert') },
        update: (payload: unknown) => { calls.update.push(payload); return chain('update') },
        delete: () => { calls.delete.push(1); return chain('delete') },
      }
    }),
  }
  return { client, calls }
}
