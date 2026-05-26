import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppLayout } from './components/AppLayout'
import { InputPage } from './pages/InputPage'
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
          <Route element={<AppLayout />}>
            {/* Competitor analysis flow */}
            <Route index element={<InputPage />} />
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
