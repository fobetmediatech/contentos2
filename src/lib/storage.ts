/**
 * Cross-runtime storage adapter.
 *
 * Layer 1 modules import this — never window.localStorage directly.
 * In the browser: delegates to window.localStorage.
 * In Node.js test scripts: uses an in-memory Map (no window object).
 */

type StorageAdapter = {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

function makeBrowserAdapter(): StorageAdapter {
  return {
    get: (key) => window.localStorage.getItem(key),
    set: (key, value) => window.localStorage.setItem(key, value),
    remove: (key) => window.localStorage.removeItem(key),
  }
}

function makeMemoryAdapter(): StorageAdapter {
  const store = new Map<string, string>()
  return {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => { store.set(key, value) },
    remove: (key) => { store.delete(key) },
  }
}

// Detect runtime: Node has no `window`
const storage: StorageAdapter =
  typeof window !== 'undefined' ? makeBrowserAdapter() : makeMemoryAdapter()

export default storage
