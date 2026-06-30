# Design System — Content OS 2.0

## Product Context
- **What this is:** Browser-based Instagram creator research tool with a conversational chat interface
- **Who it's for:** Indian content creators, social media managers, and brand marketers researching creators and competitors
- **Space/industry:** Creator economy / influencer marketing / social media analytics
- **Project type:** Web app (chat-first, research pipeline)

## Memorable Thing
> "This was built for creators, by someone who gets it."

Every design decision should reinforce that someone who lives in the creator economy made this — not an enterprise SaaS team.

## Aesthetic Direction
- **Direction:** Chai Dark — warm near-black background (the color of strong chai held to light), not clinical dark mode. Creator-studio energy. Editorial but not fashion-y.
- **Decoration level:** Intentional — warm undertones everywhere, subtle card depth, DM Mono precision as a deliberate contrast signal
- **Mood:** Warm, authoritative, precise. A research tool that feels like it was designed at a studio run by creators. The data feels real because the warmth makes you trust it.
- **The rule:** Every neutral must have a warm undertone. No pure Tailwind slate grays (#94A3B8, #CBD5E1, etc.) — if a neutral doesn't have amber/brown in it, reject it.

## Competitive Differentiation
- **Later.com:** Warm cream + bold editorial (light). We go warm dark — unclaimed territory.
- **HypeAuditor:** Cold navy enterprise. We go warm and approachable.
- **Phlanx:** Purple gradient generic. We go saffron orange, zero purple.
- **The gap we own:** Warm dark + serif display + saffron orange. None of the competitors are here.

## Typography

- **Display / Hero / Wordmark:** [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif) — *italic weight*
  - Used for: result counts ("23 creators found"), pipeline headings, the "Content OS" wordmark in the nav
  - Why: No creator tool uses serif. It signals editorial authority. Contemporary, not old-fashioned.
- **Body / Chat / UI / Labels:** [Outfit](https://fonts.google.com/specimen/Outfit) — weights 400, 500, 600
  - Used for: chat messages, card descriptions, nav labels, buttons, settings
  - Why: Warm geometric. Has personality Inter doesn't. Not the Space Grotesk convergence trap.
- **Data / Numbers / Metrics:** [DM Mono](https://fonts.google.com/specimen/DM+Mono) — weights 400, 500, tabular-nums
  - Used for: follower counts, engagement rates, all numeric metrics, section labels (uppercase, letter-spaced), API key inputs
  - Why: Clinical precision contrasts against warmth. Numbers in DM Mono read as trustworthy.
- **Code:** DM Mono (same as data)

### Font Loading
```html
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@400;500;600;700&family=DM+Mono:ital,wght@0,400;0,500;1,400&display=swap" rel="stylesheet">
```

### Typographic Scale
| Token | Font | Size | Weight | Usage |
|-------|------|------|--------|-------|
| display | Instrument Serif italic | 32–80px | — | Result counts, hero headings |
| h2 | Outfit | 24px | 700 | Section titles |
| h3 | Outfit | 18px | 600 | Card section titles |
| body | Outfit | 15px | 400 | Chat messages, descriptions |
| body-sm | Outfit | 13px | 400 | Captions, secondary text |
| label | Outfit | 13px | 500 | UI labels, nav items |
| label-mono | DM Mono | 11px | 400 | Section eyebrows (uppercase, +0.1em letter-spacing) |
| data-lg | DM Mono | 28px | 500 | Large metric displays |
| data | DM Mono | 14px | 500 | Inline metrics (followers, ER) |
| data-sm | DM Mono | 12px | 400 | Compact stats |

## Color System

### Approach: Chai Dark (primary)

```css
/* Surfaces */
--color-bg: #1A1410;             /* chai warm near-black — the background */
--color-surface: #2C2218;        /* card base — floats off bg, no shadow needed */
--color-surface-raised: #3D3025; /* hover states, secondary surfaces */
--color-surface-elevated: #4A3C2E; /* tooltips, dropdowns */

/* Borders */
--color-border: rgba(245, 237, 214, 0.08);    /* subtle warm border */
--color-border-strong: rgba(245, 237, 214, 0.15); /* focus states, card hovers */

/* Text */
--color-text-primary: #F5EDD6;   /* aged paper warm white — NOT pure white */
--color-text-secondary: #C4A882; /* warm muted text */
--color-text-muted: #8B7D6B;     /* labels, placeholders, captions — WCAG AA on chai bg (was #7A6A54) */

/* Accent — Saffron Orange */
--color-accent: #E07B3A;         /* marigold energy — CTAs, active states, links */
--color-accent-hover: #C4612A;   /* darker on hover */
--color-accent-subtle: rgba(224, 123, 58, 0.12); /* accent backgrounds, tinted surfaces */
--color-accent-light: #F4A97B;   /* lighter accent for text on dark accent bg */

/* AI Insight Tint — ONLY for Gemini-generated content */
--color-ai-tint: #A78BFA;        /* soft violet — signals "this came from AI, not raw data" */
--color-ai-subtle: rgba(167, 139, 250, 0.10);

/* Semantic */
--color-success: #4CAF7D;        /* warm-lean green — high ER, confirmed location */
--color-success-subtle: rgba(76, 175, 125, 0.10);
--color-warning: #D97706;        /* amber — "likely" location badges */
--color-warning-bg: rgba(217, 119, 6, 0.10);
--color-error: #E05C5C;          /* error states, low ER warning */

/* Shadows */
--shadow-card: 0 1px 3px rgba(0,0,0,0.4), 0 0 0 1px var(--color-border);
```

### Alternative: Warm Cream (light mode, if ever needed)
- Background: `#FAFAF8` (warm bone, not clinical white)
- Surface: `#FFFFFF`
- Text primary: `#1C1410` (warm near-black)
- Text secondary: `#5C4A30`
- All accents remain identical (saffron orange, DM Mono, etc.)

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable (breathing room in the chat interface)
- **Scale:** 2(2px) · 4(4px) · 8(8px) · 12(12px) · 16(16px) · 20(20px) · 24(24px) · 32(32px) · 40(40px) · 48(48px) · 64(64px) · 80(80px)

## Layout
- **Approach:** Grid-disciplined for results, fluid for chat
- **Chat max-width:** 720px centered
- **Content max-width:** 1100px
- **Border radius:**
  - `--radius-sm: 6px` — inputs, small chips
  - `--radius: 10px` — cards, modals
  - `--radius-lg: 14px` — large cards, mockup frames
  - `--radius-full: 9999px` — badges, pill buttons

## Motion
- **Approach:** Intentional — only transitions that aid comprehension or feel alive
- **Easing:** enter `ease-out` / exit `ease-in` / state-change `ease-in-out`
- **Durations:**
  - micro: 100ms — color/border hover transitions
  - short: 200ms — button state changes
  - medium: 280ms — card appear, message slide-in
  - long: 400ms — panel open/close
- **Chat messages:** slide in from below (translateY 8px → 0, opacity 0 → 1, 280ms ease-out)
- **Creator cards:** subtle appear (opacity 0 → 1, translateY 4px → 0, 240ms ease-out, staggered 40ms per card)

## Component Patterns

### Chat Bubbles
- User: `--color-accent` background, white text, `border-bottom-right-radius: 4px`
- Bot (text): `--color-surface` background, `--color-text-primary`, border `--color-border`, `border-bottom-left-radius: 4px`
- Bot (AI insight): `--color-ai-subtle` background, violet border, "✦ Gemini" eyebrow label in `--color-ai-tint`

### Creator Cards
- Background: `--color-surface`
- Border: `--color-border`, hover → `--color-border-strong`
- Rank badge (top): `--color-accent-subtle` bg, `--color-accent-light` text
- Rank badge (trending): orange bg, orange text
- Location badges:
  - Confirmed: `--color-success-subtle` bg, `--color-success` text
  - Likely: `--color-warning-bg` bg, `--color-warning` text
  - Unconfirmed: `--color-surface-raised` bg, `--color-text-muted` text, 70% opacity
- ER above avg: `--color-success`
- ER below avg: `--color-warning`
- Metric numbers: DM Mono, tabular-nums

### Section Labels (eyebrows)
```css
font-family: var(--font-mono);
font-size: 11px;
letter-spacing: 0.12em;
text-transform: uppercase;
color: var(--color-text-muted);
```

### Progress Steps (in-chat)
- Done: `--color-success` circle, checkmark
- Active: `--color-accent` circle, animated pulse
- Pending: `--color-surface-raised` circle, muted label

## Anti-Patterns (Never Do)
- Never use pure Tailwind slate grays without warm undertone
- Never use Inter as the primary font
- Never use indigo/blue/purple as the main accent (those are reserved for the old tokens — deprecate them)
- Never use purple gradients as decorative backgrounds
- Never use centered-everything SaaS hero layout
- Never use 3-column icon feature grids
- Never use bubble border-radius on everything uniformly
- Never add Gemini AI tint (violet) to non-AI-generated content

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-01 | Chai Dark aesthetic direction | Warm near-black background is unclaimed territory in the creator tool space. All competitors use light or cold-dark. |
| 2026-06-01 | Instrument Serif (italic) for display | No creator tool uses serif. Signals editorial authority. Contemporary, not old-fashioned. |
| 2026-06-01 | Outfit for body/UI | Warm geometric with personality. Avoids the Inter/Space Grotesk convergence trap. |
| 2026-06-01 | DM Mono for all numeric metrics | Clinical precision as a deliberate contrast signal against the warm palette. Makes data feel trustworthy. |
| 2026-06-01 | Saffron orange (#E07B3A) as accent | Marigold energy. Completely absent from competitor palette (all use blue/indigo/purple). |
| 2026-06-01 | AI insight tint violet (#A78BFA) | Semantic signal: this color only appears on Gemini-generated content. Users learn to read it. |
| 2026-06-01 | Warm undertone rule for all neutrals | Discipline that makes the whole system feel coherent vs. assembled from parts. |
| 2026-06-30 | Muted text #7A6A54 → #8B7D6B | Old value sat at the WCAG AA contrast floor on the chai bg. Lightened a touch while keeping the warm brown undertone. |
