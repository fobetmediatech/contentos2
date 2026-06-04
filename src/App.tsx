import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/AppLayout'
import { ChatPage } from './pages/ChatPage'
import { ReportPage } from './pages/ReportPage'
import { MemoryPage } from './pages/MemoryPage'
import { AuthGate } from './components/AuthGate'
import { useAuthStore } from './store/authStore'

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 0,
      gcTime: 30 * 60 * 1000,
    },
  },
})

export default function App() {
  useEffect(() => { void useAuthStore.getState().init() }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
      <BrowserRouter>
        <Routes>
          {/* Chat route — noPadding for full-bleed h-[100dvh] layout */}
          <Route element={<AppLayout noPadding />}>
            <Route index element={<ChatPage />} />
          </Route>

          {/* All other routes — standard layout with padding. NOTE: competitor, discovery, and
              reel results all render INLINE in the chat now (results-as-messages), so the old
              /results, /discover/results, and /reel-analysis pages were removed (AUDIT-H6). Any
              stray link to them falls through to the `*` redirect below. */}
          <Route element={<AppLayout />}>
            {/* Deep niche report (full-page, client-ready view) */}
            <Route path="report" element={<ReportPage />} />

            {/* Creator/content memory — browse everything the corpus has remembered */}
            <Route path="memory" element={<MemoryPage />} />

            {/* Redirect all legacy / dead routes back to Chat (incl. the removed /settings —
                keys are env-only now, configured via .env / Vercel env, no in-app entry) */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
      </AuthGate>
    </QueryClientProvider>
  )
}
