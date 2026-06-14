import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Brain, FileText, MessageSquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { UserButton } from '@clerk/react'
import { useCorpusStore } from '../store/corpusStore'

/**
 * NAV_SECTIONS — single source of truth for app navigation (Phase 7 item 7.2).
 *
 * Adding a new section = one entry here. The nav, active states, and layout
 * (fullBleed = h-[100dvh] chat mode; default = padded content pages) all derive
 * from this array.
 */
interface NavSection {
  path: string
  label: string
  icon: LucideIcon
  fullBleed?: boolean
}

const NAV_SECTIONS: NavSection[] = [
  { path: '/', label: 'Chat', icon: MessageSquare, fullBleed: true },
  { path: '/memory', label: 'Memory', icon: Brain },
  { path: '/report', label: 'Report', icon: FileText },
]

interface AppLayoutProps {
  noPadding?: boolean
}

export function AppLayout({ noPadding = false }: AppLayoutProps) {
  const location = useLocation()
  const corpusCount = useCorpusStore((s) => s.count)

  const navClass = (active: boolean) =>
    `flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
      active ? 'bg-surface-raised text-primary font-medium' : 'text-secondary hover:text-primary hover:bg-surface-raised'
    }`

  const isActive = (s: NavSection) =>
    s.path === '/' ? location.pathname === '/' : location.pathname.startsWith(s.path)

  useEffect(() => {
    void useCorpusStore.getState().hydrate().catch(() => {})
  }, [])

  return (
    <div className={`${noPadding ? 'h-[100dvh] flex flex-col overflow-hidden' : 'min-h-screen'} bg-chai`}>
      {/* Top navigation bar */}
      <header className="sticky top-0 z-10 bg-surface border-b border-[rgba(245,237,214,0.08)] flex-shrink-0">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Brand — Instrument Serif italic */}
          <Link
            to="/"
            className="font-serif italic text-lg text-primary hover:text-[#F4A97B] transition-colors tracking-tight"
          >
            Content OS
          </Link>

          {/* Nav links — derived from NAV_SECTIONS */}
          <nav className="flex items-center gap-1">
            {NAV_SECTIONS.map((s) => {
              const Icon = s.icon
              const active = isActive(s)
              return (
                <Link
                  key={s.path}
                  to={s.path}
                  title={s.path === '/memory' && corpusCount > 0 ? `${corpusCount} creators remembered` : undefined}
                  className={navClass(active)}
                >
                  <Icon size={14} className={s.path === '/memory' ? 'text-[#E07B3A]' : undefined} />
                  {s.label}
                  {/* Memory-specific corpus count badge */}
                  {s.path === '/memory' && corpusCount > 0 && (
                    <span className="ml-0.5 text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full bg-[rgba(224,123,58,0.15)] text-[#F4A97B]">
                      {corpusCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </nav>

          {/* User avatar — Clerk's UserButton shows initials/photo */}
          <UserButton
            appearance={{
              variables: {
                colorBackground: '#2C2218',
                colorText: '#F5EDD6',
                colorTextSecondary: '#C4A882',
                colorPrimary: '#E07B3A',
                colorTextOnPrimaryBackground: '#F5EDD6',
                colorInputBackground: '#3D3025',
                colorInputText: '#F5EDD6',
                colorNeutral: '#C4A882',
                borderRadius: '10px',
                fontFamily: '"Outfit", sans-serif',
                fontSize: '14px',
              },
              elements: {
                card: {
                  backgroundColor: '#2C2218',
                  border: '1px solid rgba(245,237,214,0.12)',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(245,237,214,0.06)',
                },
                userPreviewMainIdentifier: {
                  color: '#F5EDD6',
                  fontWeight: '600',
                  fontFamily: '"Outfit", sans-serif',
                },
                userPreviewSecondaryIdentifier: {
                  color: '#C4A882',
                  fontFamily: '"DM Mono", monospace',
                  fontSize: '12px',
                  letterSpacing: '0.01em',
                },
                userPreviewAvatarBox: {
                  outline: '2px solid rgba(224,123,58,0.35)',
                  outlineOffset: '1px',
                },
                userButtonPopoverActionButton: {
                  color: '#F5EDD6',
                  borderRadius: '8px',
                  transition: 'background-color 150ms ease',
                },
                userButtonPopoverActionButtonText: {
                  color: '#F5EDD6',
                  fontFamily: '"Outfit", sans-serif',
                  fontWeight: '500',
                },
                userButtonPopoverActionButtonIcon: {
                  color: '#C4A882',
                },
                userButtonPopoverFooter: {
                  borderTop: '1px solid rgba(245,237,214,0.08)',
                },
                userButtonPopoverFooterPagesLink: {
                  color: '#7A6A54',
                },
                badge: {
                  backgroundColor: 'rgba(224,123,58,0.15)',
                  color: '#F4A97B',
                  border: '1px solid rgba(224,123,58,0.25)',
                  fontFamily: '"DM Mono", monospace',
                  letterSpacing: '0.04em',
                },
              },
            }}
          />
        </div>
      </header>

      {/* Page content */}
      {noPadding ? (
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      ) : (
        <main className="max-w-7xl mx-auto px-6 py-8">
          <Outlet />
        </main>
      )}
    </div>
  )
}
