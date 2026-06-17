/**
 * ClientsPage — manage the agency's client list (the brands you work for).
 *
 * Clients are the shared entity the calendar + payments hang off. Team-shared
 * (any signed-in member). This feature owns the `clients` table for now; the
 * future dashboard will read the same table.
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, User, Trash2 } from 'lucide-react'
import { listClients, createClient, deleteClient } from '../lib/calendarRepo'
import type { ClientStatus } from '../domain/calendar'

const STATUS_OPTIONS: ClientStatus[] = ['active', 'paused', 'archived']

const inputClass =
  'bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A]'

export function ClientsPage() {
  const qc = useQueryClient()
  const { data: clients = [], isLoading, isError } = useQuery({ queryKey: ['clients'], queryFn: listClients })

  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [status, setStatus] = useState<ClientStatus>('active')

  const create = useMutation({
    mutationFn: createClient,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['clients'] })
      setName('')
      setHandle('')
      setStatus('active')
    },
  })

  const remove = useMutation({
    mutationFn: deleteClient,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['clients'] }),
  })

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || create.isPending) return
    create.mutate({ name: trimmed, handle: handle.trim() || null, status })
  }

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-6">
        <h1 className="font-serif italic text-3xl text-primary">Clients</h1>
        <p className="text-secondary text-sm mt-1">
          The brands your agency manages — used across the calendar and payments.
        </p>
      </header>

      {/* Add-client form */}
      <form onSubmit={(e) => { e.preventDefault(); submit() }} className="bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg p-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client name *"
            maxLength={100}
            className={`flex-1 ${inputClass}`}
          />
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="@instagram (optional)"
            maxLength={40}
            className={`flex-1 ${inputClass}`}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value as ClientStatus)} className={inputClass}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="flex items-center justify-center gap-1.5 bg-[#E07B3A] hover:bg-[#C4612A] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
          >
            <Plus size={15} /> {create.isPending ? 'Adding…' : 'Add'}
          </button>
        </div>
        {create.isError && <p className="text-danger text-xs mt-2">Couldn&apos;t add the client — try again.</p>}
      </form>

      {/* Client list */}
      {isLoading ? (
        <p className="text-muted text-sm">Loading clients…</p>
      ) : isError ? (
        <p className="text-danger text-sm">Couldn&apos;t load clients.</p>
      ) : clients.length === 0 ? (
        <p className="text-muted text-sm">No clients yet — add your first one above.</p>
      ) : (
        <ul className="space-y-2">
          {clients.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg px-4 py-3"
            >
              <span className="w-9 h-9 rounded-full bg-[rgba(224,123,58,0.12)] text-[#E07B3A] flex items-center justify-center flex-shrink-0">
                <User size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-primary text-sm font-medium truncate">{c.name}</div>
                {c.handle && <div className="text-muted text-xs font-mono truncate">@{c.handle.replace(/^@/, '')}</div>}
              </div>
              <span
                className={`text-[11px] font-mono uppercase tracking-wide px-2 py-0.5 rounded-full ${
                  c.status === 'active'
                    ? 'bg-[rgba(76,175,125,0.12)] text-success'
                    : c.status === 'paused'
                      ? 'bg-[rgba(217,119,6,0.12)] text-warning'
                      : 'bg-surface-raised text-muted'
                }`}
              >
                {c.status}
              </span>
              <button
                onClick={() => {
                  if (window.confirm(`Delete "${c.name}"? This also removes any of its scheduled posts and payments.`)) {
                    remove.mutate(c.id)
                  }
                }}
                disabled={remove.isPending}
                aria-label={`Delete ${c.name}`}
                className="flex-shrink-0 text-muted hover:text-danger disabled:opacity-50 transition-colors p-1"
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
