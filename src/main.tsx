import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import './index.css'
import App from './App.tsx'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

if (!PUBLISHABLE_KEY) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY — add it to .env (get it from clerk.com dashboard)')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* signInUrl tells Clerk where our sign-in page lives so <RedirectToSignIn> knows where to send users */}
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} signInUrl="/sign-in">
      <App />
    </ClerkProvider>
  </StrictMode>,
)
