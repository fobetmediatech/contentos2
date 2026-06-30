/**
 * Theme preference store — owns the light/dark choice that drives `data-theme` on <html>.
 *
 * The actual palette lives in CSS (tokens.css): `:root` is dark, `:root[data-theme="light"]`
 * is light. This store decides which attribute value is on <html>:
 *   - 'system' (default) → follow the OS, and keep following it live via matchMedia
 *   - 'light' / 'dark'    → an explicit, pinned choice
 *
 * The initial attribute is set BEFORE paint by the inline script in index.html (same resolve
 * logic) so there's no flash; this store re-applies on every change and persists the choice.
 */
import { create } from 'zustand'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedScheme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

const isLightOS = (): boolean =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches

/** Map a preference to the concrete scheme that actually paints. */
export const resolveScheme = (pref: ThemePref): ResolvedScheme =>
  pref === 'system' ? (isLightOS() ? 'light' : 'dark') : pref

const readPref = (): ThemePref => {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* localStorage can throw in private mode / SSR — fall through to default */
  }
  return 'system'
}

const applyAttr = (resolved: ResolvedScheme): void => {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', resolved)
}

interface ThemeState {
  pref: ThemePref
  resolved: ResolvedScheme
  /** Set an explicit preference (or 'system'); persists + applies immediately. */
  setPref: (pref: ThemePref) => void
  /** Flip the effective scheme and pin it — what the nav sun/moon button calls. */
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => {
  const pref = readPref()

  // While the preference is 'system', track live OS changes (user flips macOS appearance, etc.).
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (get().pref !== 'system') return
      const resolved = resolveScheme('system')
      applyAttr(resolved)
      set({ resolved })
    })
  }

  return {
    pref,
    resolved: resolveScheme(pref),
    setPref: (next) => {
      try {
        localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore persistence failures — the in-memory choice still applies this session */
      }
      const resolved = resolveScheme(next)
      applyAttr(resolved)
      set({ pref: next, resolved })
    },
    toggle: () => get().setPref(get().resolved === 'dark' ? 'light' : 'dark'),
  }
})
