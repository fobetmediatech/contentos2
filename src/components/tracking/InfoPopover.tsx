import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'

interface InfoPopoverProps {
  /** Bold heading inside the popover. */
  title: string
  /** Optional formula line, rendered in mono/accent. */
  formula?: string
  /** Plain-language "why it matters". */
  significance: string
  /** Which edge the popover aligns to (default right, so it stays on-screen for right-side cards). */
  align?: 'left' | 'right'
}

/**
 * Small `i` icon that toggles an inline popover explaining a metric or chart —
 * meaning, formula, and significance. Closes on outside-click or Escape.
 * stopPropagation on the trigger so it never fires an enclosing card's click
 * (e.g. the expand-on-click chart cards).
 */
export function InfoPopover({ title, formula, significance, align = 'right' }: InfoPopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
        aria-label={`What is ${title}?`}
        className={`transition-colors ${open ? 'text-[#E07B3A]' : 'text-[#8B7D6B] hover:text-[#E07B3A]'}`}
      >
        <Info size={13} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-full mt-2 z-30 w-60 ${
            align === 'right' ? 'right-0' : 'left-0'
          } bg-[#4A3C2E] border border-[rgba(245,237,214,0.15)] rounded-[10px] p-3 space-y-1.5 text-left normal-case tracking-normal shadow-[0_8px_40px_rgba(0,0,0,0.6)]`}
        >
          <p className="text-[#F5EDD6] text-xs font-medium">{title}</p>
          {formula && (
            <p className="text-[#F4A97B] font-mono text-[11px] leading-relaxed">{formula}</p>
          )}
          <p className="text-[#C4A882] text-[11px] leading-relaxed">{significance}</p>
        </div>
      )}
    </span>
  )
}
