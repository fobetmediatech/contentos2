/**
 * StrategyReviewPage — the pre-filled onboarding form with provenance visible (route
 * /strategy/review/:clientId).
 *
 * The design goal is that a human verifies a full form in UNDER FIVE MINUTES, so every interaction
 * here is measured against that:
 *   - one "approve all" for the bulk of correct extractions, rather than 18 individual clicks
 *   - citations collapsed by default and one click away, because most will not be opened
 *   - blockers stated at the top with what to do, not discovered by a disabled button
 *
 * Handing the brief over calls strategyStore.setBrief() and navigates to the existing form. The
 * 4-stage pipeline is untouched — it still receives a plain StrategyBrief and runs only when a
 * human presses Generate.
 */
import { useMemo, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Quote, Sparkles, CheckCheck, AlertTriangle, Undo2 } from 'lucide-react'
import { listExtractions, listClients, saveRow, approveRows, createRow } from '../lib/reviewRepo'
import {
  buildBriefFromExtractions, evaluateGate, approvableRows,
  COMPETITOR_SLOTS, ASPIRATIONAL_SLOTS,
  type ExtractionRow,
} from '../lib/reviewGate'
import { useStrategyStore } from '../store/strategyStore'
import { SAMPLE_EXTRACTIONS, SAMPLE_CLIENT_ID } from '../lib/sampleStrategy'

const eyebrow = 'text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-3 mt-6 first:mt-0'
const labelCls = 'block text-xs text-muted mb-1'
const inputCls =
  'w-full bg-[var(--color-surface-raised)] border border-[rgba(var(--border-rgb),0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[var(--color-accent)]'

/** Mirrors the form's own section order so a reviewer's eye lands where it already knows to look. */
const SECTIONS: Array<{ eyebrow: string; fields: Array<{ name: string; label: string }> }> = [
  {
    eyebrow: 'A · Basic information',
    fields: [
      { name: 'brandName', label: 'Client / brand name *' },
      { name: 'primaryNiche', label: 'Primary niche' },
      { name: 'subNiche', label: 'Sub-niche / exact speciality' },
      { name: 'offer', label: 'What exactly are we selling? *' },
      { name: 'language', label: 'Content language' },
    ],
  },
  { eyebrow: 'B · Target audience', fields: [{ name: 'audience', label: 'Target audience' }] },
  {
    eyebrow: 'C · Competitors & aspirational accounts',
    fields: [
      ...Array.from({ length: COMPETITOR_SLOTS }, (_, i) => ({ name: `competitors.${i}`, label: `Direct competitor ${i + 1}` })),
      ...Array.from({ length: ASPIRATIONAL_SLOTS }, (_, i) => ({ name: `aspirational.${i}`, label: `Aspirational ${i + 1}` })),
    ],
  },
  {
    eyebrow: 'D · Brand & restrictions',
    fields: [
      { name: 'brandColors', label: 'Brand colour' },
      { name: 'dislikes', label: 'Topics / styles they dislike' },
      { name: 'offLimits', label: 'Off-limits topics' },
    ],
  },
]

const fmtTime = (s: number | null): string => {
  if (s === null) return ''
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

export function StrategyReviewPage() {
  const { clientId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const setBrief = useStrategyStore((s) => s.setBrief)
  const [open, setOpen] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  // Preview mode: /strategy/review/sample renders a fixture instead of querying Supabase, so the
  // review surface can be looked at without an ingested transcript, a Gemini key, or any credits.
  // It contains no real client data, so it is not admin-gated.
  const isSample = clientId === SAMPLE_CLIENT_ID
  const [sampleRows, setSampleRows] = useState(SAMPLE_EXTRACTIONS)

  const clients = useQuery({ queryKey: ['cb-clients'], queryFn: listClients, enabled: !isSample })
  const rowsQ = useQuery({
    queryKey: ['cb-extractions', clientId],
    queryFn: () => listExtractions(clientId),
    enabled: !isSample && Boolean(clientId),
  })

  const rows = useMemo(() => (isSample ? sampleRows : rowsQ.data ?? []), [isSample, sampleRows, rowsQ.data])
  const byField = useMemo(() => new Map(rows.map((r) => [r.fieldName, r])), [rows])
  const gate = useMemo(() => evaluateGate(rows), [rows])
  const pending = useMemo(() => approvableRows(rows), [rows])
  const client = clients.data?.find((c) => c.id === clientId)

  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['cb-extractions', clientId] }) }

  /** In preview mode edits stay in local state — there is no row to write and no client to own it. */
  const patchSample = (ids: Set<string>, patch: Partial<ExtractionRow>) =>
    setSampleRows((rs) =>
      rs.map((r) =>
        ids.has(r.id)
          ? { ...r, ...patch, originalValue: r.originalValue ?? (patch.value !== undefined ? r.value : null) }
          : r,
      ),
    )

  /** Typing into a field extraction never produced — creates the row instead of dropping the value. */
  const createValue = useMutation({
    mutationFn: async ({ fieldName, value }: { fieldName: string; value: string }) => {
      if (isSample) {
        setSampleRows((rs) => [...rs, {
          id: `new-${fieldName}`, fieldName, value: value.trim() || null, citations: [],
          provenance: 'sheet', confidence: null, reviewStatus: 'edited', originalValue: null,
        }])
        return
      }
      await createRow(clientId, fieldName, value)
    },
    onSuccess: () => { if (!isSample) invalidate() },
  })

  const save = useMutation({
    mutationFn: async ({ row, patch }: { row: ExtractionRow; patch: { value?: string | null; reviewStatus?: ExtractionRow['reviewStatus'] } }) => {
      if (isSample) {
        patchSample(new Set([row.id]), {
          ...(patch.value !== undefined ? { value: patch.value, reviewStatus: 'edited' as const } : {}),
          ...(patch.reviewStatus !== undefined ? { reviewStatus: patch.reviewStatus } : {}),
        })
        return
      }
      await saveRow(row, patch)
    },
    onSuccess: () => { if (!isSample) invalidate() },
  })
  const approveAll = useMutation({
    mutationFn: async () => {
      const ids = new Set(pending.map((r) => r.id))
      if (isSample) { patchSample(ids, { reviewStatus: 'approved' }); return }
      await approveRows([...ids])
    },
    onSuccess: () => { if (!isSample) invalidate() },
  })

  if (rowsQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-secondary text-sm py-16 justify-center">
        <Loader2 size={15} className="animate-spin" /> Loading review…
      </div>
    )
  }

  const useBrief = () => {
    setBrief(buildBriefFromExtractions(rows))
    void navigate('/strategy/brief')
  }

  return (
    <div className="max-w-4xl mx-auto pb-16">
      <Link to="/strategy/brief" className="inline-flex items-center gap-1.5 text-muted hover:text-primary text-sm mb-4">
        <ArrowLeft size={14} /> Strategy
      </Link>

      <h1 className="font-serif italic text-3xl text-primary">Review brief</h1>
      <p className="text-secondary text-sm mt-1">
        {isSample ? 'Sample client' : client ? client.displayName : 'Client'} — every extracted value carries a citation. Correct anything wrong, then hand it to the form.
      </p>

      {isSample && (
        <p className="mt-3 text-[11px] font-mono uppercase tracking-wider text-[var(--color-warning)]">
          Preview · sample data · edits are not saved
        </p>
      )}

      {rows.length === 0 ? (
        <div className="mt-8 bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-6 text-center">
          <p className="text-secondary text-sm">No extractions yet for this client.</p>
          <p className="text-muted text-xs mt-1">Ingest an onboarding transcript, then run extraction.</p>
        </div>
      ) : (
        <>
          {/* Blockers — stated up front. A disabled button with no explanation is the failure mode. */}
          {gate.blocked && (
            <div className="mt-5 bg-[rgba(var(--border-rgb),0.04)] border border-[var(--color-warning)] rounded-lg p-4">
              <div className="flex items-center gap-2 text-[var(--color-warning)] text-sm font-medium">
                <AlertTriangle size={15} /> Not ready to generate
              </div>
              <ul className="mt-2 space-y-1">
                {gate.blockers.map((b) => (
                  <li key={b.code} className="text-secondary text-sm">• {b.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={() => approveAll.mutate()}
              disabled={pending.length === 0 || approveAll.isPending}
              className="flex items-center gap-1.5 bg-surface-raised hover:bg-[var(--color-surface-elevated)] disabled:opacity-40 text-primary text-sm font-medium rounded-md px-4 py-2 border border-[rgba(var(--border-rgb),0.12)]"
            >
              {approveAll.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
              Approve all cited ({pending.length})
            </button>
            <button
              onClick={useBrief}
              disabled={gate.blocked}
              className="bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:opacity-40 text-white text-sm font-medium rounded-md px-5 py-2"
            >
              Use this brief →
            </button>
          </div>

          {SECTIONS.map((section) => (
            <section key={section.eyebrow}>
              <div className={eyebrow}>{section.eyebrow}</div>
              <div className="space-y-3">
                {section.fields.map((f) => {
                  const row = byField.get(f.name)
                  const value = drafts[f.name] ?? row?.value ?? ''
                  const isEmpty = !value.trim()
                  const isInferred = row?.provenance === 'inferred'
                  const isOpen = open === f.name

                  return (
                    <div key={f.name} className="bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className={labelCls + ' mb-0'}>{f.label}</span>
                        <div className="flex items-center gap-1.5">
                          {/* Empty stays visually empty — no badge, nothing implying a value exists. */}
                          {!isEmpty && row && (
                            <>
                              {isInferred && (
                                <span className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[var(--color-ai-tint)]">
                                  <Sparkles size={11} /> inferred
                                  {row.confidence !== null && ` ${Math.round(row.confidence * 100)}%`}
                                </span>
                              )}
                              {row.provenance === 'sheet' && (
                                <span className="text-[11px] font-mono uppercase tracking-wider text-muted">sheet</span>
                              )}
                              {row.citations.length > 0 && (
                                <button
                                  onClick={() => setOpen(isOpen ? null : f.name)}
                                  aria-expanded={isOpen}
                                  aria-label={`${isOpen ? 'Hide' : 'Show'} ${row.citations.length} ${row.citations.length === 1 ? 'citation' : 'citations'} for ${f.label}`}
                                  className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-wider text-[var(--color-success)] hover:underline"
                                >
                                  <Quote size={11} /> {row.citations.length}
                                </button>
                              )}
                              {row.reviewStatus === 'approved' && (
                                <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-success)]">✓</span>
                              )}
                              {row.reviewStatus === 'edited' && (
                                <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--color-warning)]">edited</span>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <input
                        className={inputCls}
                        value={value}
                        placeholder={row ? 'Not stated on the call' : 'Not extracted'}
                        onChange={(e) => setDrafts((d) => ({ ...d, [f.name]: e.target.value }))}
                        onBlur={() => {
                          const draft = drafts[f.name]
                          if (draft === undefined) return
                          if (row) {
                            if (draft !== (row.value ?? '')) save.mutate({ row, patch: { value: draft } })
                          } else if (draft.trim()) {
                            // No extraction row for this field — create one, or the value is lost.
                            createValue.mutate({ fieldName: f.name, value: draft })
                          }
                        }}
                      />

                      {isInferred && row?.reviewStatus === 'pending' && !isEmpty && (
                        <button
                          onClick={() => save.mutate({ row, patch: { reviewStatus: 'approved' } })}
                          className="mt-2 text-xs text-[var(--color-ai-tint)] hover:underline"
                        >
                          Sign off on this inference
                        </button>
                      )}

                      {row?.originalValue && (
                        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                          <Undo2 size={11} />
                          was: <span className="italic">{row.originalValue}</span>
                        </div>
                      )}

                      {isOpen && row && (
                        <div className="mt-2 space-y-2">
                          {row.citations.map((c, i) => (
                            <blockquote
                              key={i}
                              className="border-l-2 border-[var(--color-success)] pl-3 py-1 text-sm text-secondary"
                            >
                              “{c.quote}”
                              {c.start_sec !== null && (
                                <span className="ml-2 font-mono text-[11px] text-muted">@ {fmtTime(c.start_sec)}</span>
                              )}
                            </blockquote>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
