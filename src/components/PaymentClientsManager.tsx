/**
 * PaymentClientsManager — manage the Payments section's OWN client database.
 *
 * Add / edit / delete clients (company name + payment details), entirely within Payments
 * and independent of the Dashboard. Finance-only (the parent page + RLS enforce that).
 * Deleting a client cascade-deletes its payments (FK on delete cascade).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Plus, Trash2, Pencil } from 'lucide-react'
import {
  listPaymentClients,
  createPaymentClient,
  updatePaymentClient,
  deletePaymentClient,
} from '../lib/calendarRepo'
import type { PaymentClient, PaymentClientInput } from '../domain/calendar'

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED']

const inputCls =
  'w-full bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-[#E07B3A]'

const EMPTY: PaymentClientInput = {
  name: '', contactPerson: '', email: '', phone: '', taxId: '', currency: 'INR', instagramHandle: '', notes: '',
}

interface Props {
  onClose: () => void
}

export function PaymentClientsManager({ onClose }: Props) {
  const qc = useQueryClient()
  const { data: clients = [] } = useQuery({ queryKey: ['payment_clients'], queryFn: listPaymentClients })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [form, setForm] = useState<PaymentClientInput>(EMPTY)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['payment_clients'] })
  const reset = () => {
    setEditingId(null)
    setForm(EMPTY)
  }

  const save = useMutation({
    mutationFn: async (f: PaymentClientInput) => {
      const payload = { ...f, name: f.name.trim() }
      if (editingId) await updatePaymentClient(editingId, payload)
      else await createPaymentClient(payload)
    },
    onSuccess: () => {
      invalidate()
      reset()
    },
  })
  const remove = useMutation({ mutationFn: deletePaymentClient, onSuccess: invalidate })

  const startEdit = (c: PaymentClient) => {
    setEditingId(c.id)
    setForm({
      name: c.name,
      contactPerson: c.contactPerson ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
      taxId: c.taxId ?? '',
      currency: c.currency,
      instagramHandle: c.instagramHandle ?? '',
      notes: c.notes ?? '',
    })
  }

  const canSave = form.name.trim().length > 0 && !save.isPending
  const submit = () => {
    if (canSave) save.mutate(form)
  }

  const set = (patch: Partial<PaymentClientInput>) => setForm((f) => ({ ...f, ...patch }))

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-surface border border-[rgba(245,237,214,0.12)] rounded-lg w-full max-w-2xl p-5 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-primary text-lg font-medium">Clients</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted hover:text-primary">
            <X size={18} />
          </button>
        </div>

        {/* Add / edit form */}
        <div className="bg-[rgba(245,237,214,0.03)] border border-[rgba(245,237,214,0.08)] rounded-lg p-4 mb-5">
          <div className="text-[11px] font-mono uppercase tracking-wide text-muted mb-2">
            {editingId ? 'Edit client' : 'New client'}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Company name *" maxLength={120} className={`${inputCls} col-span-2`} />
            <input value={form.contactPerson ?? ''} onChange={(e) => set({ contactPerson: e.target.value })} placeholder="Contact person" maxLength={120} className={inputCls} />
            <input value={form.email ?? ''} onChange={(e) => set({ email: e.target.value })} placeholder="Email" maxLength={160} className={inputCls} />
            <input value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} placeholder="Phone" maxLength={40} className={inputCls} />
            <input value={form.taxId ?? ''} onChange={(e) => set({ taxId: e.target.value })} placeholder="Tax / GST ID" maxLength={60} className={inputCls} />
            <select value={form.currency} onChange={(e) => set({ currency: e.target.value })} className={inputCls}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input value={form.instagramHandle ?? ''} onChange={(e) => set({ instagramHandle: e.target.value })} placeholder="Instagram handle (optional)" maxLength={60} className={inputCls} />
            <textarea value={form.notes ?? ''} onChange={(e) => set({ notes: e.target.value })} placeholder="Notes" rows={2} maxLength={500} className={`${inputCls} col-span-2 resize-none`} />
          </div>
          <div className="flex items-center justify-end gap-2 mt-3">
            {editingId && (
              <button onClick={reset} className="text-sm text-secondary hover:text-primary px-3 py-2">
                Cancel
              </button>
            )}
            <button
              onClick={submit}
              disabled={!canSave}
              className="flex items-center gap-1.5 bg-[#E07B3A] hover:bg-[#C4612A] disabled:opacity-50 text-white text-sm font-medium rounded-md px-4 py-2 transition-colors"
            >
              <Plus size={15} /> {save.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Add client'}
            </button>
          </div>
          {save.isError && <p className="text-danger text-xs mt-2">Couldn&apos;t save the client — try again.</p>}
        </div>

        {/* Existing clients */}
        {clients.length === 0 ? (
          <p className="text-muted text-sm">No clients yet. Add your first one above.</p>
        ) : (
          <ul className="space-y-2">
            {clients.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-primary text-sm font-medium truncate">{c.name}</div>
                  <div className="text-muted text-xs truncate">
                    {[c.contactPerson, c.email, c.phone, c.taxId && `Tax ${c.taxId}`, c.currency]
                      .filter(Boolean)
                      .join(' · ') || 'No details'}
                  </div>
                </div>
                <button
                  onClick={() => startEdit(c)}
                  aria-label="Edit client"
                  className="flex-shrink-0 text-muted hover:text-primary transition-colors p-1"
                >
                  <Pencil size={15} />
                </button>
                {confirmDeleteId === c.id ? (
                  <span className="flex-shrink-0 flex items-center gap-1.5 text-xs">
                    <button
                      onClick={() => { remove.mutate(c.id); if (editingId === c.id) reset(); setConfirmDeleteId(null) }}
                      disabled={remove.isPending}
                      title="Deletes the client and all their payment records"
                      aria-label="Confirm delete client and records"
                      className="text-danger font-medium hover:underline disabled:opacity-50"
                    >Delete?</button>
                    <button onClick={() => setConfirmDeleteId(null)} aria-label="Cancel delete" className="text-muted hover:text-secondary transition-colors">Cancel</button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmDeleteId(c.id)}
                    aria-label="Delete client"
                    className="flex-shrink-0 text-muted hover:text-danger transition-colors p-1"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
