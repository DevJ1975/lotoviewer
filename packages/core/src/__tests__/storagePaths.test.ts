import { describe, it, expect } from 'vitest'
import { sanitizeId, em385DocumentPath } from '../storagePaths'

const TENANT = '11111111-1111-1111-1111-111111111111'

describe('sanitizeId', () => {
  it('replaces every char outside [A-Za-z0-9_-] with an underscore', () => {
    expect(sanitizeId('O₂')).toBe('O_')          // unicode subscript
    expect(sanitizeId('H₂S')).toBe('H_S')
    expect(sanitizeId('Plan—2024')).toBe('Plan_2024') // em-dash
    expect(sanitizeId('report.pdf')).toBe('report_pdf') // dots are not in the allowlist
    expect(sanitizeId('he said "hi"')).toBe('he_said__hi_')
  })

  it('neutralises path-traversal and control characters', () => {
    expect(sanitizeId('a/b#c d')).toBe('a_b_c_d')
    expect(sanitizeId('line1\nline2')).toBe('line1_line2')
    expect(sanitizeId('../../etc/passwd')).toBe('______etc_passwd')
  })

  it('preserves already-safe ids', () => {
    expect(sanitizeId('item-1_v2')).toBe('item-1_v2')
  })
})

describe('em385DocumentPath', () => {
  it('builds <tenant>/em385/<item>/<ts>_<file> with a fixed timestamp', () => {
    expect(em385DocumentPath(TENANT, 'item-1', 'report.pdf', 1700000000000))
      .toBe(`${TENANT}/em385/item-1/1700000000000_report_pdf`)
  })

  it('sanitises unicode in the file name (O₂, H₂S)', () => {
    expect(em385DocumentPath(TENANT, 'item-1', 'O₂ Plan.pdf', 1))
      .toBe(`${TENANT}/em385/item-1/1_O__Plan_pdf`)
  })

  it('always starts with the tenant prefix the migration-033 RLS requires', () => {
    const path = em385DocumentPath(TENANT, 'evil/../id', 'h@ck er.pdf', 1)
    expect(path.startsWith(`${TENANT}/em385/`)).toBe(true)
  })

  it('a slash- or newline-laden file name cannot add path segments', () => {
    const path = em385DocumentPath(TENANT, 'item', 'a/b/c.pdf', 1)
    expect(path).toBe(`${TENANT}/em385/item/1_a_b_c_pdf`)
    expect(path.split('/')).toHaveLength(4) // tenant, 'em385', item, file — no escape
    expect(em385DocumentPath(TENANT, 'item', 'p\nq.pdf', 1)).not.toContain('\n')
  })
})
