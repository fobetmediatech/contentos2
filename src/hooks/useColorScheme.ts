import { useEffect, useState } from 'react'

/**
 * Tracks the active OS color scheme (the app flips via `prefers-color-scheme`).
 *
 * Clerk's `appearance.variables` are plain color strings it derives shades from
 * in JS — they can't read our CSS vars, so they don't auto-flip. This hook lets
 * the Clerk surfaces pick the matching palette instead of being a fixed dark box
 * on a light page (or vice-versa). Defaults to dark (the app's default theme).
 */
export function useColorScheme(): 'light' | 'dark' {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (e: MediaQueryListEvent) => setScheme(e.matches ? 'light' : 'dark')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return scheme
}
