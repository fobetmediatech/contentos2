import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'

/**
 * ConfirmDialog — one on-brand confirmation modal for destructive actions.
 *
 * Replaces native window.confirm() (jarring, off-brand, unstyleable) and the
 * scattered inline confirm rows. Render it controlled: keep an `open` flag (or a
 * target id) in the parent, point onConfirm/onCancel at it.
 *
 *   <ConfirmDialog
 *     open={!!target}
 *     title="Remove finance access?"
 *     description={`${name} will lose access to Payments.`}
 *     confirmLabel="Remove"
 *     destructive
 *     onConfirm={() => { revoke(target); setTarget(null) }}
 *     onCancel={() => setTarget(null)}
 *   />
 *
 * Esc and backdrop click cancel; focus lands on Cancel so a stray Enter is safe.
 */
interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button + warning icon for irreversible actions. */
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    cancelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 animate-[fadeIn_150ms_ease-out]"
      onClick={onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={description ? 'confirm-desc' : undefined}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border border-[rgba(var(--border-rgb),0.12)] rounded-lg w-full max-w-sm p-5 text-center"
      >
        {destructive && (
          <div className="w-11 h-11 rounded-full bg-[rgba(224,92,92,0.1)] flex items-center justify-center mx-auto mb-3">
            <AlertTriangle size={20} className="text-danger" aria-hidden="true" />
          </div>
        )}
        <h2 id="confirm-title" className="text-primary text-base font-medium mb-1.5">
          {title}
        </h2>
        {description && (
          <p id="confirm-desc" className="text-muted text-sm leading-relaxed mb-5">
            {description}
          </p>
        )}
        <div className={`flex items-center gap-2 ${description ? '' : 'mt-5'}`}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="flex-1 text-secondary hover:text-primary text-sm border border-[rgba(var(--border-rgb),0.15)] rounded-md py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`flex-1 text-chai font-medium text-sm rounded-md py-2.5 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface ${
              destructive
                ? 'bg-danger hover:bg-[var(--color-error)] focus-visible:ring-danger'
                : 'bg-accent hover:bg-accent-hover focus-visible:ring-accent'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
