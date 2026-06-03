import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/AppLayout'
import { ChatPage } from './pages/ChatPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReportPage } from './pages/ReportPage'
import { MemoryPage } from './pages/MemoryPage'

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 0,
      gcTime: 30 * 60 * 1000,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
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

            {/* Settings */}
            <Route path="settings" element={<SettingsPage />} />

            {/* Redirect all legacy / dead routes back to Chat */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
