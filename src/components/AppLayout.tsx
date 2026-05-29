import { Link, Outlet, useLocation } from 'react-router-dom'
import { Settings, Search, MapPin } from 'lucide-react'

export function AppLayout() {
  const location = useLocation()
  const isSettings = location.pathname === '/settings'
  const isDiscover = location.pathname.startsWith('/discover')
  const isAnalyze = !isSettings && !isDiscover

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top navigation bar */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
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

      {/* Page content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  )
}
