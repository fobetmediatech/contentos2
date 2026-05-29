import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/AppLayout'
import { ChatPage } from './pages/ChatPage'
import { ProgressPage } from './pages/ProgressPage'
import { ResultsPage } from './pages/ResultsPage'
import { SettingsPage } from './pages/SettingsPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { DiscoveryProgressPage } from './pages/DiscoveryProgressPage'
import { DiscoveryResultsPage } from './pages/DiscoveryResultsPage'

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

          {/* All other routes — standard layout with padding */}
          <Route element={<AppLayout />}>
            {/* Competitor analysis flow — /analyze redirects to chat */}
            <Route path="analyze" element={<Navigate to="/" replace />} />
            <Route path="progress" element={<ProgressPage />} />
            <Route path="results" element={<ResultsPage />} />

            {/* Location discovery flow */}
            <Route path="discover" element={<DiscoverPage />} />
            <Route path="discover/progress" element={<DiscoveryProgressPage />} />
            <Route path="discover/results" element={<DiscoveryResultsPage />} />

            {/* Settings */}
            <Route path="settings" element={<SettingsPage />} />

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
