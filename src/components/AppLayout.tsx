import { Link, Outlet, useLocation } from 'react-router-dom'
import { Settings, Search, MapPin, MessageSquare } from 'lucide-react'

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
  const isDiscover = location.pathname.startsWith('/discover')
  const isChat = location.pathname === '/'
  const isAnalyze = !isSettings && !isDiscover && !isChat

  return (
    <div className={`${noPadding ? 'h-[100dvh] flex flex-col overflow-hidden' : 'min-h-screen'} bg-slate-50`}>
      {/* Top navigation bar */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm flex-shrink-0">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Brand */}
          <Link
            to="/"
            className="text-base font-semibold text-slate-900 hover:text-indigo-600 transition-colors"
          >
            Content OS 2.0
          </Link>

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            <Link
              to="/"
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                isChat
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <MessageSquare size={14} />
              Chat
            </Link>

            <Link
              to="/analyze"
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                isAnalyze
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <Search size={14} />
              Analyze
            </Link>

            <Link
              to="/discover"
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                isDiscover
                  ? 'bg-teal-50 text-teal-800 font-medium'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
              }`}
            >
              <MapPin size={14} />
              Discover
            </Link>

            <Link
              to="/settings"
              className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md transition-colors ${
                isSettings
                  ? 'bg-slate-100 text-slate-900 font-medium'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
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
