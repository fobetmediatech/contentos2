import { describe, it, expect } from 'vitest'
import { validateAttachment, resolveMimeType, MAX_FILE_BYTES } from './attachment'

describe('validateAttachment', () => {
  it('accepts a small pdf', () => {
    expect(validateAttachment({ name: 'brief.pdf', type: 'application/pdf', size: 1000 })).toBeNull()
  })

  it('rejects oversized files', () => {
    expect(validateAttachment({ name: 'big.pdf', type: 'application/pdf', size: MAX_FILE_BYTES + 1 })).toMatch(/too large/)
  })

  it('rejects unsupported types (docx)', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    expect(validateAttachment({ name: 'doc.docx', type: docx, size: 10 })).toMatch(/supported/)
  })

  it('falls back to extension when the browser reports a blank MIME (.md/.csv)', () => {
    expect(resolveMimeType('notes.md', '')).toBe('text/markdown')
    expect(resolveMimeType('rows.csv', '')).toBe('text/csv')
    expect(validateAttachment({ name: 'notes.md', type: '', size: 10 })).toBeNull()
  })
})
