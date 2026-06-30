import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * EmptyState — the warm, on-brand "nothing here yet" surface.
 *
 * An empty list is a feature, not a dead end: a saffron-tinted icon, an
 * editorial serif headline, one helpful line, and a single primary action that
 * tells the user how to fill it. Replaces bare "No items found." text.
 *
 *   <EmptyState
 *     icon={Brain}
 *     title="Nothing remembered yet"
 *     description="Every creator you research lands here automatically."
 *     action={{ label: 'Start a search', to: '/' }}
 *   />
 */
interface EmptyStateAction {
  label: string
  /** Navigates via react-router. Provide this OR onClick. */
  to?: string
  onClick?: () => void
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: ReactNode
  action?: EmptyStateAction
  /** Tighter vertical padding for inline (in-card) empties. */
  compact?: boolean
}

export function EmptyState({ icon: Icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 ${compact ? 'py-10' : 'py-16'}`}>
      <div className="w-16 h-16 rounded-full bg-[rgba(var(--accent-rgb),0.12)] flex items-center justify-center mb-5">
        <Icon size={28} className="text-accent" aria-hidden="true" />
      </div>
      <h2 className="font-serif italic text-2xl text-primary mb-2 tracking-tight">{title}</h2>
      <p className="text-sm text-muted leading-relaxed max-w-xs mb-6">{description}</p>
      {action && action.to && (
        <Link
          to={action.to}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-chai font-medium text-sm rounded-md px-5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chai"
        >
          {action.label}
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
      {action && !action.to && action.onClick && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-chai font-medium text-sm rounded-md px-5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chai"
        >
          {action.label}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
