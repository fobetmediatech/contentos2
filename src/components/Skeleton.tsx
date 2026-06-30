/**
 * Skeleton — warm shimmer placeholders shown while data loads.
 *
 * Replaces blank screens and "Loading…" text, which cause layout shift when the
 * real content pops in. The shimmer animation lives in index.css (`.skeleton`)
 * and flattens to a static surface under prefers-reduced-motion.
 *
 *   <Skeleton className="h-4 w-32" />          // a single bar
 *   <ReelCardSkeleton />                        // a gallery card placeholder
 */

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return <div aria-hidden="true" className={`skeleton rounded-md ${className}`} />
}

/** Card placeholder matching the reel gallery's aspect + metric rows. */
export function ReelCardSkeleton() {
  return (
    <div className="bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] rounded-xl overflow-hidden flex flex-col">
      <Skeleton className="aspect-[4/5] w-full !rounded-none" />
      <div className="p-3 flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-full" />
      </div>
    </div>
  )
}

/** Row placeholder for list-style surfaces (Memory creators, tracked accounts). */
export function ListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] rounded-lg px-4 py-3">
      <Skeleton className="w-11 h-11 rounded-full flex-shrink-0" />
      <div className="flex-1 flex flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  )
}
