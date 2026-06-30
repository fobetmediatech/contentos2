import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { devError } from '../lib/devLog'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * App-level error boundary. Without this, any unhandled render error blanks the
 * whole screen (white page) — the user has no idea what happened and no way out.
 *
 * Catches render-phase errors below it and shows a branded Chai Dark recovery
 * screen with a reload button. Errors are logged via devLog (DEV-only — never
 * leaks research-target data in prod, per C3).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    devError('[ErrorBoundary] uncaught render error', error, info.componentStack)
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div className="min-h-[100dvh] bg-chai flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 rounded-full bg-[rgba(224,92,92,0.1)] flex items-center justify-center mx-auto mb-5">
            <AlertTriangle size={30} className="text-danger" aria-hidden="true" />
          </div>
          <h1 className="font-serif italic text-3xl text-primary mb-2">Something broke</h1>
          <p className="text-sm text-muted leading-relaxed mb-6 max-w-sm mx-auto">
            An unexpected error stopped this screen from loading. Your data is safe — reloading
            usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 bg-accent hover:bg-accent-hover text-chai font-medium text-sm rounded-md px-5 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-chai"
          >
            <RotateCw size={16} aria-hidden="true" />
            Reload page
          </button>
        </div>
      </div>
    )
  }
}
