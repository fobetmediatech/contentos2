import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import { InfoPopover } from './InfoPopover'

export interface ChartInfo {
  title: string
  formula?: string
  significance: string
}

interface ExpandableChartCardProps {
  title: string
  info?: ChartInfo
  children: ReactNode
}

/**
 * A chart card that expands into a centered modal on click (chart body or the
 * expand icon). The modal dismisses on backdrop click or Escape. The `children`
 * (a TrendChart) render in both the inline card and the modal — TrendChart is
 * stateless, so two instances are fine and each sizes to its own container.
 */
export function ExpandableChartCard({ title, info, children }: ExpandableChartCardProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  return (
    <div className="bg-[#2C2218] border border-[rgba(245,237,214,0.08)] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[#C4A882] text-xs font-medium font-mono uppercase tracking-wider">{title}</h3>
        <div className="flex items-center gap-2">
          {info && <InfoPopover title={info.title} formula={info.formula} significance={info.significance} />}
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`Expand ${title}`}
            title="Expand"
            className="text-[#8B7D6B] hover:text-[#E07B3A] transition-colors"
          >
            <Maximize2 size={13} />
          </button>
        </div>
      </div>

      <div
        className="h-44 cursor-zoom-in"
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={-1}
      >
        {children}
      </div>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 sm:p-8"
            onClick={() => setOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <div
              className="w-full max-w-4xl bg-[#2C2218] border border-[rgba(245,237,214,0.15)] rounded-[14px] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.7)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                  <h3 className="text-[#F5EDD6] text-sm font-medium font-mono uppercase tracking-wider">{title}</h3>
                  {info && (
                    <InfoPopover
                      title={info.title}
                      formula={info.formula}
                      significance={info.significance}
                      align="left"
                    />
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  className="text-[#8B7D6B] hover:text-[#F5EDD6] transition-colors"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="h-[60vh]">{children}</div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
