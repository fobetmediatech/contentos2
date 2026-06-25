/**
 * useIsAdmin — whether the signed-in user has the admin role.
 *
 * Drives the "Team Access" menu item (AppLayout) + the Team Access page gate. Server-side
 * RLS / SECURITY DEFINER functions are the real enforcement; this only controls what's shown.
 */
import { useQuery } from '@tanstack/react-query'
import { isAdmin } from '../lib/teamAccess'

export function useIsAdmin(): { isAdmin: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['is-admin'],
    queryFn: isAdmin,
    staleTime: 5 * 60 * 1000,
  })
  return { isAdmin: data ?? false, isLoading }
}
