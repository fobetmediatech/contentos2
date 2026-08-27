/**
 * useIsHr — whether the signed-in user holds the HR role.
 *
 * Drives the Performance module's Teams section and the assign form. Like useIsAdmin, this is
 * UX only: RLS policies and the SECURITY DEFINER functions are the real enforcement, so hiding
 * a control here never stands in for a permission check.
 *
 * HR is deliberately separate from admin — holding one does not imply the other. Callers that
 * should accept either must check both.
 */
import { useQuery } from '@tanstack/react-query'
import { isHr } from '../lib/teamAccess'

export function useIsHr(): { isHr: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['is-hr'],
    queryFn: isHr,
    staleTime: 5 * 60 * 1000,
  })
  return { isHr: data ?? false, isLoading }
}
