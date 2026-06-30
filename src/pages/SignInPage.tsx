import { SignIn } from '@clerk/react'

/**
 * Sign-in page for the auth gate. Centered on a chai dark background so the
 * Clerk card looks at home in the DESIGN.md colour system.
 *
 * Clerk's appearance.variables map directly to its internal CSS tokens — no
 * extra stylesheet needed. elements.card / elements.formButtonPrimary let us
 * tweak the shadow and button corners via Tailwind.
 */
export function SignInPage() {
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
          variables: {
            colorBackground: '#0A3323',           // surface — slightly lifted from chai
            colorText: '#F7F4D5',                 // primary text
            colorTextSecondary: '#B8C49B',        // secondary text
            colorPrimary: '#D3968C',              // rosy brown accent
            colorTextOnPrimaryBackground: '#082619', // dark text on rosy button
            colorDanger: '#D9706A',               // error red (Lotus Pond)
            colorInputBackground: '#0F4730',      // surface-raised
            colorInputText: '#F7F4D5',
            colorNeutral: '#B8C49B',
            borderRadius: '0.5rem',
            fontFamily: '"Outfit", system-ui, sans-serif',
          },
          elements: {
            // Subtle border to match other cards in the app
            card: 'shadow-none border border-[rgba(var(--border-rgb),0.08)]',
            // Keep the primary button rounded to match the design system
            formButtonPrimary: 'rounded-md font-medium',
            // Muted divider lines
            dividerLine: 'bg-[rgba(var(--border-rgb),0.08)]',
          },
        }}
      />
    </div>
  )
}
