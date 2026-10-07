import { describe, it, expect } from 'vitest'
import { buildEvidencePath, evidenceProblem, safeFileName } from '@/lib/environmental/evidence'

const TENANT = '11111111-1111-1111-1111-111111111111'

describe('safeFileName', () => {
  it('keeps an ordinary name and turns spaces into dashes', () => {
    expect(safeFileName('Outfall 001 sheen.JPG')).toBe('Outfall-001-sheen.JPG')
  })

  it('drops any folder part, however it is written', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('C:\\Users\\pat\\photo.png')).toBe('photo.png')
  })

  it('removes characters that do not belong in a path, and never starts with a dot', () => {
    expect(safeFileName('a?b*c<d>.pdf')).toBe('abcd.pdf')
    expect(safeFileName('.hidden')).toBe('hidden')
  })

  it('falls back to a name when nothing usable is left, and bounds the length keeping the extension', () => {
    expect(safeFileName('???')).toBe('file')
    const long = safeFileName(`${'a'.repeat(200)}.pdf`)
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith('.pdf')).toBe(true)
  })
})

describe('buildEvidencePath', () => {
  it('starts with the tenant folder, which the storage policy and the API both read', () => {
    expect(buildEvidencePath(TENANT, 'permits', 'abc', 'Permit.pdf')).toBe(`${TENANT}/permits/abc-Permit.pdf`)
  })

  it('cannot be steered out of its folder through the folder label or the file name', () => {
    const path = buildEvidencePath(TENANT, '../other', 'abc', '../../x.pdf')
    expect(path.startsWith(`${TENANT}/`)).toBe(true)
    expect(path).not.toContain('..')
    expect(path.split('/')).toHaveLength(3)
  })
})

describe('evidenceProblem', () => {
  it('accepts photos and PDFs up to 25 MB', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) expect(evidenceProblem({ size: 1000, type }), type).toBeNull()
    expect(evidenceProblem({ size: 25 * 1024 * 1024, type: 'application/pdf' })).toBeNull()
  })

  it('says why a file is refused', () => {
    expect(evidenceProblem({ size: 10, type: 'application/zip' })).toMatch(/JPEG, PNG or WebP/)
    expect(evidenceProblem({ size: 25 * 1024 * 1024 + 1, type: 'image/png' })).toMatch(/25 MB/)
    expect(evidenceProblem({ size: 0, type: 'image/png' })).toMatch(/empty/)
  })
})
