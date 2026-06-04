import type { ReactNode } from 'react'
import { useAuthStore } from '../store/authStore'
import { LoginPage } from '../pages/LoginPage'

export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  if (status === 'loading') {
    return <div className="h-[100dvh] flex items-center justify-center bg-chai text-muted">Loading…</div>
  }
  if (status === 'signed-out') return <LoginPage />
  return <>{children}</>
}
