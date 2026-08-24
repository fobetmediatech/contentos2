/**
 * Discovery-call client brief — prompt, response schema, and normaliser (SERVER-SIDE, ESM,
 * self-contained — no ../src imports).
 *
 * A one-page brief a strategist prints after a discovery call: what the client wants, their niche,
 * their audience, and who they look up to. The unstyled counterpart to the FOBET deck, sibling to
 * the meeting summary.
 *
 * HONESTY IS THE FEATURE. Every section distinguishes what the client actually SAID from what the
 * model INFERRED (`assumed: true`). A blank section means the topic never came up — it is never
 * padded with a guess. This mirrors the extraction pipeline's extracted-vs-inferred provenance and
 * the summary's "never invent a number" rule: these briefs get sent to clients.
 *
 * No timestamps here (unlike the summary) — a printed one-pager reads as prose, not minutes.
 */

/** Deliberate cap, same reasoning as summaryPrompt: an unbounded slice is how one runaway row turns
 *  a request into a timeout. A discovery call is far inside the model's context window. */
const MAX_TRANSCRIPT_CHARS = 200_000

export interface BriefItem {
  text: string
  /** true = the model inferred this, not stated on the call. Renders as "(assumed)" for the client. */
  assumed: boolean
}

export interface DiscoveryBrief {
  /** '' when the client was never named on the call. */
  clientName: string
  /** '' when the niche/business was never stated. */
  clientNiche: string
  /** What they want out of their profile — goals, positioning, distribution. */
  goals: BriefItem[]
  /** Content direction / niche targeting — formats, pillars, shoot style. */
  contentDirection: BriefItem[]
  /** '' when geography was not discussed. */
  audienceGeography: string
  /** '' when the audience profile was not discussed. */
  audienceProfile: string
  /** Creators / people they said they look up to. Often assumed — clients rarely name them. */
  creatorsAdmired: BriefItem[]
  /** Anything else worth carrying into the strategy that did not fit above. */
  otherNotes: BriefItem[]
}

const ITEM_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      assumed: { type: 'boolean', description: 'true if inferred rather than stated on the call.' },
    },
    required: ['text', 'assumed'],
  },
} as const

export const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    client_name: { type: 'string', description: 'The client/brand name, or empty string if never stated.' },
    client_niche: { type: 'string', description: 'Their niche or business, or empty string if never stated.' },
    goals: ITEM_SCHEMA,
    content_direction: ITEM_SCHEMA,
    audience_geography: { type: 'string', description: 'Where the audience is, or empty string if not discussed.' },
    audience_profile: { type: 'string', description: 'Who the audience is, or empty string if not discussed.' },
    creators_admired: ITEM_SCHEMA,
    other_notes: ITEM_SCHEMA,
  },
  required: [
    'client_name',
    'client_niche',
    'goals',
    'content_direction',
    'audience_geography',
    'audience_profile',
    'creators_admired',
    'other_notes',
  ],
} as const

const SYSTEM = `You write a one-page DISCOVERY CALL brief for a content-strategy agency, using ONLY the transcript below.

The brief captures what the client wants so a strategist can plan their content. It gets printed and
sent, so honesty about what was actually said matters more than a full-looking page.

RULES:
- Never invent a fact, number, name or goal. If the client did not say it, it is not "stated".
- Mark every item as either stated or assumed:
    • assumed: false — the client actually said this on the call.
    • assumed: true  — your reasonable inference from what they said. Use sparingly, and only when
      it genuinely helps the strategist. A wrong "assumed" is confirmed with the client; a wrong
      "stated" survives into a client meeting.
- A BLANK section is correct and honest. Return an empty array (or an empty string for the two
  single-value fields) when a topic never came up. Do NOT pad a section to make the page look full.
- client_name / client_niche: fill only if actually stated. Empty string otherwise.
- goals: what they want out of their personal brand/profile — awareness, positioning, distribution
  channels (e.g. funnel to a Discord/website), reach, business objectives.
- content_direction: the content angle — pillars, formats, shoot style, cadence, number of accounts.
- audience_geography / audience_profile: where the audience is and who they are.
- creators_admired: creators or people they said they look up to. Clients rarely name these, so this
  section is usually empty or assumed=true — never fabricate specific names as if stated.
- other_notes: anything else material (their background, team, stated priorities) that did not fit above.
- Be brief and concrete. Prefer the client's own phrasing.
- Write in LATIN script only. Romanise any Hindi as Hinglish; never output Devanagari.`

export function buildBriefPrompt(title: string | null, fullText: string): string {
  return `${SYSTEM}\n\nMEETING: ${title ?? 'Untitled call'}\n\nTRANSCRIPT:\n${fullText.slice(0, MAX_TRANSCRIPT_CHARS)}`
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** Drop items with no text; accept snake_case (model) and camelCase (idempotent re-normalise). */
function items(v: unknown): BriefItem[] {
  return Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === 'object')
        .map((x) => ({ text: str(x.text), assumed: x.assumed === true }))
        .filter((x) => x.text !== '')
    : []
}

/**
 * Same defensive posture as normaliseSummary: responseSchema constrains the model but MAX_TOKENS or
 * safety filtering can still truncate the object. Malformed entries are dropped once, here, rather
 * than crashing the print view later.
 */
export function normaliseBrief(raw: unknown): DiscoveryBrief {
  const r = (Boolean(raw) && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    clientName: str(r.client_name ?? r.clientName),
    clientNiche: str(r.client_niche ?? r.clientNiche),
    goals: items(r.goals),
    contentDirection: items(r.content_direction ?? r.contentDirection),
    audienceGeography: str(r.audience_geography ?? r.audienceGeography),
    audienceProfile: str(r.audience_profile ?? r.audienceProfile),
    creatorsAdmired: items(r.creators_admired ?? r.creatorsAdmired),
    otherNotes: items(r.other_notes ?? r.otherNotes),
  }
}
