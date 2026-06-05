import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Brain, FileText, MessageSquare } from 'lucide-react'
import { UserButton } from '@clerk/clerk-react'
import { useCorpusStore } from '../store/corpusStore'

interface AppLayoutProps {
  /**
   * T11: When true, removes page padding so ChatPage can use h-[100dvh].
   * Without this, AppLayout's py-8 px-6 causes the sticky input to overflow.
   */
  noPadding?: boolean
}

export function AppLayout({ noPadding = false }: AppLayoutProps) {
  const location = useLocation()
  const isChat = location.pathname === '/'
  const isMemory = location.pathname === '/memory'
  const isReport = location.pathname === '/report'
  const corpusCount = useCorpusStore((s) => s.count)

  // Shared nav-link styling (active = filled + primary text; idle = secondary, hover-lifts).
  const navClass = (active: boolean) =>
    `flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
      active ? 'bg-surface-raised text-primary font-medium' : 'text-secondary hover:text-primary hover:bg-surface-raised'
    }`

  // Hydrate the creator memory once for the whole app — the shell is always mounted, so the
  // remembered-count and "seen before" badges populate on whichever route the user lands on.
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

          {/* Nav links — Chat | Memory | Report */}
          <nav className="flex items-center gap-1">
            <Link to="/" className={navClass(isChat)}>
              <MessageSquare size={14} />
              Chat
            </Link>

            {/* Memory — the corpus browse view. Always visible; the count rides along as a
                badge once anything is remembered (it used to be the only, gated, entry point). */}
            <Link to="/memory" title="Creators remembered across your searches" className={navClass(isMemory)}>
              <Brain size={14} className="text-[#E07B3A]" />
              Memory
              {corpusCount > 0 && (
                <span className="ml-0.5 text-[11px] font-medium tabular-nums px-1.5 py-0.5 rounded-full bg-[rgba(224,123,58,0.15)] text-[#F4A97B]">
                  {corpusCount}
                </span>
              )}
            </Link>

            {/* Report — the deep niche report from reel analysis (empty state until one is run). */}
            <Link to="/report" className={navClass(isReport)}>
              <FileText size={14} />
              Report
            </Link>
          </nav>

          {/* User avatar — Clerk's UserButton shows initials/photo; click opens profile + sign-out popup */}
          <UserButton
            appearance={{
              variables: {
                colorBackground: '#3D3025',
                colorText: '#F5EDD6',
                colorPrimary: '#E07B3A',
              },
            }}
          />
        </div>
      </header>

      {/* Page content — noPadding mode fills remaining height for chat */}
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
