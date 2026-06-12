# Content OS 2.0

Browser-based Instagram research tool for internal team use. Conversational interface routing to three AI pipelines: Competitor Analysis, Location Discovery, and Reel Hook Analysis.

**Stack:** React 19 + Vite + TypeScript (strict) + Zustand + Clerk (auth) + Supabase (data sync + corpus) + Gemini 2.5 + Apify + Vercel

---

## Quickstart

### 1. Install bun

**Windows (PowerShell):**
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```
**macOS:** `brew install oven-sh/bun/bun`  
**Linux:** `curl -fsSL https://bun.sh/install | bash`

### 2. Clone and install

```bash
git clone https://github.com/fobetmediatech/contentos2.git
cd contentos2
bun install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and set the three required values:

| Variable | Where to get it |
|---|---|
| `VITE_CLERK_PUBLISHABLE_KEY` | [clerk.com](https://clerk.com) → Your App → API Keys |
| `VITE_GEMINI_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API key |
| `VITE_APIFY_KEY_1` | [apify.com](https://apify.com) → Settings → Integrations → API tokens |

Supabase variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) are required for conversation sync and the corpus. Get them from your Supabase project dashboard → Project Settings → API.

### 4. Run

```bash
bun run dev        # http://localhost:5173
bun run test       # 608+ unit tests — must exit 0
bun run build      # typecheck + vite build
bun run lint       # ESLint
```

---

## Architecture

- **No Settings UI** — keys are env vars only; changing a key means a Vercel redeploy.
- **Backend:** `api/analyze-reel-video.ts` (Vercel serverless) handles Gemini Files API video upload for deep reel analysis. Gated by Clerk JWT verification server-side. All other AI/scraping calls run client-side (see Phase 1 of the improvement plan for the proxy migration).
- **Data:** Zustand stores persist conversation history and reel state to Supabase (`user_state` table). The shared team corpus lives in `corpus_creators` / `corpus_sightings` / `corpus_content`.
- **Tests:** 608+ Vitest unit tests, hermetic (no real network calls). CI via `.github/workflows/ci.yml`.

## Improvement plan

A detailed 7-phase improvement plan lives at `docs/superpowers/plans/2026-06-12-product-improvement-master-plan.md`. Raw audit findings (95 items, adversarially verified): `.planning/audit-2026-06-12-extract.md`.

## Deployment

Deploys to Vercel. Build command: `bun run build`. Set all `VITE_*` env vars + `GEMINI_API_KEY` + `CLERK_SECRET_KEY` in Vercel project settings.
