/**
 * Tests for the client-side Google export: it acquires a token (mocked googleAuth) then creates
 * the file against Google's REST APIs (mocked fetch). Verifies url on success, the two-call sheet
 * flow (create → write values), the Bearer token, and error surfacing from Google's error body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { exportToGoogle, GoogleExportError } from './googleExport'

const requestTokenMock = vi.hoisted(() => vi.fn())
vi.mock('./googleAuth', () => ({
  requestGoogleToken: requestTokenMock,
  GoogleAuthError: class GoogleAuthError extends Error {},
}))

beforeEach(() => {
  vi.resetAllMocks()
  requestTokenMock.mockResolvedValue('ya29.token')
})
afterEach(() => vi.unstubAllGlobals())

const sheet = { kind: 'sheet' as const, title: 'T', headers: ['a', 'b'], rows: [['1', '2']] }
const doc = { kind: 'doc' as const, title: 'D', markdown: '# hi' }

describe('exportToGoogle (sheet)', () => {
  it('creates a spreadsheet, writes values, and returns the url with a Bearer token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ spreadsheetId: 'sid', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sid' }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await exportToGoogle(sheet)
    expect(res.url).toBe('https://docs.google.com/spreadsheets/d/sid')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer ya29.token')
    // second call is the values PUT with headers + rows
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).values).toEqual([['a', 'b'], ['1', '2']])
  })

  it('surfaces the Google error message when the API is not enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: { message: 'Google Sheets API has not been used in project 123 before or it is disabled.' } }),
    }))
    await expect(exportToGoogle(sheet)).rejects.toThrow(/has not been used/)
  })
})

describe('exportToGoogle (doc)', () => {
  it('uploads the markdown as converted HTML and returns the edit url', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ id: 'did' }) })
    vi.stubGlobal('fetch', fetchMock)

    const res = await exportToGoogle(doc)
    expect(res.url).toBe('https://docs.google.com/document/d/did/edit')
    const [url, init] = fetchMock.mock.calls[0]
    // Single multipart upload to the Drive upload endpoint, converting to a Google Doc.
    expect(url).toContain('/upload/drive/v3/files')
    expect(init.headers['Content-Type']).toMatch(/multipart\/related/)
    expect(init.body).toContain('application/vnd.google-apps.document')
    // "# hi" markdown becomes an <h1>, not literal text.
    expect(init.body).toContain('<h1>hi</h1>')
  })

  it('throws GoogleExportError when Google returns no document id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }))
    await expect(exportToGoogle(doc)).rejects.toBeInstanceOf(GoogleExportError)
  })
})
