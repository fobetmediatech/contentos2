/**
 * AccountPicker — a searchable account dropdown (combobox) for Calendar + Payments.
 *
 * Replaces the plain <select> account pickers so a long client list stays usable: type to
 * filter by full name or @username, arrow-key + click to choose. Accounts come from the
 * Dashboard's tracked_accounts (see domain/calendar.ts). Self-contained, no extra deps;
 * styled to the Chai Dark system (surface-elevated dropdown, saffron highlight).
 *
 * Two modes:
 *  - select mode (default): value is a username or '' (nothing chosen).
 *  - filter mode (includeAll): adds a leading "All accounts" row; value can be 'all'.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search, Check } from 'lucide-react'
import type { Account } from '../domain/calendar'

const ALL = 'all'

interface AccountPickerProps {
  accounts: Account[]
  /** Selected username, '' for none, or 'all' when includeAll is set. */
  value: string
  onChange: (value: string) => void
  /** Show a leading "All accounts" row (filter mode). */
  includeAll?: boolean
  allLabel?: string
  /** Shown on the trigger when nothing is selected (select mode). */
  placeholder?: string
  disabled?: boolean
  /** Extra classes on the root (e.g. width / grid span). */
  className?: string
}

const optionLabel = (a: Account) => (a.fullName ? `${a.fullName} (@${a.username})` : `@${a.username}`)

export function AccountPicker({
  accounts,
  value,
  onChange,
  includeAll = false,
  allLabel = 'All accounts',
  placeholder = 'Select an account…',
  disabled = false,
  className = '',
}: AccountPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedLabel = useMemo(() => {
    if (includeAll && value === ALL) return allLabel
    const a = accounts.find((x) => x.username === value)
    return a ? optionLabel(a) : ''
  }, [accounts, value, includeAll, allLabel])

  // Flat row list (optional "All" row + filtered accounts) — drives render + keyboard nav.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? accounts.filter(
          (a) => a.username.toLowerCase().includes(q) || (a.fullName ?? '').toLowerCase().includes(q),
        )
      : accounts
    const base = matched.map((a) => ({ value: a.username, label: optionLabel(a) }))
    const showAll = includeAll && (!q || allLabel.toLowerCase().includes(q))
    return showAll ? [{ value: ALL, label: allLabel }, ...base] : base
  }, [accounts, query, includeAll, allLabel])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Focus the search box when the menu opens (DOM-only effect — no state writes).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const openMenu = () => {
    setQuery('')
    setHighlight(0)
    setOpen(true)
  }

  const choose = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, rows.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[highlight]
      if (row) choose(row.value)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="w-full flex items-center justify-between gap-2 bg-[#3D3025] border border-[rgba(245,237,214,0.08)] rounded-md px-3 py-2 text-sm focus:outline-none focus:border-[#E07B3A] disabled:opacity-60 transition-colors"
      >
        <span className={`truncate ${selectedLabel ? 'text-primary' : 'text-muted'}`}>
          {selectedLabel || placeholder}
        </span>
        <ChevronDown size={15} className="text-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-[#4A3C2E] border border-[rgba(245,237,214,0.15)] rounded-md shadow-[0_8px_40px_rgba(0,0,0,0.6)] overflow-hidden">
          <div className="flex items-center gap-2 px-2.5 py-2 border-b border-[rgba(245,237,214,0.08)]">
            <Search size={14} className="text-muted shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search accounts…"
              className="w-full bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {rows.length === 0 ? (
              <li className="px-3 py-2 text-sm text-muted">No accounts found</li>
            ) : (
              rows.map((r, i) => {
                const active = r.value === value
                return (
                  <li key={r.value || 'none'}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => choose(r.value)}
                      className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm transition-colors ${
                        i === highlight ? 'bg-[rgba(224,123,58,0.16)]' : ''
                      } ${active ? 'text-[#F4A97B]' : 'text-primary'}`}
                    >
                      <span className="truncate">{r.label}</span>
                      {active && <Check size={14} className="text-[#E07B3A] shrink-0" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
