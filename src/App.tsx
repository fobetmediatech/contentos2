import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Show, RedirectToSignIn, useAuth } from '@clerk/react'
import { setClerkTokenGetter } from './lib/supabaseClient'
import { useConversationsStore } from './store/conversationsStore'
import { useReelAnalysisStore } from './store/reelAnalysisStore'
import { useCorpusStore } from './store/corpusStore'
import { AppLayout } from './components/AppLayout'
import { ChatPage } from './pages/ChatPage'
import { ReportPage } from './pages/ReportPage'
import { MemoryPage } from './pages/MemoryPage'
import { SignInPage } from './pages/SignInPage'

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
    setClerkTokenGetter(() => getToken())
  }, [getToken])

  useEffect(() => {
    if (isSignedIn) {
      void useConversationsStore.persist.rehydrate()
      void useReelAnalysisStore.persist.rehydrate()
      void useCorpusStore.getState().hydrate().catch(() => {})
    } else {
      useConversationsStore.getState().reset()
      useReelAnalysisStore.getState().reset()
      useCorpusStore.setState({ creators: {}, count: 0, hydrated: false })
    }
  }, [isSignedIn])

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
    <QueryClientProvider client={queryClient}>
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
              {/* Deep niche report (full-page, client-ready view) */}
              <Route path="report" element={<ReportPage />} />

              {/* Creator/content memory — browse everything the corpus has remembered */}
              <Route path="memory" element={<MemoryPage />} />

              {/* Redirect all legacy / dead routes back to Chat (incl. the removed /settings —
                  keys are env-only now, configured via .env / Vercel env, no in-app entry) */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
