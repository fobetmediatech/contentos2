import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Show, RedirectToSignIn, useAuth } from '@clerk/react'
import { setClerkTokenGetter } from './lib/supabaseClient'
import { envErrors } from './lib/env'
import { useConversationsStore } from './store/conversationsStore'
import { useReelAnalysisStore } from './store/reelAnalysisStore'
import { useCorpusStore } from './store/corpusStore'
import { AppLayout } from './components/AppLayout'
import { ChatPage } from './pages/ChatPage'
import { MemoryPage } from './pages/MemoryPage'
import { GalleryPage } from './pages/GalleryPage'
import { CalendarPage } from './pages/CalendarPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { SignInPage } from './pages/SignInPage'
import { TrackingListPage } from './pages/TrackingListPage'
import { TrackingAccountPage } from './pages/TrackingAccountPage'
import { TeamAccessPage } from './pages/TeamAccessPage'
import { StrategyPage } from './pages/StrategyPage'
import { BreakGlassListener } from './components/BreakGlassListener'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ChaiToaster } from './components/ChaiToaster'

const queryClient = new QueryClient({
  defaultOptions: {
    mutations: {
      retry: 0,
      gcTime: 30 * 60 * 1000,
    },
  },
})

/**
 * Runs inside the signed-in gate. Wires the Clerk token into the Supabase client, then
 * rehydrates the cloud-backed stores + corpus (deferred via skipHydration until a token
 * exists). On sign-out it resets the private stores + the corpus mirror so the next user
 * on a shared machine starts clean.
 */
function AuthedBootstrap() {
  const { getToken, isSignedIn } = useAuth()

  useEffect(() => {
    if (isSignedIn) {
      setClerkTokenGetter(() => getToken())
      void useConversationsStore.persist.rehydrate()
      void useReelAnalysisStore.persist.rehydrate()
      void useCorpusStore.getState().hydrate().catch(() => {})
    } else {
      setClerkTokenGetter(async () => null)
      useConversationsStore.getState().reset()
      useReelAnalysisStore.getState().reset()
      useCorpusStore.setState({ creators: {}, count: 0, hydrated: false })
    }
  }, [getToken, isSignedIn])

  return null
}

/**
 * Layout route that gates all child routes behind Clerk auth.
 * <SignedIn>  — renders the matched child route (via <Outlet>) when authenticated.
 * <SignedOut> — redirects to /sign-in when not authenticated.
 * Wrapping ALL app routes here means anonymous visitors always hit the sign-in page.
 */
function ProtectedRoute() {
  return (
    <>
      {/* Clerk v6: <Show when="signed-in"> replaces <SignedIn> */}
      <Show when="signed-in">
        <AuthedBootstrap />
        {/* App-wide: the Konami break-glass listener (recovery → admin) */}
        <BreakGlassListener />
        <Outlet />
      </Show>
      <Show when="signed-out">
        <RedirectToSignIn />
      </Show>
    </>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ChaiToaster />
        {envErrors.length > 0 && (
          <div className="fixed inset-x-0 top-0 z-50 bg-red-900/95 text-red-100 text-xs px-4 py-2 font-mono">
            <strong>Configuration incomplete — add to .env.local:</strong>
            {envErrors.map((e) => <span key={e} className="block ml-2">• {e}</span>)}
          </div>
        )}
        <BrowserRouter>
          <Routes>
            {/* Public: Clerk sign-in page — accessible without auth */}
            <Route path="/sign-in/*" element={<SignInPage />} />

            {/* Protected: all app routes — ProtectedRoute gates with Clerk */}
            <Route element={<ProtectedRoute />}>
              {/* Chat route — noPadding for full-bleed h-[100dvh] layout */}
              <Route element={<AppLayout noPadding />}>
                <Route index element={<ChatPage />} />
              </Route>

              {/* All other routes — standard layout with padding. NOTE: competitor, discovery, and
                  reel results all render INLINE in the chat now (results-as-messages), so the old
                  /results, /discover/results, and /reel-analysis pages were removed (AUDIT-H6). Any
                  stray link to them falls through to the `*` redirect below. */}
              <Route element={<AppLayout />}>
                {/* Creator/content memory — browse everything the corpus has remembered */}
                <Route path="memory" element={<MemoryPage />} />

                {/* Reel gallery — every scraped reel with its thumbnail, metrics, caption, transcript */}
                <Route path="gallery" element={<GalleryPage />} />

                {/* Calendar feature — content scheduling + finance-gated payments
                    (accounts come from the Dashboard's tracked_accounts) */}
                <Route path="calendar" element={<CalendarPage />} />
                <Route path="payments" element={<PaymentsPage />} />

                {/* Team Access — admin-only finance-role management (reached from the account menu) */}
                <Route path="team-access" element={<TeamAccessPage />} />

                {/* Content Strategizing — onboarding form → AI content strategy document (PDF) */}
                <Route path="strategy" element={<StrategyPage />} />

                {/* Instagram account tracking — list + per-account detail */}
                <Route path="tracking" element={<TrackingListPage />} />
                <Route path="tracking/:username" element={<TrackingAccountPage />} />

                {/* Redirect all legacy / dead routes back to Chat (incl. the removed /settings —
                    keys are env-only now, configured via .env / Vercel env, no in-app entry) */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
