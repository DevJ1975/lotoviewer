import { describe, it, expect } from 'vitest'
import { validateDroppedFile, formatBytes } from '@/components/ui/Dropzone'

// Validation runs on every file the operator drops or picks. Server
// re-validates against SUPPORTED_MIMES, but rejecting client-side
// avoids round-tripping a 30 MB file to Supabase Storage just to
// find out it's a .docx.
//
// Some OSes hand us a File with type === '' (Windows ZIPs the type
// off, Linux clipboards do too); the extension fallback is the
// reason the validator looks at file.name.

function makeFile(opts: { name: string; type?: string; size?: number }): File {
  const size = opts.size ?? 1024
  const blob = new Blob([new Uint8Array(size)], { type: opts.type ?? '' })
  return new File([blob], opts.name, { type: opts.type ?? '' })
}

describe('validateDroppedFile (default MD/TXT/PDF allowlist)', () => {
  it('accepts a normal-sized PDF', () => {
    const f = makeFile({ name: 'reg.pdf', type: 'application/pdf', size: 500_000 })
    expect(validateDroppedFile(f)).toEqual({ ok: true })
  })

  it('accepts MIME-tagged markdown / x-markdown / plain', () => {
    expect(validateDroppedFile(makeFile({ name: 'a.md',  type: 'text/markdown'   })).ok).toBe(true)
    expect(validateDroppedFile(makeFile({ name: 'a.md',  type: 'text/x-markdown' })).ok).toBe(true)
    expect(validateDroppedFile(makeFile({ name: 'a.txt', type: 'text/plain'      })).ok).toBe(true)
  })

  it('falls back to extension when MIME is empty (Windows / clipboard drops)', () => {
    expect(validateDroppedFile(makeFile({ name: 'reg.pdf',         type: '' })).ok).toBe(true)
    expect(validateDroppedFile(makeFile({ name: 'policy.md',       type: '' })).ok).toBe(true)
    expect(validateDroppedFile(makeFile({ name: 'policy.markdown', type: '' })).ok).toBe(true)
    expect(validateDroppedFile(makeFile({ name: 'note.txt',        type: '' })).ok).toBe(true)
  })

  it('is case-insensitive on the extension fallback', () => {
    expect(validateDroppedFile(makeFile({ name: 'REG.PDF',  type: '' })).ok).toBe(true)
    expect(validateDroppedFile(makeFile({ name: 'Note.TXT', type: '' })).ok).toBe(true)
  })

  it('rejects .docx, .xlsx with a clear reason', () => {
    const r = validateDroppedFile(makeFile({ name: 'p.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Unsupported file type/i)
    expect(validateDroppedFile(makeFile({ name: 'd.xlsx', type: '' })).ok).toBe(false)
  })

  it('rejects images', () => {
    expect(validateDroppedFile(makeFile({ name: 'scan.jpg', type: 'image/jpeg' })).ok).toBe(false)
    expect(validateDroppedFile(makeFile({ name: 'scan.png', type: 'image/png' })).ok).toBe(false)
  })

  it('rejects files over the 25 MB cap with a sized reason', () => {
    const r = validateDroppedFile(makeFile({ name: 'big.pdf', type: 'application/pdf', size: 26 * 1024 * 1024 }))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toMatch(/over the 25 MB cap/)
      expect(r.reason).toMatch(/26\.0 MB/)
    }
  })

  it('accepts a file exactly at 25 MB', () => {
    const r = validateDroppedFile(makeFile({ name: 'edge.pdf', type: 'application/pdf', size: 25 * 1024 * 1024 }))
    expect(r.ok).toBe(true)
  })

  it('rejects an empty file', () => {
    const r = validateDroppedFile(makeFile({ name: 'empty.pdf', type: 'application/pdf', size: 0 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/empty/i)
  })

  it('rejects a file with missing MIME and unknown extension', () => {
    expect(validateDroppedFile(makeFile({ name: 'mystery', type: '', size: 100 })).ok).toBe(false)
  })
})

describe('validateDroppedFile (custom allowlist — PDF-only, used by chemical SDS)', () => {
  const pdfOnly = {
    acceptedMimes: new Set(['application/pdf']),
    acceptedExts:  new Set(['pdf']),
  }

  it('accepts a PDF', () => {
    expect(validateDroppedFile(makeFile({ name: 'sds.pdf', type: 'application/pdf' }), pdfOnly).ok).toBe(true)
  })

  it('rejects markdown when the caller restricts to PDF', () => {
    const r = validateDroppedFile(makeFile({ name: 'note.md', type: 'text/markdown' }), pdfOnly)
    expect(r.ok).toBe(false)
  })
})

describe('validateDroppedFile (custom maxBytes)', () => {
  it('honours a smaller cap', () => {
    const r = validateDroppedFile(
      makeFile({ name: 's.pdf', type: 'application/pdf', size: 6 * 1024 * 1024 }),
      { maxBytes: 5 * 1024 * 1024 },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/5 MB cap/)
  })
})

describe('formatBytes', () => {
  it('formats bytes', () => { expect(formatBytes(512)).toBe('512 B') })
  it('formats KB', () => { expect(formatBytes(2048)).toBe('2.0 KB') })
  it('formats MB', () => { expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB') })
})
