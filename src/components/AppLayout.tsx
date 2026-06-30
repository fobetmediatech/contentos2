import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Brain, FileText, MessageSquare, CalendarDays, Wallet, BarChart2, Clapperboard, ShieldCheck, Target, Menu, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { UserButton } from '@clerk/react'
import { useCorpusStore } from '../store/corpusStore'
import { useIsFinance } from '../hooks/useIsFinance'
import { useIsAdmin } from '../hooks/useIsAdmin'

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
  /** Only shown to members with the finance role (Payments). */
  financeOnly?: boolean
}

const NAV_SECTIONS: NavSection[] = [
  { path: '/', label: 'Chat', icon: MessageSquare, fullBleed: true },
  { path: '/strategy', label: 'Strategy', icon: Target },
  { path: '/calendar', label: 'Calendar', icon: CalendarDays },
  { path: '/payments', label: 'Payments', icon: Wallet, financeOnly: true },
  { path: '/memory', label: 'Memory', icon: Brain },
  { path: '/gallery', label: 'Gallery', icon: Clapperboard },
  { path: '/report', label: 'Report', icon: FileText },
  { path: '/tracking', label: 'Dashboard', icon: BarChart2 },
]

interface AppLayoutProps {
  noPadding?: boolean
}

export function AppLayout({ noPadding = false }: AppLayoutProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const corpusCount = useCorpusStore((s) => s.count)
  const { isFinance } = useIsFinance()
  const { isAdmin } = useIsAdmin()
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Payments (financeOnly) is hidden in the nav unless the user has the finance role.
  const sections = NAV_SECTIONS.filter((s) => !s.financeOnly || isFinance)

  const navClass = (active: boolean) =>
    `flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors flex-shrink-0 whitespace-nowrap ${
      active ? 'bg-surface-raised text-primary font-medium' : 'text-secondary hover:text-primary hover:bg-surface-raised'
    }`

  const isActive = (s: NavSection) =>
    s.path === '/' ? location.pathname === '/' : location.pathname.startsWith(s.path)

  useEffect(() => {
    void useCorpusStore.getState().hydrate().catch(() => {})
  }, [])

  // Escape closes the drawer; lock body scroll while it's open.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [drawerOpen])

  return (
    <div className={`${noPadding ? 'h-[100dvh] flex flex-col overflow-hidden' : 'min-h-screen'} bg-chai`}>
      {/* Top navigation bar */}
      <header className="sticky top-0 z-10 bg-surface border-b border-[rgba(245,237,214,0.08)] flex-shrink-0">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-14 flex items-center justify-between gap-2">
          {/* Left group: mobile hamburger + brand */}
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={drawerOpen}
              className="md:hidden flex items-center justify-center w-11 h-11 -ml-2 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Menu size={20} />
            </button>
            {/* Brand — Instrument Serif italic */}
            <Link
              to="/"
              className="font-serif italic text-lg text-primary hover:text-[#F4A97B] transition-colors tracking-tight"
            >
              Content OS
            </Link>
          </div>

          {/* Nav links — derived from NAV_SECTIONS. Desktop only; mobile uses the drawer. */}
          <nav aria-label="Main" className="hidden md:flex items-center gap-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {sections.map((s) => {
              const Icon = s.icon
              const active = isActive(s)
              return (
                <Link
                  key={s.path}
                  to={s.path}
                  title={s.path === '/memory' && corpusCount > 0 ? `${corpusCount} creators remembered` : undefined}
                  aria-current={active ? 'page' : undefined}
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
          >
            {/* Account dropdown items. "Team Access" sits between Manage account and Sign out,
                shown only to admins. The default items are listed explicitly to position it. */}
            <UserButton.MenuItems>
              <UserButton.Action label="manageAccount" />
              {isAdmin && (
                <UserButton.Action
                  label="Team Access"
                  labelIcon={<ShieldCheck size={15} />}
                  onClick={() => navigate('/team-access')}
                />
              )}
              <UserButton.Action label="signOut" />
            </UserButton.MenuItems>
          </UserButton>
        </div>
      </header>

      {/* Mobile nav drawer — slides in from the left below the md breakpoint */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-30">
          {/* Backdrop */}
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-black/50 animate-[fadeIn_200ms_ease-out]"
          />
          {/* Panel */}
          <nav
            aria-label="Main"
            className="absolute inset-y-0 left-0 w-[78%] max-w-xs bg-surface border-r border-[rgba(245,237,214,0.08)] flex flex-col animate-[slideInLeft_240ms_ease-out]"
          >
            <div className="h-14 flex items-center justify-between px-4 border-b border-[rgba(245,237,214,0.08)]">
              <span className="font-serif italic text-lg text-primary tracking-tight">Content OS</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="flex items-center justify-center w-11 h-11 -mr-2 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
              {sections.map((s) => {
                const Icon = s.icon
                const active = isActive(s)
                return (
                  <Link
                    key={s.path}
                    to={s.path}
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3 py-3 rounded-md text-[15px] transition-colors ${
                      active
                        ? 'bg-accent-subtle text-accent-light font-medium'
                        : 'text-secondary hover:text-primary hover:bg-surface-raised'
                    }`}
                  >
                    <Icon size={18} className={s.path === '/memory' ? 'text-[#E07B3A]' : undefined} />
                    {s.label}
                    {s.path === '/memory' && corpusCount > 0 && (
                      <span className="ml-auto text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full bg-[rgba(224,123,58,0.15)] text-[#F4A97B]">
                        {corpusCount}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </nav>
        </div>
      )}

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
