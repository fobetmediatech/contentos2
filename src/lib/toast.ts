/**
 * Toast helper — single import point for app notifications.
 *
 * Re-exports Sonner's `toast` so call sites import from here, not the library
 * directly. This keeps the notification surface swappable and lets us layer on
 * Chai Dark defaults in one place. Visual theming lives in `ChaiToaster.tsx`.
 *
 * Usage:
 *   toast.success('Conversation deleted', { action: { label: 'Undo', onClick } })
 *   toast.error("Couldn't add the payment")
 *   toast('Select up to 5 creators at a time')
 */
export { toast } from 'sonner'
