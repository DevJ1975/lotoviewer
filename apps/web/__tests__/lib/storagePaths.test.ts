import { describe, it, expect } from 'vitest'
import { hotWorkPhotoPath, sanitizeId } from '@soteria/core/storagePaths'

const TENANT = '00000000-0000-0000-0000-000000000001'

describe('hotWorkPhotoPath', () => {
  it('builds <tenant>/hot-work/<permit>/<ts>.jpg with the tenant UUID first', () => {
    const path = hotWorkPhotoPath(TENANT, 'permit-123', 1_700_000_000_000)
    expect(path).toBe(`${TENANT}/hot-work/permit-123/1700000000000.jpg`)
    // Storage RLS (migration 033) requires the first segment to be the tenant UUID.
    expect(path.split('/')[0]).toBe(TENANT)
  })

  it('uses the provided timestamp so concurrent uploads do not collide', () => {
    const a = hotWorkPhotoPath(TENANT, 'p', 1)
    const b = hotWorkPhotoPath(TENANT, 'p', 2)
    expect(a).not.toBe(b)
    expect(a.endsWith('/1.jpg')).toBe(true)
    expect(b.endsWith('/2.jpg')).toBe(true)
  })

  it('sanitizes unsafe characters in the permit id', () => {
    const path = hotWorkPhotoPath(TENANT, 'a/b#c d', 5)
    expect(path).toBe(`${TENANT}/hot-work/a_b_c_d/5.jpg`)
    expect(sanitizeId('a/b#c d')).toBe('a_b_c_d')
  })
})
