/**
 * StrategyDocument — the client-ready Content Strategy Document.
 *
 * Renders the synthesized strategy + the backend analysis (competitor metrics + HookMap signals)
 * as one printable page. Print / Save as PDF reuses the global print CSS (.no-print / .report-printable),
 * same as ReportPage — no PDF library.
 */
import type { StrategyResult } from '../domain/strategy'

const fmt = (n: number) => n.toLocaleString()

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[11px] font-mono uppercase tracking-wider text-[#E07B3A] mb-2">{title}</h2>
      {children}
    </section>
  )
}

export function StrategyDocument({ result }: { result: StrategyResult }) {
  const { brief, doc, accounts, hookSummaries } = result
  const date = new Date(result.generatedAt).toLocaleDateString()

  return (
    <div className="report-printable bg-surface border border-[rgba(245,237,214,0.1)] rounded-lg p-6 sm:p-8 text-primary">
      {/* Header */}
      <header className="border-b border-[rgba(245,237,214,0.12)] pb-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted">Content Strategy · {date}</div>
        <h1 className="font-serif italic text-3xl text-primary mt-1">{brief.brandName || 'Untitled brand'}</h1>
        <p className="text-secondary text-sm mt-1">
          {brief.primaryNiche}
          {brief.subNiche ? ` · ${brief.subNiche}` : ''} — drives toward: <span className="text-primary">{brief.offer}</span>
        </p>
      </header>

      <Section title="Positioning">
        <p className="text-secondary text-sm leading-relaxed">{doc.positioning}</p>
      </Section>

      <Section title="Audience insight">
        <p className="text-secondary text-sm leading-relaxed">{doc.audienceInsight}</p>
        <p className="text-muted text-xs mt-1">Client-stated target: {brief.audience}</p>
      </Section>

      <Section title="Competitive landscape">
        <p className="text-secondary text-sm leading-relaxed mb-2">{doc.competitiveSummary}</p>
        {accounts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted font-mono uppercase tracking-wide">
                <tr className="text-left">
                  <th className="py-1 pr-3">Account</th>
                  <th className="py-1 pr-3">Type</th>
                  <th className="py-1 pr-3 text-right">Followers</th>
                  <th className="py-1 text-right">ER</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {accounts.map((a) => (
                  <tr key={a.username} className="border-t border-[rgba(245,237,214,0.06)]">
                    <td className="py-1 pr-3 text-primary">@{a.username}{a.verified ? ' ✓' : ''}</td>
                    <td className="py-1 pr-3 text-muted">{a.source}</td>
                    <td className="py-1 pr-3 text-right text-secondary">{fmt(a.followers)}</td>
                    <td className="py-1 text-right text-secondary">{a.engagementRate != null ? `${a.engagementRate.toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {hookSummaries.length > 0 && (
        <Section title="What's working in the niche (HookMap)">
          <div className="space-y-3">
            {hookSummaries.map((s) => (
              <div key={s.handle} className="text-sm">
                <div className="text-primary font-medium">@{s.handle} <span className="text-muted text-xs font-mono">· {s.reelCount} reels · median {fmt(s.benchmarks.medianViews)} views</span></div>
                <ul className="list-disc list-inside text-secondary text-xs mt-1 space-y-0.5">
                  {s.dominantHooks.slice(0, 3).map((h, i) => (
                    <li key={i}><span className="text-primary">{h.pattern}</span> (×{h.count}) — "{h.example}"</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Content pillars">
        <div className="grid sm:grid-cols-2 gap-3">
          {doc.contentPillars.map((p, i) => (
            <div key={i} className="bg-[rgba(245,237,214,0.03)] border border-[rgba(245,237,214,0.08)] rounded-md p-3">
              <div className="text-primary text-sm font-medium">{p.name}</div>
              <div className="text-secondary text-xs mt-1">{p.description}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Hook formulas">
        <div className="space-y-2">
          {doc.hookFormulas.map((h, i) => (
            <div key={i} className="text-sm">
              <span className="text-primary font-medium">{h.name}: </span>
              <span className="text-secondary">{h.template}</span>
              <div className="text-muted text-xs mt-0.5">e.g. "{h.example}"</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Content ideas">
        <ol className="space-y-2 list-decimal list-inside">
          {doc.contentIdeas.map((idea, i) => (
            <li key={i} className="text-sm text-secondary">
              <span className="text-primary font-medium">{idea.title}</span>
              <span className="text-muted text-xs font-mono"> · {idea.format} · {idea.pillar}</span>
              <div className="text-secondary text-xs mt-0.5 ml-5">Hook: "{idea.hook}"</div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Format mix & cadence">
        <div className="flex flex-wrap gap-2 mb-2">
          {doc.formatMix.map((f, i) => (
            <span key={i} className="text-xs bg-[rgba(224,123,58,0.12)] text-[#F4A97B] rounded px-2 py-1">
              {f.format} {f.weight} <span className="text-muted">— {f.rationale}</span>
            </span>
          ))}
        </div>
        <p className="text-secondary text-sm"><span className="text-primary">{doc.cadence.postsPerWeek}</span> — {doc.cadence.notes}</p>
      </Section>

      <Section title="Voice & tone">
        <p className="text-secondary text-sm leading-relaxed">{doc.voiceAndTone}</p>
      </Section>

      <Section title="Guardrails">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wide text-success mb-1">Do</div>
            <ul className="list-disc list-inside text-secondary text-xs space-y-0.5">{doc.dos.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wide text-danger mb-1">Don't</div>
            <ul className="list-disc list-inside text-secondary text-xs space-y-0.5">{doc.donts.map((d, i) => <li key={i}>{d}</li>)}</ul>
          </div>
        </div>
        <p className="text-muted text-xs mt-2">
          Language: {brief.language}. Off-limits: {brief.offLimits || '—'}. Dislikes: {brief.dislikes || '—'}.
        </p>
      </Section>
    </div>
  )
}
