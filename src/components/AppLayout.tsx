import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Brain, MessageSquare, CalendarDays, Wallet, BarChart2, Clapperboard, ShieldCheck, Target, Menu, X } from 'lucide-react'
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

  const isActive = (s: NavSection) =>
    s.path === '/' ? location.pathname === '/' : location.pathname.startsWith(s.path)

  // Spotlight split: the active tab centers; the rest keep their fixed order,
  // half falling to its left and half to its right.
  const activeIndex = sections.findIndex(isActive)
  const activeSection = activeIndex >= 0 ? sections[activeIndex] : null
  const leftTabs = activeIndex >= 0 ? sections.slice(0, activeIndex) : sections
  const rightTabs = activeIndex >= 0 ? sections.slice(activeIndex + 1) : []

  // One inactive tab = an icon chip that expands to its label on hover.
  const renderChip = (s: NavSection) => {
    const Icon = s.icon
    return (
      <Link
        key={s.path}
        to={s.path}
        title={s.path === '/memory' && corpusCount > 0 ? `${s.label} · ${corpusCount} remembered` : s.label}
        className="group/chip flex items-center h-9 px-2.5 rounded-full text-secondary hover:text-primary hover:bg-surface-raised hover:-translate-y-0.5 transition-[color,background-color,transform] duration-150"
      >
        <Icon size={15} className={s.path === '/memory' ? 'text-[var(--color-accent)]' : undefined} />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm group-hover/chip:max-w-[140px] group-hover/chip:ml-1.5 transition-[max-width,margin] duration-200">
          {s.label}
        </span>
      </Link>
    )
  }

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
      <header className="sticky top-0 z-10 bg-surface border-b border-[rgba(var(--border-rgb),0.08)] flex-shrink-0">
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
              className="font-serif italic text-lg text-primary hover:text-[var(--color-accent-light)] transition-colors tracking-tight"
            >
              Content OS
            </Link>
          </div>

          {/* Nav — SPOTLIGHT. The open tab is centered; the other tabs keep their
              fixed order, split half to its left and half to its right. Each
              inactive tab is an icon chip that expands on hover. Desktop only. */}
          <nav aria-label="Main" className="hidden md:flex items-center justify-center flex-1 min-w-0 gap-1">
            {/* Left half — tabs before the active one */}
            <div className="flex items-center gap-0.5 justify-end">
              {leftTabs.map(renderChip)}
            </div>

            {/* Center — the active tab in the spotlight */}
            {activeSection && (
              <Link
                to={activeSection.path}
                aria-current="page"
                className="flex items-center gap-2 px-4 py-1.5 mx-1 rounded-full bg-[rgba(var(--accent-rgb),0.16)] text-[var(--color-accent-light)] font-medium text-[15px] ring-1 ring-[rgba(var(--accent-rgb),0.45)] shadow-[0_0_20px_rgba(var(--accent-rgb),0.16)] whitespace-nowrap transition-colors flex-shrink-0"
              >
                {(() => {
                  const Icon = activeSection.icon
                  return <Icon size={16} className={activeSection.path === '/memory' ? 'text-[var(--color-accent)]' : undefined} />
                })()}
                {activeSection.label}
                {activeSection.path === '/memory' && corpusCount > 0 && (
                  <span className="text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full bg-[rgba(var(--accent-rgb),0.24)] text-[var(--color-accent-light)]">
                    {corpusCount}
                  </span>
                )}
              </Link>
            )}

            {/* Right half — tabs after the active one */}
            <div className="flex items-center gap-0.5 justify-start">
              {rightTabs.map(renderChip)}
            </div>
          </nav>

          {/* User avatar — Clerk's UserButton shows initials/photo */}
          <UserButton
            appearance={{
              variables: {
                colorBackground: '#2E221A',
                colorText: '#F5DFC5',
                colorTextSecondary: '#CBB093',
                colorPrimary: '#DFA477',
                colorTextOnPrimaryBackground: '#221913',
                colorInputBackground: '#3B2C21',
                colorInputText: '#F5DFC5',
                colorNeutral: '#CBB093',
                borderRadius: '10px',
                fontFamily: '"Outfit", sans-serif',
                fontSize: '14px',
              },
              elements: {
                card: {
                  backgroundColor: '#2E221A',
                  border: '1px solid rgba(var(--border-rgb),0.12)',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(var(--border-rgb),0.06)',
                },
                userPreviewMainIdentifier: {
                  color: '#F5DFC5',
                  fontWeight: '600',
                  fontFamily: '"Outfit", sans-serif',
                },
                userPreviewSecondaryIdentifier: {
                  color: '#CBB093',
                  fontFamily: '"DM Mono", monospace',
                  fontSize: '12px',
                  letterSpacing: '0.01em',
                },
                userPreviewAvatarBox: {
                  outline: '2px solid rgba(var(--accent-rgb),0.35)',
                  outlineOffset: '1px',
                },
                userButtonPopoverActionButton: {
                  color: '#F5DFC5',
                  borderRadius: '8px',
                  transition: 'background-color 150ms ease',
                },
                userButtonPopoverActionButtonText: {
                  color: '#F5DFC5',
                  fontFamily: '"Outfit", sans-serif',
                  fontWeight: '500',
                },
                userButtonPopoverActionButtonIcon: {
                  color: '#CBB093',
                },
                userButtonPopoverFooter: {
                  borderTop: '1px solid rgba(var(--border-rgb),0.08)',
                },
                userButtonPopoverFooterPagesLink: {
                  color: '#A89177',
                },
                badge: {
                  backgroundColor: 'rgba(var(--accent-rgb),0.15)',
                  color: '#ECC09B',
                  border: '1px solid rgba(var(--accent-rgb),0.25)',
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
            className="absolute inset-y-0 left-0 w-[78%] max-w-xs bg-surface border-r border-[rgba(var(--border-rgb),0.08)] flex flex-col animate-[slideInLeft_240ms_ease-out]"
          >
            <div className="h-14 flex items-center justify-between px-4 border-b border-[rgba(var(--border-rgb),0.08)]">
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
                    <Icon size={18} className={s.path === '/memory' ? 'text-[var(--color-accent)]' : undefined} />
                    {s.label}
                    {s.path === '/memory' && corpusCount > 0 && (
                      <span className="ml-auto text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full bg-[rgba(var(--accent-rgb),0.15)] text-[var(--color-accent-light)]">
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
