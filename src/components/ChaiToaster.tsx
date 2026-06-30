import { Toaster } from 'sonner'

/**
 * App-wide toast surface, themed to the Lotus Pond system (see DESIGN.md).
 *
 * Mounted once at the app root. Components fire notifications via the `toast`
 * helper in `src/lib/toast.ts`. All colors are CSS vars, so toasts flip with
 * the rest of the app between light and dark. Sonner renders into a main-DOM
 * portal, so the :root vars resolve here.
 */
export function ChaiToaster() {
  return (
    <Toaster
      position="top-center"
      gap={8}
      offset={16}
      toastOptions={{
        style: {
          background: 'var(--color-surface-raised)',
          border: '1px solid var(--color-border-strong)',
          color: 'var(--color-text-primary)',
          fontFamily: '"Outfit", sans-serif',
          fontSize: '14px',
          borderRadius: '10px',
        },
        classNames: {
          description: 'text-secondary',
          actionButton: '!bg-accent !text-[var(--color-bg)] !font-medium',
          cancelButton: '!bg-transparent !text-secondary',
        },
      }}
      style={
        {
          '--success-bg': 'var(--color-surface-raised)',
          '--success-text': 'var(--color-success)',
          '--success-border': 'var(--color-success)',
          '--error-bg': 'var(--color-surface-raised)',
          '--error-text': 'var(--color-error)',
          '--error-border': 'var(--color-error)',
          '--warning-bg': 'var(--color-surface-raised)',
          '--warning-text': 'var(--color-warning-text)',
          '--warning-border': 'var(--color-warning)',
        } as React.CSSProperties
      }
    />
  )
}
