/**
 * CaseStudyMarkdown — themed renderer for the single-reel case-study markdown.
 *
 * The single-reel serverless path returns a markdown document (headings, prose, stat
 * tables, hashtag lists). react-markdown renders it WITHOUT raw HTML by default — model
 * output is treated as plain markdown, never injected as HTML (safe). remark-gfm adds
 * GitHub-flavoured tables / strikethrough / autolinks.
 *
 * Styling follows DESIGN.md via the repo's Tailwind theme tokens (font-serif = Instrument
 * Serif, font-mono = DM Mono, text-primary / text-secondary / text-muted warm neutrals,
 * text-accent = rosy brown #D3968C). Headings + links use the saffron accent; stat/hashtag
 * tables use DM Mono for that clinical-precision contrast against the warm prose.
 */

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function CaseStudyMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="text-sm leading-relaxed text-secondary font-sans">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="font-serif italic text-2xl text-primary tracking-tight mt-4 mb-2 first:mt-0">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="font-serif italic text-xl text-accent tracking-tight mt-4 mb-1.5">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-primary mt-3 mb-1.5">{children}</h3>
          ),
          p: ({ children }) => <p className="my-2 text-secondary leading-relaxed">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline decoration-accent/40 hover:decoration-accent transition-colors"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 marker:text-muted">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 marker:text-muted">{children}</ol>,
          li: ({ children }) => <li className="text-secondary leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-accent/50 pl-3 italic text-secondary">{children}</blockquote>
          ),
          hr: () => <hr className="my-4 border-0 border-t border-[rgba(var(--border-rgb),0.15)]" />,
          code: ({ children }) => (
            <code className="font-mono text-xs px-1 py-0.5 rounded-sm bg-surface-raised text-primary">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg bg-surface-raised p-3 font-mono text-xs text-primary">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-left font-mono text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-[rgba(var(--border-rgb),0.15)] px-2 py-1.5 font-medium font-mono uppercase tracking-wide text-[11px] text-muted">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-[rgba(var(--border-rgb),0.08)] px-2 py-1.5 text-secondary tabular-nums">{children}</td>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
