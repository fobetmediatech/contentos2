/**
 * Domain types for single-reel analysis results and transcript results.
 *
 * Moved here from src/store/singleReelStore.ts (Task 6) so components, hooks,
 * and libraries can import types without pulling in Zustand store logic.
 * TranscriptSegment/TranscriptResult moved here from src/store/transcriptStore.ts (Task 11).
 *
 * Keep in sync with api/_lib/singleReelPrompt.ts
 * (app tsconfig.app.json includes only "src" — cannot import across the api/ boundary at build time)
 */

// ---------------------------------------------------------------------------
// Transcript types (moved from transcriptStore.ts — Task 11)
// ---------------------------------------------------------------------------

export interface TranscriptSegment {
  start: number // seconds
  text: string
}

export interface TranscriptResult {
  transcript: string
  segments: TranscriptSegment[]
}

// ---------------------------------------------------------------------------
// Single-reel analysis types
// ---------------------------------------------------------------------------

export interface ReelSegment {
  start: number // seconds
  text: string
}

export interface ReelVideoAnalysis {
  duration_s: number | null
  aspect_ratio: string
  dominant_framing: string
  cuts_count: number | null
  text_overlay_density: string
  captions_present: boolean | null
  trending_audio_hint: string
  t0_frame: string
  visual_beats: Array<{ t_start: number | null; t_end: number | null; on_screen: string; function: string }>
  notable_moments: string[]
}

export interface ReelExtraction {
  transcript: string
  segments: ReelSegment[]
  videoAnalysis: ReelVideoAnalysis
}

/** The serverless result: extraction (transcript/segments/videoAnalysis) + markdown case study. */
export interface SingleReelResult extends ReelExtraction {
  markdown: string
}
