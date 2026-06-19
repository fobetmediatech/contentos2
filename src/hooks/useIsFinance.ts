/**
 * useIsFinance — whether the signed-in user has the finance role.
 *
 * Drives both the Payments nav visibility (AppLayout) and the Payments page gate.
 * Server-side RLS is the real enforcement; this only controls what's shown.
 */
import { useQuery } from '@tanstack/react-query'
import { isFinance } from '../lib/calendarRepo'

export function useIsFinance(): { isFinance: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ['is-finance'],
    queryFn: isFinance,
    staleTime: 5 * 60 * 1000,
  })
  return { isFinance: data ?? false, isLoading }
}
