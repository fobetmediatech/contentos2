import { Toaster } from 'sonner'

/**
 * App-wide toast surface, themed to the Chai Dark system (see DESIGN.md).
 *
 * Mounted once at the app root. Components fire notifications via the `toast`
 * helper in `src/lib/toast.ts`. Sonner reads these CSS variables for the
 * default ("normal") toast; success/error/warning variants are themed inline
 * via toastOptions so semantic colors stay on-brand instead of Sonner defaults.
 */
export function ChaiToaster() {
  return (
    <Toaster
      position="top-center"
      gap={8}
      offset={16}
      toastOptions={{
        style: {
          background: '#3D3025',
          border: '1px solid rgba(245, 237, 214, 0.15)',
          color: '#F5EDD6',
          fontFamily: '"Outfit", sans-serif',
          fontSize: '14px',
          borderRadius: '10px',
        },
        classNames: {
          description: 'text-[#C4A882]',
          actionButton: '!bg-[#E07B3A] !text-[#1A1410] !font-medium',
          cancelButton: '!bg-transparent !text-[#C4A882]',
        },
      }}
      icons={undefined}
      style={
        {
          '--success-bg': '#3D3025',
          '--success-text': '#4CAF7D',
          '--success-border': 'rgba(76, 175, 125, 0.4)',
          '--error-bg': '#3D3025',
          '--error-text': '#E05C5C',
          '--error-border': 'rgba(224, 92, 92, 0.4)',
          '--warning-bg': '#3D3025',
          '--warning-text': '#F4A97B',
          '--warning-border': 'rgba(217, 119, 6, 0.4)',
        } as React.CSSProperties
      }
    />
  )
}
