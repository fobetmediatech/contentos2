/**
 * DEV-only console helpers — SECURITY (C3).
 *
 * Pipeline modules log operational detail (scraped handles, generated hashtags,
 * searched cities, raw model output) that is useful in development but is the
 * product's sensitive data in production: which accounts/niches/cities an agency
 * is researching must not persist in end-user consoles or get captured by
 * error/session-replay tooling. apifyCore.ts established the rule by gating its
 * logs behind `import.meta.env.DEV`; these helpers make that pattern one import.
 *
 * Use console.error directly ONLY for genuine user-actionable failures.
 */

export const devLog = (...args: unknown[]): void => {
  if (import.meta.env.DEV) console.log(...args)
}

export const devWarn = (...args: unknown[]): void => {
  if (import.meta.env.DEV) console.warn(...args)
}

export const devError = (...args: unknown[]): void => {
  if (import.meta.env.DEV) console.error(...args)
}
