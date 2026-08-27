/**
 * useUnreadNotifications — unread Performance inbox count, for the nav badge.
 *
 * Deliberately failure-silent: this runs on every authenticated page, and a missing table (the
 * migration not yet applied) or a transient network blip must not surface an error in the global
 * nav. No badge is the correct degraded state — the inbox itself reports real failures.
 *
 * Polls on an interval rather than opening a realtime channel: a count that is a minute stale is
 * fine for a badge, and it costs one cheap indexed query instead of a persistent socket.
 */
import { useQuery } from '@tanstack/react-query'
import { listNotifications } from '../lib/performanceRepo'
import { unreadCount } from '../domain/performance'

export function useUnreadNotifications(): number {
  const { data } = useQuery({
    queryKey: ['performance-notifications'],
    queryFn: listNotifications,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    retry: false,
  })
  return data ? unreadCount(data) : 0
}
