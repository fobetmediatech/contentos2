/**
 * StrategyClientPage — "looking at a saved client" (route /strategy/:id).
 *
 * Renders a saved client's Content Strategy Document read-only (the existing StrategyDeck, so
 * Print → PDF still works) and an Attachments section: reference files that are purely
 * informational — upload, list, download (via short-lived signed URL), delete. Nothing here
 * drives any pipeline.
 */
import { useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Loader2, Paperclip, Upload, Download, Trash2, FileText, Printer } from 'lucide-react'
import { StrategyDeck } from '../components/StrategyDeck'
import { resolveDeckColors } from '../lib/deckThemes'
import {
  getSavedClient, deleteSavedClient,
  listAttachments, uploadAttachment, deleteAttachment, attachmentUrl,
} from '../lib/strategyRepo'
import type { StrategyAttachment } from '../domain/strategy'

const fmtBytes = (n: number | null): string => {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const fmtDate = (ms: number) =>
  ms ? new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''

export function StrategyClientPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: client, isLoading } = useQuery({
    queryKey: ['client_strategy', id],
    queryFn: () => getSavedClient(id),
    enabled: !!id,
  })

  const removeClient = useMutation({
    mutationFn: () => deleteSavedClient(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['client_strategies'] })
      navigate('/strategy')
    },
  })

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto flex items-center gap-2 text-secondary text-sm py-16 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading client…
      </div>
    )
  }

  if (!client) {
    return (
      <div className="max-w-5xl mx-auto py-16 text-center">
        <p className="text-secondary text-sm">This client couldn’t be found — it may have been deleted.</p>
        <Link to="/strategy" className="inline-flex items-center gap-1.5 text-[var(--color-accent)] text-sm mt-3">
          <ArrowLeft size={14} /> Back to Strategy
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header — back, title, actions (hidden in print) */}
      <header className="no-print mb-5">
        <Link to="/strategy" className="inline-flex items-center gap-1.5 text-secondary hover:text-primary text-sm mb-3">
          <ArrowLeft size={14} /> Back to Strategy
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="font-serif italic text-3xl text-primary">{client.brandName}</h1>
            {client.offer && <p className="text-secondary text-sm mt-1">{client.offer}</p>}
            <p className="text-muted text-[11px] font-mono mt-1">Saved {fmtDate(client.createdAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (confirm(`Delete “${client.brandName}” and its attachments? This can’t be undone.`)) removeClient.mutate()
              }}
              disabled={removeClient.isPending}
              className="flex items-center gap-1.5 text-sm text-secondary hover:text-danger border border-[rgba(var(--border-rgb),0.12)] rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              {removeClient.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-white text-sm font-medium rounded-md px-4 py-1.5"
            >
              <Printer size={14} /> Print / Save as PDF
            </button>
          </div>
        </div>
      </header>

      {/* Attachments — reference files, informational only */}
      <AttachmentsSection strategyId={client.id} />

      {/* The saved strategy document */}
      <StrategyDeck result={client.result} colors={resolveDeckColors(client.result.brief)} />
    </div>
  )
}

function AttachmentsSection({ strategyId }: { strategyId: string }) {
  const qc = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data: attachments = [] } = useQuery({
    queryKey: ['client_strategy_attachments', strategyId],
    queryFn: () => listAttachments(strategyId),
  })

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['client_strategy_attachments', strategyId] })

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await uploadAttachment(strategyId, f)
    },
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (att: StrategyAttachment) => deleteAttachment(att),
    onSuccess: invalidate,
  })

  const pickFiles = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length) upload.mutate(files)
    if (fileInput.current) fileInput.current.value = ''
  }

  const download = async (att: StrategyAttachment) => {
    setBusyId(att.id)
    try {
      const url = await attachmentUrl(att)
      window.open(url, '_blank', 'noopener')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="no-print bg-surface border border-[rgba(var(--border-rgb),0.08)] rounded-lg p-5 mb-5">
      <div className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-[var(--color-accent)] mb-3">
        <Paperclip size={13} /> Attachments
        {attachments.length > 0 && <span className="text-muted normal-case tracking-normal">· {attachments.length}</span>}
      </div>

      {/* Drop zone / picker */}
      <input
        ref={fileInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => pickFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFiles(e.dataTransfer.files) }}
        className={`w-full flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed py-6 transition-colors ${
          dragOver ? 'border-[var(--color-accent)] bg-[rgba(var(--accent-rgb),0.06)]' : 'border-[rgba(var(--border-rgb),0.16)] hover:border-[var(--color-accent)]'
        }`}
      >
        {upload.isPending ? (
          <span className="flex items-center gap-2 text-secondary text-sm"><Loader2 size={15} className="animate-spin" /> Uploading…</span>
        ) : (
          <>
            <Upload size={18} className="text-muted" />
            <span className="text-secondary text-sm">Drop files here or click to attach</span>
            <span className="text-muted text-xs">Reference material only — brief, brand kit, screenshots…</span>
          </>
        )}
      </button>
      {upload.isError && <p className="text-danger text-xs mt-2">Upload failed — try again.</p>}

      {/* File list */}
      {attachments.length > 0 && (
        <ul className="mt-3 divide-y divide-[rgba(var(--border-rgb),0.06)]">
          {attachments.map((att) => (
            <li key={att.id} className="flex items-center gap-3 py-2">
              <FileText size={16} className="text-muted shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-primary text-sm truncate">{att.fileName}</div>
                <div className="text-muted text-[11px] font-mono">
                  {[fmtBytes(att.sizeBytes), fmtDate(att.createdAt)].filter(Boolean).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => download(att)}
                disabled={busyId === att.id}
                title="Download"
                className="text-secondary hover:text-primary p-1.5 rounded disabled:opacity-50"
              >
                {busyId === att.id ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              </button>
              <button
                onClick={() => { if (confirm(`Remove “${att.fileName}”?`)) remove.mutate(att) }}
                disabled={remove.isPending}
                title="Remove"
                className="text-secondary hover:text-danger p-1.5 rounded disabled:opacity-50"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
