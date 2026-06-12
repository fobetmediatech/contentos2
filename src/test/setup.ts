import { vi } from 'vitest'

// Globally stub the Supabase client so persisted Zustand stores don't fire
// real network calls to placeholder.supabase.co during tests. Per-file mocks
// (e.g. supabaseStorage.test.ts, supabaseCorpus.test.ts) override this with
// their own vi.mock calls, which take precedence for that file's module cache.
vi.mock('../lib/supabaseClient', () => {
  const OK = { data: null, error: null }
  function chain(): unknown {
    const c: Record<string, unknown> = {
      select: () => chain(),
      insert: () => chain(),
      upsert: () => chain(),
      update: () => chain(),
      delete: () => chain(),
      eq: () => chain(),
      in: () => chain(),
      order: () => chain(),
      limit: () => chain(),
      maybeSingle: () => chain(),
      then: (res: (r: typeof OK) => unknown) =>
        Promise.resolve(OK).then(res),
    }
    return c
  }
  return {
    supabase: { from: () => chain() },
    setClerkTokenGetter: vi.fn(),
  }
})
