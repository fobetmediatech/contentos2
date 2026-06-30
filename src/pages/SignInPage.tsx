import { SignIn } from '@clerk/react'
import { useColorScheme } from '../hooks/useColorScheme'
import { clerkVariables } from '../lib/clerkTheme'

/**
 * Sign-in page for the auth gate. Centered on the app background so the Clerk
 * card looks at home in the DESIGN.md colour system.
 *
 * Clerk's appearance.variables need real hex (it derives shades in JS), so they
 * are scheme-keyed via clerkVariables() and flip with the OS light/dark theme —
 * no more dark card stranded on a light page. element colors use CSS vars.
 */
export function SignInPage() {
  const scheme = useColorScheme()
  return (
    <div className="min-h-screen bg-chai flex flex-col items-center justify-center gap-6 px-4">
      {/* Brand header — keeps the app feeling cohesive above the Clerk card */}
      <div className="text-center">
        <h1 className="font-serif italic text-3xl text-primary mb-1 tracking-tight">Content OS</h1>
        <p className="text-secondary text-sm">Creator research — team access only</p>
      </div>

      <SignIn
        routing="path"
        path="/sign-in"
        fallbackRedirectUrl="/"
        appearance={{
          variables: { ...clerkVariables(scheme), borderRadius: '0.5rem' },
          elements: {
            // Blend into the page: no heavy shadow, just a whisper border
            card: 'shadow-none border border-[rgba(var(--border-rgb),0.08)]',
            formButtonPrimary: 'rounded-md font-medium',
            dividerLine: 'bg-[rgba(var(--border-rgb),0.08)]',
          },
        }}
      />
    </div>
  )
}
