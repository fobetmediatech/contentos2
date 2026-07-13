/**
 * GoogleExportButton — one-click export of a finished chat result to Google Docs/Sheets.
 *
 * Sits inline next to the other export actions on every result. On click it opens a Google
 * authorization popup (GIS, drive.file scope), creates the file client-side, and shows a link.
 * The popup replaces the old Clerk reauthorize redirect, which looped because the Clerk Google
 * login can't carry Drive write permission.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, ExternalLink, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import type { GoogleExportPayload } from '../shared/utils/export'
import { exportToGoogle } from '../lib/googleExport'
import { loadGoogleIdentity, isGoogleExportConfigured } from '../lib/googleAuth'

interface Props {
  /** Built lazily on click so we never serialize a result that won't be exported. */
  buildPayload: () => GoogleExportPayload
  kind: 'sheet' | 'doc'
}

type Status = 'idle' | 'loading' | 'done' | 'error'

const btnClass =
  'flex items-center gap-1.5 px-3 py-2 text-sm text-secondary border border-[rgba(var(--border-rgb),0.10)] rounded-xl hover:bg-surface-raised transition-colors disabled:opacity-60'

export function GoogleExportButton({ buildPayload, kind }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  // Preload GIS so the token client is ready by click time — otherwise the popup (which must be
  // opened synchronously inside the click) can't fire.
  useEffect(() => {
    if (isGoogleExportConfigured()) void loadGoogleIdentity().catch(() => {})
  }, [])

  const label = kind === 'sheet' ? 'Google Sheets' : 'Google Docs'
  const Icon = kind === 'sheet' ? FileSpreadsheet : FileText

  // NOTE: exportToGoogle() opens the auth popup on its first line, before any await — so it must
  // be the first thing this handler does (after the sync buildPayload) to stay within the gesture.
  const runExport = async () => {
    setErrMsg(null)
    setStatus('loading')
    try {
      const { url } = await exportToGoogle(buildPayload())
      setUrl(url)
      setStatus('done')
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Export failed')
      setStatus('error')
    }
  }

  if (status === 'done' && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={btnClass}>
        <ExternalLink size={13} className="text-success" />
        Open in {label}
      </a>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={runExport}
        disabled={status === 'loading'}
        className={btnClass}
        title={`Create a ${label} file in your Drive`}
      >
        {status === 'loading' ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
        {status === 'loading' ? 'Exporting…' : status === 'error' ? `Retry export to ${label}` : `Export to ${label}`}
      </button>
      {/* Surface the real failure inline — a silent "retry" tells the user nothing. */}
      {status === 'error' && errMsg && (
        <span className="flex items-start gap-1 text-xs text-warning max-w-sm leading-snug">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <span>{errMsg}</span>
        </span>
      )}
    </div>
  )
}
