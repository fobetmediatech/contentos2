/**
 * GalleryPage — browse every reel the OS has scraped (Feature: reel gallery).
 *
 * Reads the shared content corpus (corpus.listAllContent) and renders a compact card per
 * reel. The FIRST click expands the card into an Instagram-desktop-style modal: the live
 * reel (Instagram embed) on the left, and its metrics + caption + transcript on the right.
 * URL-only by design — we never store a downloaded video; the embed loads the live media,
 * which also sidesteps the fact that stored thumbnail CDN URLs expire.
 */

import { useEffect, useRef, useState } from 'react'
import {
  Clapperboard,
  Play,
  Eye,
  Heart,
  MessageCircle,
  ExternalLink,
  X,
} from 'lucide-react'
import { corpus } from '../lib/corpusIdb'
import type { ContentRecord } from '../lib/corpus'
import { ReelCardSkeleton } from '../components/Skeleton'
import { EmptyState } from '../components/EmptyState'

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

/** Instagram embeds resolve by shortcode under /reel/<code>/embed (works for reels + posts). */
function embedSrc(reel: ContentRecord): string {
  return `https://www.instagram.com/reel/${reel.id}/embed`
}

function Metrics({ reel, size = 12 }: { reel: ContentRecord; size?: number }) {
  return (
    <div className="flex items-center gap-3 text-xs text-[var(--color-text-secondary)] font-mono tabular-nums">
      <span className="inline-flex items-center gap-1">
        <Eye size={size} />
        {formatCount(reel.videoViewCount)}
      </span>
      <span className="inline-flex items-center gap-1">
        <Heart size={size} />
        {formatCount(reel.likesCount)}
      </span>
      <span className="inline-flex items-center gap-1">
        <MessageCircle size={size} />
        {formatCount(reel.commentsCount)}
      </span>
    </div>
  )
}

export function GalleryPage() {
  // null = still loading; [] = loaded-but-empty. Local fetch (no store) mirrors how
  // MemoryPage's cards lazy-load content — the gallery is a read-only corpus view.
  const [reels, setReels] = useState<ContentRecord[] | null>(null)
  const [selected, setSelected] = useState<ContentRecord | null>(null)

  useEffect(() => {
    let alive = true
    corpus
      .listAllContent({ limit: 200 })
      .then((r) => alive && setReels(r))
      .catch(() => alive && setReels([]))
    return () => {
      alive = false
    }
  }, [])

  const loading = reels === null

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Clapperboard size={20} className="text-[var(--color-accent)]" />
        <h1 className="font-serif italic text-2xl text-[var(--color-text-primary)] tracking-tight">Reel Gallery</h1>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)] mb-5">
        {loading
          ? 'Loading…'
          : `${reels.length} reel${reels.length !== 1 ? 's' : ''} scraped across your searches.`}
      </p>

      {loading ? (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <ReelCardSkeleton key={i} />
          ))}
        </div>
      ) : reels.length === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="No reels yet"
          description="Analyze a creator's reels in chat and every one shows up here, with its metrics, caption, and transcript."
          action={{ label: 'Analyze a creator', to: '/' }}
        />
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {reels.map((reel) => (
            <ReelGalleryCard key={reel.id} reel={reel} onExpand={() => setSelected(reel)} />
          ))}
        </div>
      )}

      {selected && <ReelModal reel={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

/**
 * Card cover. Stored thumbnail CDN URLs (Apify `displayUrl`) expire and old reels were
 * harvested before thumbnails were stored, so render in three tiers: the stored image when it
 * loads → else a LAZY Instagram embed (live cover, never expires) mounted only once the card
 * scrolls near the viewport (so a 60-card grid doesn't load 60 embeds at once) → else a
 * placeholder until then. Non-interactive (pointer-events-none) so the overlay button still
 * catches the click-to-expand.
 */
function ReelThumb({ reel }: { reel: ContentRecord }) {
  const [imgFailed, setImgFailed] = useState(false)
  // SSR / jsdom (no IntersectionObserver) → start in-view so there's no lazy gate to satisfy.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === 'undefined')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          obs.disconnect()
        }
      },
      { rootMargin: '400px' }, // warm up just before it scrolls in
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const showImg = !!reel.thumbnailUrl && !imgFailed

  return (
    <div ref={ref} className="absolute inset-0 pointer-events-none">
      {showImg ? (
        <img
          src={reel.thumbnailUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setImgFailed(true)}
        />
      ) : inView ? (
        <iframe
          src={embedSrc(reel)}
          title={`Instagram reel by @${reel.creatorUsername}`}
          className="absolute inset-0 w-full h-full border-0"
          loading="lazy"
          scrolling="no"
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <Play size={28} className="text-[var(--color-accent)]" />
          <span className="text-xs text-[var(--color-text-muted)] line-clamp-3">{reel.caption || 'View reel'}</span>
        </div>
      )}
    </div>
  )
}

function ReelGalleryCard({ reel, onExpand }: { reel: ContentRecord; onExpand: () => void }) {
  return (
    <div className="bg-[var(--color-surface)] border border-[rgba(var(--border-rgb),0.08)] rounded-xl overflow-hidden flex flex-col">
      {/* First click expands into the modal (NOT a direct link out — the modal has that). The
          cover sits behind a transparent overlay button so the embed iframe never steals clicks. */}
      <div className="relative aspect-[4/5] w-full bg-[var(--color-bg)] overflow-hidden">
        <ReelThumb reel={reel} />
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Expand reel by @${reel.creatorUsername}`}
          className="group absolute inset-0 flex items-center justify-center"
        >
          <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="relative inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-bg)] bg-[var(--color-accent)] px-3 py-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
            <Play size={13} /> Expand
          </span>
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2">
        <span className="text-sm font-semibold text-[var(--color-text-primary)] truncate">@{reel.creatorUsername}</span>
        <Metrics reel={reel} />
        {reel.hookArchetype && (
          // Hook archetype is Gemini-classified → violet tint per DESIGN.md.
          <span className="self-start text-xs px-2 py-0.5 rounded-full bg-[rgba(var(--ai-rgb),0.10)] text-[var(--color-ai-tint)] border border-[rgba(var(--ai-rgb),0.20)]">
            {reel.hookArchetype}
          </span>
        )}
        {reel.caption && (
          <p className="text-xs text-[var(--color-text-secondary)] leading-snug line-clamp-2">{reel.caption}</p>
        )}
      </div>
    </div>
  )
}

function ReelModal({ reel, onClose }: { reel: ContentRecord; onClose: () => void }) {
  // Esc to close + lock background scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reel by @${reel.creatorUsername}`}
        onClick={(e) => e.stopPropagation()}
        className="relative flex flex-col md:flex-row w-full max-w-4xl max-h-[90vh] overflow-y-auto md:overflow-hidden rounded-2xl border border-[rgba(var(--border-rgb),0.12)] bg-[var(--color-bg)] shadow-[0_24px_80px_rgba(0,0,0,0.7)]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-2.5 right-2.5 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-black/50 text-[var(--color-text-primary)] hover:bg-black/70 transition-colors"
        >
          <X size={18} />
        </button>

        {/* LEFT — the live reel (Instagram embed). Portrait, like Instagram's desktop media pane. */}
        <div className="flex-shrink-0 md:w-[400px] bg-black flex items-stretch">
          <iframe
            src={embedSrc(reel)}
            title={`Instagram reel by @${reel.creatorUsername}`}
            className="w-full h-[60vh] md:h-auto md:min-h-[580px] border-0"
            loading="lazy"
            allow="encrypted-media; picture-in-picture; clipboard-write"
            allowFullScreen
          />
        </div>

        {/* RIGHT — details: header, metrics, caption, transcript (Instagram-desktop side column). */}
        <div className="flex flex-col min-w-0 md:w-[360px] md:max-h-[90vh]">
          <div className="p-4 border-b border-[rgba(var(--border-rgb),0.08)]">
            <a
              href={`https://www.instagram.com/${reel.creatorUsername}/`}
              target="_blank"
              rel="noreferrer"
              className="text-base font-semibold text-[var(--color-text-primary)] hover:text-[var(--color-accent-light)] transition-colors"
            >
              @{reel.creatorUsername}
            </a>
            <div className="mt-2">
              <Metrics reel={reel} size={13} />
            </div>
          </div>

          <div className="p-4 md:overflow-y-auto flex flex-col gap-4">
            {reel.hookArchetype && (
              <span className="self-start text-xs px-2 py-0.5 rounded-full bg-[rgba(var(--ai-rgb),0.10)] text-[var(--color-ai-tint)] border border-[rgba(var(--ai-rgb),0.20)]">
                {reel.hookArchetype}
              </span>
            )}

            {reel.caption && (
              <section>
                <h3 className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Caption</h3>
                <p className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">{reel.caption}</p>
              </section>
            )}

            <section>
              <h3 className="text-[11px] font-mono uppercase tracking-wide text-[var(--color-text-muted)] mb-1.5">Transcript</h3>
              {reel.transcript ? (
                <p className="text-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">{reel.transcript}</p>
              ) : (
                <p className="text-sm text-[var(--color-text-muted)] italic">No transcript captured for this reel.</p>
              )}
            </section>

            <a
              href={reel.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 self-start text-sm text-[var(--color-accent)] hover:underline"
            >
              <ExternalLink size={14} /> Open on Instagram
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
