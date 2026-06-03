import { useEffect } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Brain, Settings, MessageSquare } from 'lucide-react'
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
  const isSettings = location.pathname === '/settings'
  const isChat = location.pathname === '/'
  const isMemory = location.pathname === '/memory'
  const corpusCount = useCorpusStore((s) => s.count)

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

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {/* Creator memory count — links to the Memory page (the corpus browse view). */}
            {corpusCount > 0 && (
              <Link
                to="/memory"
                title="Creators remembered across your searches"
                className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                  isMemory
                    ? 'bg-surface-raised text-primary font-medium'
                    : 'text-secondary hover:text-primary hover:bg-surface-raised'
                }`}
              >
                <Brain size={14} className="text-[#E07B3A]" />
                <span className="tabular-nums">{corpusCount}</span>
              </Link>
            )}

            <Link
              to="/"
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                isChat
                  ? 'bg-surface-raised text-primary font-medium'
                  : 'text-secondary hover:text-primary hover:bg-surface-raised'
              }`}
            >
              <MessageSquare size={14} />
              Chat
            </Link>

            <Link
              to="/settings"
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                isSettings
                  ? 'bg-surface-raised text-primary font-medium'
                  : 'text-secondary hover:text-primary hover:bg-surface-raised'
              }`}
            >
              <Settings size={15} />
              Settings
            </Link>
          </nav>
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
