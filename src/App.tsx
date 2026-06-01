import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/AppLayout'
import { ChatPage } from './pages/ChatPage'
import { ResultsPage } from './pages/ResultsPage'
import { DiscoveryResultsPage } from './pages/DiscoveryResultsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ReelAnalysisPage } from './pages/ReelAnalysisPage'

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
            {/* Competitor analysis results */}
            <Route path="results" element={<ResultsPage />} />

            {/* Location discovery results */}
            <Route path="discover/results" element={<DiscoveryResultsPage />} />

            {/* Reel analysis */}
            <Route path="reel-analysis" element={<ReelAnalysisPage />} />

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
