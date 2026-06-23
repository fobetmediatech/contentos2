/**
 * ReelResultMessage — renders a SNAPSHOTTED reel/hook run INLINE in the chat (Phase 2 parity).
 *
 * Reel runs used to live only in the global reel store (one run at a time), so switching
 * conversations showed the wrong run. Now a superseded run is snapshotted into a `type:'result'`
 * kind:'reel' message in the conversation it ran in, and this component renders it statically —
 * immune to the live store moving on. It reuses InlineReelResults so a snapshot is visually
 * identical to the live block.
 */

import { Bot, Video } from 'lucide-react'
import type { ReelResultPayload } from '../store/analysisStore'
import { InlineReelResults } from './InlineReelResults'

interface Props {
  payload: ReelResultPayload
  /** Prefill the chat input (the "remix for my niche" handoff). */
  onSuggest: (text: string) => void
  onStartOver: () => void
}

export function ReelResultMessage({ payload, onSuggest, onStartOver }: Props) {
  const { handles, creatorStates, synthesis } = payload

  return (
    <>
      {/* Completion bubble — mirrors the competitor/discovery result header. */}
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[rgba(167,139,250,0.12)] flex items-center justify-center mt-0.5">
          <Video size={14} className="text-[#A78BFA]" />
        </div>
        <div className="flex flex-col gap-2 max-w-[80%]">
          <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-surface border border-[rgba(245,237,214,0.08)] text-sm leading-relaxed">
            <div className="flex items-center gap-2 mb-1">
              <Bot size={14} className="text-[#A78BFA] flex-shrink-0" />
              <span className="font-semibold text-primary">Reel breakdown</span>
            </div>
            <p className="text-secondary">
              Hook analysis for {handles.map((h) => `@${h}`).join(', ')}.
            </p>
          </div>
          <button
            onClick={onStartOver}
            className="self-start px-4 py-2 text-sm text-secondary border border-[rgba(245,237,214,0.10)] rounded-xl hover:bg-surface-raised transition-colors"
          >
            Start over
          </button>
        </div>
      </div>

      {/* The reel results, rendered from the snapshot. synthesisStatus is derived: 'done' when a
          synthesis was captured, else 'idle' (show just the per-creator cards — never a scary
          "synthesis failed" box on a historical snapshot). */}
      <InlineReelResults
        handles={handles}
        creatorStates={creatorStates}
        synthesisStatus={synthesis ? 'done' : 'idle'}
        synthesis={synthesis}
        synthesisError={null}
        onSuggest={onSuggest}
      />
    </>
  )
}
