/**
 * Single-reel deep analysis prompts (SERVER-SIDE, ESM, self-contained — no ../src imports).
 *
 * Two stages, both Gemini:
 *   1) Extraction (Files API, multimodal): transcript + timestamped segments + video mechanics.
 *   2) Synthesis (text-only): a hookmap-style markdown case study grounded in stage 1 + Apify.
 *
 * Ported/adapted from github.com/Adityaraj0421/hookmap (process-reel synthesis + video-analysis
 * prompts), with Whisper replaced by Gemini-native transcription. v1 omits the comments &
 * creator-benchmark sections (the prompt is written so they simply do not appear).
 */

/** Bump when extraction/synthesis prompts change so singleReelCache lazily invalidates. */
export const SINGLE_REEL_PROMPT_VERSION = 1

// ----- Stage 1: extraction -----

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

export const SINGLE_REEL_EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    transcript: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { start: { type: 'number' }, text: { type: 'string' } },
        required: ['start', 'text'],
      },
    },
    videoAnalysis: {
      type: 'object',
      properties: {
        duration_s: { type: 'number' },
        aspect_ratio: { type: 'string' },
        dominant_framing: { type: 'string' },
        cuts_count: { type: 'integer' },
        text_overlay_density: { type: 'string' },
        captions_present: { type: 'boolean' },
        trending_audio_hint: { type: 'string' },
        t0_frame: { type: 'string' },
        visual_beats: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              t_start: { type: 'number' },
              t_end: { type: 'number' },
              on_screen: { type: 'string' },
              function: { type: 'string' },
            },
            required: ['on_screen', 'function'],
          },
        },
        notable_moments: { type: 'array', items: { type: 'string' } },
      },
      required: ['t0_frame', 'visual_beats'],
    },
  },
  required: ['transcript', 'segments', 'videoAnalysis'],
} as const

export function buildExtractionPrompt(): string {
  return `You are a viral-reel forensics extractor. You can SEE the video frames AND HEAR the audio of ONE Instagram reel. Return ONLY JSON matching the schema — no prose, no code fences.

Extract three things:

1. transcript — the FULL spoken audio, transcribed VERBATIM. "" if there is no speech.
2. segments — the transcript split into short timestamped chunks: [{ "start": <seconds, number>, "text": "<words in that chunk>" }]. Keep chunks to roughly one sentence. start is the second the chunk begins. [] if there is no speech.
3. videoAnalysis — the MECHANICS (not a content summary):
   - duration_s, aspect_ratio ("9:16"/"1:1"/"4:5"/"other"), dominant_framing ("selfie"/"talking-head"/"locked-off-wide"/"pov"/"screen-capture"/"split-screen"/"other")
   - cuts_count, text_overlay_density ("none"/"low"/"medium"/"high"), captions_present (boolean), trending_audio_hint ("likely"/"unlikely"/"unknown")
   - t0_frame — one sentence on exactly what is on screen at t=0
   - visual_beats — narrative units: [{ "t_start": <s>, "t_end": <s>, "on_screen": "subject + motion + text overlay", "function": "short label e.g. 'state stakes'" }]. A beat may span multiple cuts.
   - notable_moments — any jump cut / punchline / visual shock, each with its timestamp.

Never invent values. Use null where a number is genuinely unknown. Transcribe only what is actually said — do not paraphrase or summarise the audio.`
}

// ----- Stage 2: synthesis (markdown) -----

const HOOK_ARCHETYPES_TEXT = `- **Curiosity gap** — Names a surprising outcome without revealing the cause. Example: "This $5 tool replaced my $2,000 one"
- **Contrarian claim** — States a belief that contradicts audience consensus. Example: "Stop using X. Here's why."
- **Sunk-cost / identity threat** — Attacks something the viewer has already invested in. Example: "3 years of React. All replaced by this."
- **Visual shock** — Opens on an image the viewer must resolve. Example: Dropping an expensive item
- **Direct callout** — Names the target viewer in frame-one. Example: "If you're a 20-something engineer, watch this"
- **Demo-first** — Shows the end result before explaining. Example: "This is what X looks like now"
- **Story cold-open** — Drops into mid-scene of a narrative. Example: "So I just got fired and..."
- **Question bait** — Asks a question the viewer can't not answer internally. Example: "Why do {thing} always {annoyance}?"
- **Authority / bandwagon FOMO** — Positions the subject as widely validated. Example: "This is the #1 app worldwide right now"`

export function buildSynthesisPrompt(): string {
  return `You are a senior Instagram strategist. You are reading ONE reel and explaining to another working creator why it worked — in the voice a strategist uses over coffee, not a forensics analyst writing a lab report. Every claim points to evidence: a transcript line, a visual beat, or an engagement signal. No jargon theatre. No filler.

## Inputs (user message JSON)
1. Apify data — engagement metrics, caption, hashtags, creator, music info.
2. Gemini transcript + timestamped segments.
3. Gemini video analysis — beats, cuts, framing, on-screen text.

## Rules
- Be specific. "Emotional hook" is not an answer. Name the exact emotion, the exact identity, the exact action.
- Quote when you cite. If you reference a hook line, quote it verbatim.
- Cite with timestamps — MANDATORY. Every claim about what's on screen, a cut, motion, framing change, text overlay, OR a specific quoted line MUST end with a [m:ss] bracket.
  - Visual claims cite from video_analysis.visual_beats[] or t0_frame.
  - Spoken-line claims cite the matching transcript segment start (seconds → m:ss). Example: "My heart is out of control" [0:02].
  - Use [0:03] for a moment, [0:03–0:08] for a range. Round to the nearest second. No citation = drop the claim.
- No invented details. If video_analysis has no beat for a claim, drop it or mark "[unknown]". Never fabricate a timestamp.
- If the caption asks viewers to comment a keyword AND comments are > 5% of likes, flag it in Psychology as an engineered DM funnel (normal organic ratio is 1–5%).

## Hook archetypes (for reference, not required to cite)
${HOOK_ARCHETYPES_TEXT}

## Output
Pure markdown. No preamble, no code-fence around the whole thing. Follow this structure EXACTLY. Sections separated by horizontal rules (---). Each bold-label line stays on its own line.

# @{handle}

> **{5–7 word one-line takeaway for this reel}**

| Posted | Duration | Views | Likes | Comments |
|---|---|---|---|---|
| {YYYY-MM-DD} | {duration}s | {views} | {likes} | {comments}{append " ⚠" only if engineered DM funnel detected} |

[{reel_url}]({reel_url})

---

## Hook

> "{exact first sentence of the transcript}"

**Power words**
- **"{phrase 1}"** — one clause on why this phrase stops the scroll for this audience
- **"{phrase 2}"** — one clause

(List 1–3 phrases. Don't pad.)

**Why it works** — 2–3 sentences naming the specific mechanic. The second sentence MUST describe what's on screen in the first beat and cite a timestamp, e.g. "At [0:00], confetti fills the frame, pre-loading the 'big news' valence before the audio lands." If no usable visual_beat exists, omit that sentence rather than fake it.

---

## Topic

**Surface** — the literal subject.

**Real** — what it's actually about beyond the literal.

**Who leans in** — the identity this reel speaks TO. Concrete, not "creators".

**Timing** — why it resonates right now. 1–2 sentences.

---

## Keywords

**Caption positioning** — 2–3 sentences on what the word choice signals about positioning and audience.

| Hashtag type | Tags |
|---|---|
| Reach (broad, high-volume) | {list or "none used"} |
| Intent (niche-specific) | {list or "none used"} |
| Branded / creator | {list or "none used"} |

**Search play** — what phrase is this creator trying to rank for in Instagram search? If none visible, say so in one sentence.

---

## Psychology

**Emotion** — name it precisely.

**Identity** — "This is for people who ___." One sentence.

**Primary action** — save / share / comment / DM funnel / follow. Pick one and explain the specific mechanic.

**Secondary action** — only if clearly present. Otherwise omit this line.

{Only if comments > 5% of likes AND the caption has a keyword CTA, append this blockquote; otherwise omit entirely:}

> ⚠ **Engineered DM funnel** — the comment count is a funnel metric, not organic virality. {One sentence on the mechanism.}

---

## 3 hook ideas for your niche

1. **"{hook line 1}"**
   *Mechanic:* {archetype reused from this reel}

2. **"{hook line 2}"**
   *Mechanic:* {archetype}

3. **"{hook line 3}"**
   *Mechanic:* {archetype}

---

*Caption (verbatim):*

> {caption}`
}

// ----- Coercion (guard the extraction output) -----

export function coerceExtraction(raw: unknown): ReelExtraction {
  const o = (raw ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const numOrNull = (v: unknown): number | null => (Number.isFinite(Number(v)) ? Number(v) : null)
  const str = (v: unknown, f = ''): string => (typeof v === 'string' ? v : f)

  const rawSegs = Array.isArray(o.segments) ? (o.segments as unknown[]) : []
  const segments: ReelSegment[] = rawSegs.map((s) => {
    const seg = (s ?? {}) as Record<string, unknown>
    return { start: num(seg.start), text: str(seg.text) }
  })

  const va = (o.videoAnalysis ?? {}) as Record<string, unknown>
  const rawBeats = Array.isArray(va.visual_beats) ? (va.visual_beats as unknown[]) : []
  const videoAnalysis: ReelVideoAnalysis = {
    duration_s: numOrNull(va.duration_s),
    aspect_ratio: str(va.aspect_ratio, 'other'),
    dominant_framing: str(va.dominant_framing, 'other'),
    cuts_count: numOrNull(va.cuts_count),
    text_overlay_density: str(va.text_overlay_density, 'none'),
    captions_present: typeof va.captions_present === 'boolean' ? va.captions_present : null,
    trending_audio_hint: str(va.trending_audio_hint, 'unknown'),
    t0_frame: str(va.t0_frame),
    visual_beats: rawBeats.map((b) => {
      const beat = (b ?? {}) as Record<string, unknown>
      return {
        t_start: numOrNull(beat.t_start),
        t_end: numOrNull(beat.t_end),
        on_screen: str(beat.on_screen),
        function: str(beat.function),
      }
    }),
    notable_moments: Array.isArray(va.notable_moments) ? (va.notable_moments as unknown[]).map((x) => str(x)) : [],
  }

  return { transcript: str(o.transcript), segments, videoAnalysis }
}
