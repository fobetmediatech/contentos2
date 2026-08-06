import { describe, it, expect } from 'vitest'
import { decodeDocs, ContextDocError, MAX_DOCS } from './contextDocs'

const b64 = (s: string) => Buffer.from(s).toString('base64')
const doc = (over: Partial<{ name: string; mimeType: string; data: string }> = {}) => ({
  name: 'brief.pdf',
  mimeType: 'application/pdf',
  data: b64('hello'),
  ...over,
})

describe('decodeDocs', () => {
  it('returns nothing for absent or empty input', () => {
    expect(decodeDocs(undefined)).toEqual([])
    expect(decodeDocs([])).toEqual([])
  })

  it('decodes a valid document to bytes', () => {
    const [d] = decodeDocs([doc()])
    expect(d.name).toBe('brief.pdf')
    expect(Buffer.from(d.bytes).toString()).toBe('hello')
  })

  it('rejects an unsupported file type loudly rather than skipping it', () => {
    // Silently dropping a file would extract from less context than the user attached, and the
    // output would look identical to a complete run.
    expect(() => decodeDocs([doc({ mimeType: 'application/x-msdownload' })])).toThrow(ContextDocError)
    expect(() => decodeDocs([doc({ mimeType: '' })])).toThrow(/Unsupported/)
  })

  it('accepts the office and image formats Gemini reads natively', () => {
    for (const mimeType of [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/csv',
      'image/png',
    ]) {
      expect(decodeDocs([doc({ mimeType })])).toHaveLength(1)
    }
  })

  it('rejects a document missing a name or data', () => {
    expect(() => decodeDocs([doc({ name: '  ' })])).toThrow(/name and data/)
    expect(() => decodeDocs([doc({ data: '' })])).toThrow(/name and data/)
  })

  it('caps the document count', () => {
    const many = Array.from({ length: MAX_DOCS + 1 }, () => doc())
    expect(() => decodeDocs(many)).toThrow(/At most/)
  })

  it('caps TOTAL bytes, not per-file', () => {
    // Five 1 MB files pass individually but blow the request limit together.
    const big = doc({ data: Buffer.alloc(1024 * 1024).toString('base64') })
    expect(() => decodeDocs([big, big, big, big, big])).toThrow(/MB total limit/)
  })

  it('copies bytes out of the pooled Buffer backing store', () => {
    // Buffer.from() views a shared pool; handing that ArrayBuffer to the uploader could send
    // neighbouring files' bytes.
    const [d] = decodeDocs([doc()])
    expect(d.bytes.byteLength).toBe(5)
  })
})
