import { useEffect, useState } from 'react'
import { Plus, Trash2, Clock, CheckCircle2, AlertCircle } from 'lucide-react'
import { useKeysStore } from '../store/keysStore'
import { getKeyExpiry } from '../lib/keyRotator'

function CooldownBadge({ apiKey }: { apiKey: string }) {
  // Lift the current time into state, refreshed on an interval, so the
  // cooldown countdown stays pure during render (no Date.now() call in render).
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const expiry = getKeyExpiry(apiKey)
  if (!expiry) return <span className="text-xs text-success font-medium flex items-center gap-1 font-mono"><CheckCircle2 size={12} />Active</span>

  const remaining = Math.ceil((expiry - nowMs) / 60000)
  return (
    <span className="text-xs text-warning font-medium flex items-center gap-1 font-mono">
      <Clock size={12} />
      Cooldown: {remaining}m
    </span>
  )
}

export function SettingsPage() {
  const { geminiKey, apifyKeys, setGeminiKey, addApifyKey, removeApifyKey } = useKeysStore()
  const [newApifyKey, setNewApifyKey] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')

  const handleSaveGemini = async () => {
    if (!geminiKey.trim()) return
    setSaveStatus('saving')
    try {
      // Validate by calling Gemini models list endpoint.
      // SECURITY: key goes in the x-goog-api-key header, never the URL (see geminiHeaders).
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models',
        { headers: { 'x-goog-api-key': geminiKey } },
      )
      if (res.ok) {
        setSaveStatus('saved')
        setStatusMessage('Gemini key validated ✓')
      } else {
        setSaveStatus('error')
        setStatusMessage(`Gemini key invalid (${res.status})`)
      }
    } catch {
      setSaveStatus('error')
      setStatusMessage('Could not reach Gemini API. Check your connection.')
    }
    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  const handleAddApifyKey = async () => {
    const key = newApifyKey.trim()
    if (!key || apifyKeys.includes(key) || apifyKeys.length >= 10) return

    setSaveStatus('saving')
    try {
      // Validate by calling Apify account endpoint
      const res = await fetch('https://api.apify.com/v2/users/me', {
        headers: { Authorization: `Bearer ${key}` },
      })
      if (res.ok) {
        addApifyKey(key)
        setNewApifyKey('')
        setSaveStatus('saved')
        setStatusMessage('Apify key added and validated ✓')
      } else {
        setSaveStatus('error')
        setStatusMessage(`Apify key invalid (${res.status})`)
      }
    } catch {
      setSaveStatus('error')
      setStatusMessage('Could not reach Apify API. Check your connection.')
    }
    setTimeout(() => setSaveStatus('idle'), 3000)
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-8">
        <h1 className="font-serif italic text-3xl text-primary tracking-tight">Settings</h1>
        <p className="mt-1.5 text-sm text-secondary">
          Configure your API keys. All keys are stored locally in your browser — never sent to any server.
        </p>
      </div>

      {/* Save status banner */}
      {saveStatus !== 'idle' && (
        <div className={`mb-6 px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
          saveStatus === 'saved' ? 'bg-[rgba(76,175,125,0.1)] text-success border border-[rgba(76,175,125,0.2)]' :
          saveStatus === 'error' ? 'bg-[rgba(224,92,92,0.1)] text-danger border border-[rgba(224,92,92,0.2)]' :
          'bg-surface-raised text-secondary border border-[rgba(245,237,214,0.08)]'
        }`}>
          {saveStatus === 'saved' && <CheckCircle2 size={15} />}
          {saveStatus === 'error' && <AlertCircle size={15} />}
          {statusMessage || (saveStatus === 'saving' ? 'Validating...' : '')}
        </div>
      )}

      {/* Gemini API Key */}
      <section className="mb-8">
        <h2 className="text-xs font-mono font-medium text-muted uppercase tracking-wider mb-3">Gemini API Key</h2>
        <p className="text-xs text-secondary mb-3">
          Used for AI competitor classification and rationale generation.
          Get your key at{' '}
          <a
            href="https://aistudio.google.com/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#F4A97B] hover:underline"
          >
            aistudio.google.com
          </a>
          .
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="AIza..."
            className="flex-1 px-3 py-2 text-sm bg-[#1A1410] text-primary border border-[rgba(245,237,214,0.12)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#E07B3A] focus:border-[#E07B3A] font-mono placeholder:text-muted"
          />
          <button
            onClick={handleSaveGemini}
            disabled={!geminiKey.trim() || saveStatus === 'saving'}
            className="px-4 py-2 text-sm font-medium bg-[#E07B3A] text-white rounded-lg hover:bg-[#C4612A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saveStatus === 'saving' ? 'Validating...' : 'Validate'}
          </button>
        </div>
      </section>

      {/* Apify API Keys */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-xs font-mono font-medium text-muted uppercase tracking-wider">Apify API Keys</h2>
          <span className="text-xs font-mono text-muted">{apifyKeys.length}/10 keys</span>
        </div>
        <p className="text-xs text-secondary mb-4">
          Used to scrape Instagram profiles. Add multiple keys to rotate and avoid rate limits.
          Each key goes into a 15-minute cooldown after a rate-limit hit.
          Get keys at{' '}
          <a
            href="https://console.apify.com/account/integrations"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#F4A97B] hover:underline"
          >
            console.apify.com
          </a>
          .
        </p>

        {/* Existing keys */}
        {apifyKeys.length > 0 && (
          <div className="space-y-2 mb-4">
            {apifyKeys.map((key, idx) => (
              <div
                key={idx}
                className="flex items-center gap-3 px-3 py-2.5 bg-surface border border-[rgba(245,237,214,0.08)] rounded-lg"
              >
                <code className="flex-1 text-xs text-secondary font-mono truncate">
                  {key.slice(0, 12)}{'·'.repeat(8)}{key.slice(-6)}
                </code>
                <CooldownBadge apiKey={key} />
                <button
                  onClick={() => removeApifyKey(idx)}
                  className="text-muted hover:text-danger transition-colors flex-shrink-0"
                  aria-label="Remove key"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new key */}
        {apifyKeys.length < 10 && (
          <div className="flex gap-2">
            <input
              type="password"
              value={newApifyKey}
              onChange={(e) => setNewApifyKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddApifyKey()}
              placeholder="apify_api_..."
              className="flex-1 px-3 py-2 text-sm bg-[#1A1410] text-primary border border-[rgba(245,237,214,0.12)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#E07B3A] focus:border-[#E07B3A] font-mono placeholder:text-muted"
            />
            <button
              onClick={handleAddApifyKey}
              disabled={!newApifyKey.trim() || saveStatus === 'saving'}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-[#E07B3A] text-white rounded-lg hover:bg-[#C4612A] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus size={14} />
              Add & validate
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
