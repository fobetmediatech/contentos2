/**
 * CalendarPage — the content calendar (plan-only).
 *
 * Month grid: pick a tracked account (from the Dashboard) or all, click a day's + to
 * schedule a post, drag a post to another day to reschedule, move it through
 * idea → draft → scheduled → posted (→ skipped). Never auto-publishes.
 */
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react'
import {
  listAccounts,
  listScheduledPosts,
  createScheduledPost,
  updateScheduledPost,
  deleteScheduledPost,
} from '../lib/calendarRepo'
import { SearchablePicker } from '../components/SearchablePicker'
import type { ContentType, PostStatus, ScheduledPost } from '../domain/calendar'

const CONTENT_TYPES: ContentType[] = ['reel', 'post', 'story', 'carousel']
const STATUSES: PostStatus[] = ['idea', 'draft', 'scheduled', 'posted', 'skipped']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Distinct hues per status so day chips are easy to tell apart: grey → yellow → orange → green → red.
const STATUS_STYLES: Record<PostStatus, string> = {
  idea: 'bg-[rgba(122,106,84,0.22)] text-[#C4A882]',
  draft: 'bg-[rgba(232,197,71,0.16)] text-[#E8C547]',
  scheduled: 'bg-[rgba(224,123,58,0.22)] text-[#F4A97B]',
  posted: 'bg-[rgba(76,175,125,0.20)] text-[#5FBF94]',
  skipped: 'bg-[rgba(224,92,92,0.13)] text-[#C98A8A] line-through',
}

const inputCls =
  'mt-1 w-full bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A]'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const parseYmd = (s: string) => new Date(`${s}T12:00:00`).getTime()
const noonMs = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime()
const sameMonth = (d: Date, m: Date) => d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear()

function buildGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

interface Draft {
  accountUsername: string
  scheduledFor: number
  contentType: ContentType
  title: string
  hook: string
  caption: string
  status: PostStatus
}

export function CalendarPage() {
  const qc = useQueryClient()
  const [month, setMonth] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [accountFilter, setAccountFilter] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const cells = useMemo(() => buildGrid(month), [month])
  const from = useMemo(() => noonMs(cells[0]) - 12 * 3600_000, [cells])
  const to = useMemo(() => noonMs(cells[41]) + 12 * 3600_000, [cells])

  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: listAccounts })
  const accountLabel = (u: string) => accounts.find((a) => a.username === u)?.fullName || u
  const accountItems = useMemo(
    () => accounts.map((a) => ({ value: a.username, label: a.fullName ? `${a.fullName} (@${a.username})` : `@${a.username}` })),
    [accounts],
  )

  const { data: posts = [] } = useQuery({
    queryKey: ['scheduled_posts', accountFilter, from],
    queryFn: () =>
      listScheduledPosts({ from, to, accountUsername: accountFilter === 'all' ? undefined : accountFilter }),
  })

  const byDay = useMemo(() => {
    const map: Record<string, ScheduledPost[]> = {}
    for (const p of posts) (map[ymd(new Date(p.scheduledFor))] ??= []).push(p)
    return map
  }, [posts])

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['scheduled_posts'] })
  const closeModal = () => {
    setDraft(null)
    setEditingId(null)
  }

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const fields = {
        scheduledFor: d.scheduledFor,
        contentType: d.contentType,
        title: d.title.trim() || null,
        hook: d.hook.trim() || null,
        caption: d.caption.trim() || null,
        status: d.status,
      }
      if (editingId) await updateScheduledPost(editingId, fields)
      else await createScheduledPost({ accountUsername: d.accountUsername, ...fields })
    },
    onSuccess: () => {
      invalidate()
      closeModal()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteScheduledPost(id),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
  })

  const reschedule = useMutation({
    mutationFn: ({ id, ms }: { id: string; ms: number }) => updateScheduledPost(id, { scheduledFor: ms }),
    onSuccess: invalidate,
  })

  const openCreate = (date: Date) => {
    setEditingId(null)
    setDraft({
      accountUsername: accountFilter !== 'all' ? accountFilter : (accounts[0]?.username ?? ''),
      scheduledFor: noonMs(date),
      contentType: 'reel',
      title: '',
      hook: '',
      caption: '',
      status: 'idea',
    })
  }

  const openEdit = (p: ScheduledPost) => {
    setEditingId(p.id)
    setDraft({
      accountUsername: p.accountUsername,
      scheduledFor: p.scheduledFor,
      contentType: p.contentType,
      title: p.title ?? '',
      hook: p.hook ?? '',
      caption: p.caption ?? '',
      status: p.status,
    })
  }

  const todayKey = ymd(new Date())
  const thisYear = new Date().getFullYear()
  const displayedYear = month.getFullYear()
  const minYear = Math.min(thisYear - 3, displayedYear)
  const maxYear = Math.max(thisYear + 5, displayedYear)
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i)

  const renderModal = (d: Draft) => {
    const canSave = !!d.accountUsername && !Number.isNaN(d.scheduledFor)
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={closeModal}>
        <div
          className="bg-surface border border-[rgba(245,237,214,0.12)] rounded-lg w-full max-w-md p-5 max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-primary text-lg font-medium">{editingId ? 'Edit post' : 'New post'}</h2>
            <button onClick={closeModal} aria-label="Close" className="text-muted hover:text-primary">
              <X size={18} />
            </button>
          </div>

          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted">Account</span>
              <SearchablePicker
                items={accountItems}
                value={d.accountUsername}
                onChange={(v) => setDraft({ ...d, accountUsername: v })}
                placeholder="Select an account…"
                disabled={!!editingId}
                className="mt-1"
              />
            </label>

            <div className="flex gap-3">
              <label className="block flex-1">
                <span className="text-xs text-muted">Date</span>
                <input
                  type="date"
                  value={ymd(new Date(d.scheduledFor))}
                  onChange={(e) => {
                    if (e.target.value) setDraft({ ...d, scheduledFor: parseYmd(e.target.value) })
                  }}
                  className={inputCls}
                />
              </label>
              <label className="block flex-1">
                <span className="text-xs text-muted">Type</span>
                <select
                  value={d.contentType}
                  onChange={(e) => setDraft({ ...d, contentType: e.target.value as ContentType })}
                  className={inputCls}
                >
                  {CONTENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block">
              <span className="text-xs text-muted">Title</span>
              <input
                value={d.title}
                onChange={(e) => setDraft({ ...d, title: e.target.value })}
                maxLength={120}
                placeholder="e.g. Morning routine reel"
                className={inputCls}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted">Hook (optional)</span>
              <input
                value={d.hook}
                onChange={(e) => setDraft({ ...d, hook: e.target.value })}
                maxLength={200}
                placeholder="The opening line"
                className={inputCls}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted">Caption / notes (optional)</span>
              <textarea
                value={d.caption}
                onChange={(e) => setDraft({ ...d, caption: e.target.value })}
                rows={3}
                maxLength={2000}
                className={`${inputCls} resize-none`}
              />
            </label>

            <label className="block">
              <span className="text-xs text-muted">Status</span>
              <select
                value={d.status}
                onChange={(e) => setDraft({ ...d, status: e.target.value as PostStatus })}
                className={inputCls}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex items-center justify-between mt-5">
            {editingId ? (
              <button
                onClick={() => {
                  if (editingId && window.confirm('Delete this scheduled post?')) remove.mutate(editingId)
                }}
                className="flex items-center gap-1.5 text-sm text-muted hover:text-danger transition-colors"
              >
                <Trash2 size={15} /> Delete
              </button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              <button onClick={closeModal} className="text-sm text-secondary hover:text-primary px-3 py-2">
                Cancel
              </button>
              <button
                onClick={() => save.mutate(d)}
                disabled={!canSave || save.isPending}
                className="bg-[#E07B3A] hover:bg-[#C4612A] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
              >
                {save.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          {save.isError && <p className="text-danger text-xs mt-2">Couldn&apos;t save — try again.</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="font-serif italic text-3xl text-primary">Calendar</h1>
          <p className="text-secondary text-sm mt-1">Plan which reel or post goes out — per account.</p>
        </div>
        <SearchablePicker
          items={accountItems}
          value={accountFilter}
          onChange={setAccountFilter}
          includeAll
          allLabel="All accounts"
          className="w-64"
        />
      </header>

      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="p-1.5 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            aria-label="Next month"
            className="p-1.5 rounded-md text-secondary hover:text-primary hover:bg-surface-raised transition-colors"
          >
            <ChevronRight size={18} />
          </button>
          <select
            value={month.getMonth()}
            onChange={(e) => setMonth(new Date(month.getFullYear(), Number(e.target.value), 1))}
            aria-label="Month"
            className="ml-2 bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-2 py-1 text-sm text-primary focus:outline-none focus:border-[#E07B3A]"
          >
            {MONTH_NAMES.map((m, i) => (
              <option key={m} value={i}>
                {m}
              </option>
            ))}
          </select>
          <select
            value={month.getFullYear()}
            onChange={(e) => setMonth(new Date(Number(e.target.value), month.getMonth(), 1))}
            aria-label="Year"
            className="bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-2 py-1 text-sm text-primary focus:outline-none focus:border-[#E07B3A]"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            const n = new Date()
            setMonth(new Date(n.getFullYear(), n.getMonth(), 1))
          }}
          className="text-xs text-secondary hover:text-primary border border-[rgba(245,237,214,0.12)] rounded-md px-2.5 py-1 transition-colors"
        >
          Today
        </button>
      </div>

      {accounts.length === 0 && (
        <p className="text-muted text-sm mb-3">Add accounts in the Dashboard first, then you can schedule posts for them.</p>
      )}

      {/* Status legend */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        <span className="text-[11px] font-mono uppercase tracking-wide text-muted mr-1">Status</span>
        {STATUSES.map((s) => (
          <span key={s} className={`text-[11px] rounded px-1.5 py-0.5 ${STATUS_STYLES[s]}`}>
            {s}
          </span>
        ))}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[11px] font-mono uppercase tracking-wide text-muted text-center py-1">
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-px bg-[rgba(245,237,214,0.06)] rounded-lg overflow-hidden">
        {cells.map((d) => {
          const key = ymd(d)
          const dayPosts = byDay[key] ?? []
          const inMonth = sameMonth(d, month)
          const isToday = key === todayKey
          return (
            <div
              key={key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/plain')
                if (id) reschedule.mutate({ id, ms: noonMs(d) })
              }}
              className={`group min-h-[92px] p-1.5 bg-chai flex flex-col gap-1 ${inMonth ? '' : 'opacity-40'}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-mono ${isToday ? 'text-[#E07B3A] font-semibold' : 'text-muted'}`}>
                  {d.getDate()}
                </span>
                <button
                  onClick={() => openCreate(d)}
                  aria-label="Add post"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-muted hover:text-[#E07B3A] transition-opacity"
                >
                  <Plus size={13} />
                </button>
              </div>
              {dayPosts.map((p) => (
                <button
                  key={p.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', p.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => openEdit(p)}
                  title={`${accountLabel(p.accountUsername)} — ${p.title || p.contentType}`}
                  className={`text-left text-[11px] leading-tight rounded px-1.5 py-1 truncate cursor-pointer ${STATUS_STYLES[p.status]}`}
                >
                  {accountFilter === 'all' && <span className="opacity-70">{accountLabel(p.accountUsername)}: </span>}
                  {p.title || p.contentType}
                </button>
              ))}
            </div>
          )
        })}
      </div>

      <p className="text-muted text-xs mt-3">
        Hover a day and click + to add · drag a post to move it · click a post to edit.
      </p>

      {draft && renderModal(draft)}
    </div>
  )
}
