/**
 * FobetDeck — the FOBET strategy deck, rendered from src/deck/fobetDeck.html.
 *
 * ponytail: an IFRAME, not inline HTML. The template ships global `*{}` / `body{}` rules and a
 * fixed grid overlay that would leak out and wreck the app's styling. srcDoc isolates it for free,
 * and iframe.print() prints the deck alone so the template's own @media print rules apply.
 *
 * Extracted so the form (/strategy/brief, after generating) and the standalone route
 * (/strategy/deck/:clientId) render the SAME deck. They previously did not: the form showed the
 * older StrategyDeck component while this template was only reachable by typing a URL nothing
 * linked to.
 */
import { useMemo, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Printer, Sparkles, Loader2 } from 'lucide-react'
import { fillDeck, slotsFromBrief, fillCompetitorTable, type SlotKey, type CompetitorRow } from '../lib/deckTemplate'
import { fillDeckSlots } from '../lib/meetingsClient'
import type { StrategyResult } from '../domain/strategy'

export function FobetDeck({ result }: { result: StrategyResult }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [aiSlots, setAiSlots] = useState<Partial<Record<SlotKey, string>>>({})

  /** Section 04 — competitors only; that page is about who they compete with, not who they admire. */
  const competitorRows: CompetitorRow[] = useMemo(() => {
    const byHandle = new Map((result.hookSummaries ?? []).map((h) => [h.handle.toLowerCase(), h]))
    return (result.accounts ?? [])
      .filter((a) => a.source !== 'aspirational')
      .map((a) => {
        const hooks = byHandle.get(a.username.toLowerCase())
        return {
          username: a.username,
          followers: a.followers,
          medianViews: hooks?.benchmarks?.medianViews ?? null,
          engagementRate: a.engagementRate,
          formats: (hooks?.dominantHooks ?? []).map((h) => h.pattern),
        }
      })
  }, [result])

  const fill = useMutation({
    mutationFn: () => fillDeckSlots(result.brief, result.doc),
    onSuccess: (r) => setAiSlots(r.slots),
  })

  // Slots the model has not written stay as the template's dashed blanks — that is how a
  // strategist sees what still needs writing, rather than reading filler as finished work.
  const html = useMemo(
    () => fillCompetitorTable(
      fillDeck({ ...slotsFromBrief(result.brief, new Date()), ...aiSlots }),
      competitorRows,
    ),
    [result.brief, aiSlots, competitorRows],
  )

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 no-print">
        <button
          onClick={() => fill.mutate()}
          disabled={fill.isPending}
          className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5 disabled:opacity-40"
        >
          {fill.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {fill.data ? 'Rewrite the blanks' : 'Write the blanks'}
        </button>
        <button
          onClick={() => frame.current?.contentWindow?.print()}
          className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5"
        >
          <Printer size={14} /> Print / PDF
        </button>
        {fill.data && fill.data.blank.length > 0 && (
          <span className="text-muted text-xs">
            {fill.data.blank.length} slot(s) left blank — write those by hand.
          </span>
        )}
        {fill.isError && (
          <span className="text-[var(--color-error)] text-xs">Could not write the blanks — try again.</span>
        )}
      </div>

      <iframe
        ref={frame}
        title="Content strategy deck"
        srcDoc={html}
        className="w-full rounded-lg border border-[rgba(var(--border-rgb),0.12)] bg-white"
        style={{ height: 'calc(100dvh - 200px)' }}
      />
    </div>
  )
}
