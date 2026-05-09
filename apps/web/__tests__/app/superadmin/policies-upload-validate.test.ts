import { describe, it, expect } from 'vitest'
import { isAcceptedFile, validateUpload } from '@/app/superadmin/policies/page'

// Validation runs on every file the operator drops or picks. The
// server re-validates against SUPPORTED_MIMES, but rejecting client-
// side avoids round-tripping a 30 MB file to Supabase Storage just
// to find out it's a .docx.
//
// Some OSes hand us a File with type === '' (Windows ZIPs the type
// off, Linux clipboards do too); the extension fallback is the
// reason isAcceptedFile is its own helper.

function makeFile(opts: { name: string; type?: string; size?: number }): File {
  const size = opts.size ?? 1024
  // Use a Uint8Array of the requested length; works in jsdom + Node.
  const blob = new Blob([new Uint8Array(size)], { type: opts.type ?? '' })
  return new File([blob], opts.name, { type: opts.type ?? '' })
}

describe('isAcceptedFile', () => {
  it('accepts MIME-tagged PDFs', () => {
    expect(isAcceptedFile({ name: 'reg.pdf', type: 'application/pdf' })).toBe(true)
  })

  it('accepts MIME-tagged markdown', () => {
    expect(isAcceptedFile({ name: 'policy.md', type: 'text/markdown' })).toBe(true)
    expect(isAcceptedFile({ name: 'policy.md', type: 'text/x-markdown' })).toBe(true)
  })

  it('accepts plain text', () => {
    expect(isAcceptedFile({ name: 'note.txt', type: 'text/plain' })).toBe(true)
  })

  it('falls back to extension when MIME is empty (Windows / clipboard drops)', () => {
    expect(isAcceptedFile({ name: 'reg.pdf',      type: '' })).toBe(true)
    expect(isAcceptedFile({ name: 'policy.md',    type: '' })).toBe(true)
    expect(isAcceptedFile({ name: 'policy.markdown', type: '' })).toBe(true)
    expect(isAcceptedFile({ name: 'note.txt',     type: '' })).toBe(true)
  })

  it('rejects .docx, .pptx, .xlsx via both MIME and extension', () => {
    expect(isAcceptedFile({ name: 'policy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBe(false)
    expect(isAcceptedFile({ name: 'data.xlsx',   type: '' })).toBe(false)
  })

  it('rejects images', () => {
    expect(isAcceptedFile({ name: 'scan.jpg', type: 'image/jpeg' })).toBe(false)
    expect(isAcceptedFile({ name: 'scan.png', type: 'image/png' })).toBe(false)
  })

  it('is case-insensitive on the extension fallback', () => {
    expect(isAcceptedFile({ name: 'REG.PDF', type: '' })).toBe(true)
    expect(isAcceptedFile({ name: 'Note.TXT', type: '' })).toBe(true)
  })
})

describe('validateUpload', () => {
  it('accepts a normal-sized PDF', () => {
    const f = makeFile({ name: 'reg.pdf', type: 'application/pdf', size: 500_000 })
    expect(validateUpload(f)).toEqual({ ok: true })
  })

  it('rejects unsupported types with a clear reason', () => {
    const f = makeFile({ name: 'policy.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    const r = validateUpload(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Unsupported file type/i)
  })

  it('rejects files over the 25 MB cap', () => {
    const f = makeFile({ name: 'big.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 })
    const r = validateUpload(f)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/over the 25 MB cap/)
      expect(r.reason).toMatch(/26\.0 MB/)
    }
  })

  it('accepts a file exactly at 25 MB', () => {
    const f = makeFile({ name: 'edge.pdf', type: 'application/pdf', size: 25 * 1024 * 1024 })
    expect(validateUpload(f)).toEqual({ ok: true })
  })

  it('rejects an empty file', () => {
    const f = makeFile({ name: 'empty.pdf', type: 'application/pdf', size: 0 })
    const r = validateUpload(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/empty/i)
  })

  it('rejects a file with a missing MIME and unknown extension', () => {
    const f = makeFile({ name: 'mystery', type: '', size: 100 })
    const r = validateUpload(f)
    expect(r.ok).toBe(false)
  })
})
