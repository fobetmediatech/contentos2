import { useThemeStore } from '../store/themeStore'

/**
 * The EFFECTIVE color scheme the app is painting — honours the manual light/dark toggle, not
 * just the OS. Backed by themeStore (which resolves 'system' → light/dark and keeps it live).
 *
 * Clerk's `appearance.variables` are plain color strings it derives shades from in JS — they
 * can't read our CSS vars, so they don't auto-flip. This hook lets the Clerk surfaces pick the
 * matching palette instead of being a fixed dark box on a light page (or vice-versa).
 */
export function useColorScheme(): 'light' | 'dark' {
  return useThemeStore((s) => s.resolved)
}
