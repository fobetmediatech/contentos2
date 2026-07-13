import type { RunId } from '../domain/runs'

const controllers = new Map<RunId, AbortController>()

export function registerController(id: RunId): AbortSignal {
  const ctrl = new AbortController()
  controllers.set(id, ctrl)
  return ctrl.signal
}

export function abortRun(id: RunId): void {
  const ctrl = controllers.get(id)
  if (!ctrl) return
  ctrl.abort()
  controllers.delete(id)
}

export function disposeController(id: RunId): void {
  controllers.delete(id)
}

export function hasController(id: RunId): boolean {
  return controllers.has(id)
}
