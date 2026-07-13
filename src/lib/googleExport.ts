/**
 * Client-side Google Docs/Sheets export.
 *
 * Takes a neutral GoogleExportPayload (from shared/utils/export), acquires a drive.file token
 * via the GIS popup (googleAuth), then creates the file directly against Google's REST APIs —
 * which support CORS for browser calls with a Bearer token. No server round-trip: the token is
 * the user's own and scoped to files this app creates.
 */

import { marked } from 'marked'
import type { GoogleExportPayload } from '../shared/utils/export'
import { requestGoogleToken } from './googleAuth'

export { GoogleAuthError } from './googleAuth'

/** Any failure creating the file (API not enabled, network, Google error). */
export class GoogleExportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleExportError'
  }
}

/** Pull the most useful message out of a Google REST error body. */
async function googleErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return body.error?.message || fallback
  } catch {
    return fallback
  }
}

async function createSheet(token: string, payload: Extract<GoogleExportPayload, { kind: 'sheet' }>): Promise<string> {
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ properties: { title: payload.title } }),
  })
  if (!createRes.ok) throw new GoogleExportError(await googleErrorMessage(createRes, 'Could not create the spreadsheet'))
  const sheet = (await createRes.json()) as { spreadsheetId?: string; spreadsheetUrl?: string }
  if (!sheet.spreadsheetId || !sheet.spreadsheetUrl) throw new GoogleExportError('Google returned no spreadsheet id')

  const range = encodeURIComponent('Sheet1!A1')
  const valuesRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheet.spreadsheetId}/values/${range}?valueInputOption=RAW`,
    { method: 'PUT', headers: auth, body: JSON.stringify({ values: [payload.headers, ...payload.rows] }) },
  )
  if (!valuesRes.ok) throw new GoogleExportError(await googleErrorMessage(valuesRes, 'Could not write rows to the sheet'))
  return sheet.spreadsheetUrl
}

async function createDoc(token: string, payload: Extract<GoogleExportPayload, { kind: 'doc' }>): Promise<string> {
  // Render the markdown to HTML and let Google Drive IMPORT it as a native Doc — this gives real
  // headings, bold, and bullet lists instead of the raw "#"/"**" text a plain insertText produced.
  const html = marked.parse(payload.markdown, { async: false, gfm: true }) as string
  const htmlDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`

  // Multipart upload: metadata part (target = Google Doc → triggers conversion) + the HTML media.
  const boundary = `contentos-${Math.random().toString(36).slice(2)}`
  const metadata = { name: payload.title, mimeType: 'application/vnd.google-apps.document' }
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: text/html; charset=UTF-8\r\n\r\n' +
    `${htmlDoc}\r\n` +
    `--${boundary}--`

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  if (!res.ok) throw new GoogleExportError(await googleErrorMessage(res, 'Could not create the document'))
  const doc = (await res.json()) as { id?: string }
  if (!doc.id) throw new GoogleExportError('Google returned no document id')
  return `https://docs.google.com/document/d/${doc.id}/edit`
}

/**
 * Create a Google Doc/Sheet from a finished result and return its URL.
 * Opens the GIS consent popup on first use — MUST be called from within a click handler.
 * @throws GoogleAuthError when authorization is cancelled/unconfigured; GoogleExportError on API failure.
 */
export async function exportToGoogle(payload: GoogleExportPayload): Promise<{ url: string }> {
  const token = await requestGoogleToken() // popup (in-gesture); cached token skips the popup
  const url = payload.kind === 'sheet' ? await createSheet(token, payload) : await createDoc(token, payload)
  return { url }
}
