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
- **Direction:** Lotus Pond — deep pond-green surfaces, beige "lily" text, a single rosy-brown bloom as the accent. Editorial, botanical, calm. Ships with **both dark (default) and light** modes that flip automatically via `prefers-color-scheme`.
- **Decoration level:** Intentional — green-on-green surface depth, DM Mono precision as a deliberate contrast signal, one warm accent that pops.
- **Mood:** Calm, authoritative, precise. A research tool that feels like a studio garden — the data feels real because the surface is unhurried.
- **The rule:** Surfaces are green, text is beige (dark) / dark-green (light), the accent is rosy brown — used sparingly. All colors are CSS variables (tokens.css); never hardcode a hex that won't flip with the mode.

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

**Palette anchors:** Dark green `#0A3323` · Moss green `#839958` · Beige `#F7F4D5` · Rosy brown `#D3968C` · Midnight green `#105666`.

Every color is a CSS variable in `src/shared/styles/tokens.css`. Dark is the default `:root`; light overrides inside `@media (prefers-color-scheme: light)`. Translucent borders/tints flip via the `--border-rgb` / `--accent-rgb` / `--ai-rgb` channel vars. Tailwind tokens (`tailwind.config.js`) and `[var(--…)]` arbitrary classes both read from here — so the whole app flips with the OS theme. **Never hardcode a hex in a component** (the two exceptions that need literals: Clerk `appearance.variables`, which Clerk derives shades from in JS, and SVG/Recharts presentation attributes, where `var()` doesn't resolve).

### Dark mode (default)
```css
--color-bg: #082619;             /* deep pond green — background */
--color-surface: #0A3323;        /* dark green card base */
--color-surface-raised: #0F4730;
--color-surface-elevated: #135A3D;
--color-border: rgba(var(--border-rgb), 0.10);   /* --border-rgb: 247,244,213 (beige) */
--color-text-primary: #F7F4D5;   /* beige */
--color-text-secondary: #B8C49B; /* light moss */
--color-text-muted: #8A9A74;     /* muted moss — WCAG AA on deep green */
--color-accent: #D3968C;         /* rosy brown — CTAs, active states, links */
--color-accent-hover: #C07E73;
--color-accent-light: #E3B5AC;
--color-success: #9CB36A;  --color-warning: #D9A441;  --color-error: #D9706A;
--color-info: #2E8198;     --color-ai-tint: #A78BFA;  /* AI-generated content ONLY */
```

### Light mode (`prefers-color-scheme: light`)
```css
--color-bg: #F7F4D5;             /* beige */
--color-surface: #FFFEF7;
--color-surface-raised: #EEEACB;
--color-border: rgba(var(--border-rgb), 0.12);   /* --border-rgb: 10,51,35 (dark green) */
--color-text-primary: #0A3323;   /* dark green */
--color-text-secondary: #105666; /* midnight green */
--color-text-muted: #5C7257;     /* muted green — WCAG AA on beige */
--color-accent: #C77A6B;         /* rosy brown, deepened for contrast on beige */
--color-accent-light: #A85A4E;
--color-success: #5C7A3D;  --color-warning: #B57A12;  --color-error: #C0453E;
--color-info: #105666;     --color-ai-tint: #6D5BC4;
```

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
| 2026-06-30 | Chai Dark → Lotus Pond + light/dark | Full palette pivot to pond-green/beige/rosy-brown, driven entirely by CSS vars so the app flips between dark (default) and light via `prefers-color-scheme`. Accent moved saffron → rosy brown. Clerk + Recharts keep fixed hex (can't take vars). |
