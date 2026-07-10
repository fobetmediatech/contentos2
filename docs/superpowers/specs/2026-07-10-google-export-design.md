# Google Docs/Sheets export from chat results

**Date:** 2026-07-10
**Status:** Approved — implementing

## Goal

Add a "Export to Google" action on every relevant chat result (competitor analysis,
location discovery, reel hook report). Clicking it creates a Google **Sheet** (tabular
results) or **Doc** (reel narrative report) in the signed-in user's Google Drive and
returns a link — authorized through the user's existing **Clerk Google login**, no
separate account connection.

## Decisions (from brainstorming)

- **Auth:** team signs into Clerk via Google SSO → reuse it. Add the non-sensitive
  `https://www.googleapis.com/auth/drive.file` scope to Clerk's Google connection.
  `drive.file` grants per-file access to files the app creates → **no Google
  restricted-scope verification** required. Ideal for an internal tool.
- **Format per result type:**
  - Competitor + Discovery → Google **Sheet**
  - Reel hook report → Google **Doc**
- **Placement:** a shared button inline next to the existing "Copy for slides" /
  "Download CSV" buttons in the three result components.

## Architecture

### Server — `api/google-export.ts`
Vercel serverless, Clerk-gated like every other function.

1. `requireClerkUser(req, res)` → `userId`.
2. Get the caller's Google OAuth token via the Clerk Backend SDK:
   `createClerkClient({ secretKey }).users.getUserOauthAccessToken(userId, 'google')`.
   - No linked Google account / no token → respond `409 { error: 'google_reauth_required' }`.
3. Parse the neutral payload (discriminated union — see below).
4. Create the file via Google REST APIs using the token as a Bearer:
   - **Sheet:** `POST https://sheets.googleapis.com/v4/spreadsheets` `{ properties: { title } }`
     → then `PUT …/values/Sheet1!A1?valueInputOption=RAW` with `{ values: [headers, ...rows] }`.
     Return `spreadsheetUrl`.
   - **Doc:** `POST https://docs.googleapis.com/v1/documents` `{ title }` → then
     `POST …/documents/{id}:batchUpdate` with a single `insertText` request. Return
     `https://docs.google.com/document/d/{id}/edit`.
5. If any Google call returns 401/403 (scope missing / token stale) → respond
   `409 { error: 'google_reauth_required' }`. Any other Google failure →
   `502 { error: 'google_export_failed' }`. Success → `200 { url }`.

Reads only `process.env` (`CLERK_SECRET_KEY`, already set). No scraping/AI logic server-side.

### Client — `src/lib/googleExport.ts`
- `exportToGoogle(payload): Promise<{ url: string }>` — POST `/api/google-export` with the
  Clerk Bearer token (via `getClerkSessionToken`). On `409 google_reauth_required` throws a
  typed `GoogleReauthRequiredError`; other non-OK throws `GoogleExportError`.

### Content builders — `src/shared/utils/export.ts` (extend)
Neutral payload union:
```ts
export type GoogleExportPayload =
  | { kind: 'sheet'; title: string; headers: string[]; rows: (string | number)[][] }
  | { kind: 'doc'; title: string; markdown: string }
```
Builders reuse existing field logic:
- `buildCompetitorSheet(data): GoogleExportPayload` — same columns as `generateCSV`.
- `buildDiscoverySheet(data): GoogleExportPayload` — same columns as `generateDiscoveryCSV`.
- `buildReelDoc(payload): GoogleExportPayload` — reuses `summaryToMarkdown` per creator +
  a synthesis section.
- Sheet string cells pass a `sheetCell` formula-injection guard (prefix `=`/`+`/`-`/`@`
  with `'`), mirroring `csvCell` — Sheets evaluates formulas too.

### UI — `src/components/GoogleExportButton.tsx`
Shared button wired into `CompetitorResultMessage`, `DiscoveryResultMessage`,
`ReelResultMessage`. Props: `{ payload: GoogleExportPayload }`.
States: idle → "Exporting…" → success (renders "Open in Google Sheets/Docs ↗" link) →
error. On `GoogleReauthRequiredError`, renders a "Connect Google" button that calls
`externalAccount.reauthorize({ additionalScopes: ['…/drive.file'], redirectUrl })` on the
user's Google external account (via `useUser`), redirecting to consent and back; user then
re-clicks export.

## Testing
- Unit tests for the three payload builders (pure) — column/row correctness + formula guard.
- `googleExport.ts` transport test: `409 google_reauth_required` → `GoogleReauthRequiredError`.
- Server handler test: no Google token → `409`; happy path → `{ url }` (mock Clerk client + `fetch`).
- Existing 600+ tests stay green.

## One-time setup (documented, not code)
1. Google Cloud project: enable Docs API, Sheets API, Drive API.
2. Clerk dashboard → Google SSO connection → add scope `…/auth/drive.file`.
3. `CLERK_SECRET_KEY` already present in Vercel env.

## Out of scope (YAGNI)
- Rich Docs formatting (headings/bold) — v1 inserts readable text.
- Exporting to an existing/shared Drive folder or Team Drive.
- Sheets charts/conditional formatting.
