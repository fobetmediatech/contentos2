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
            colorBackground: '#2C2218',           // surface — slightly lifted from chai
            colorText: '#F5EDD6',                 // primary text
            colorTextSecondary: '#C4A882',        // secondary text
            colorPrimary: '#E07B3A',              // saffron accent
            colorDanger: '#F87171',               // red-400 for errors
            colorInputBackground: '#3D3025',      // surface-raised
            colorInputText: '#F5EDD6',
            colorNeutral: '#C4A882',
            borderRadius: '0.5rem',
            fontFamily: '"Outfit", system-ui, sans-serif',
          },
          elements: {
            // Subtle border to match other cards in the app
            card: 'shadow-none border border-[rgba(245,237,214,0.08)]',
            // Keep the primary button rounded to match the design system
            formButtonPrimary: 'rounded-md font-medium',
            // Muted divider lines
            dividerLine: 'bg-[rgba(245,237,214,0.08)]',
          },
        }}
      />
    </div>
  )
}
