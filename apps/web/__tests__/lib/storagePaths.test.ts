import { describe, it, expect } from 'vitest'
import { hotWorkPhotoPath, hazWasteInspectionPhotoPath, hazWasteAreaPhotoPath, stagingReviewPhotoPath, sanitizeId } from '@soteria/core/storagePaths'

const TENANT = '00000000-0000-0000-0000-000000000001'
const REVIEW_LINK = '11111111-1111-1111-1111-111111111111'

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

describe('hazWasteInspectionPhotoPath', () => {
  it('builds <tenant>/hazardous-waste/inspections/<draft>/<ts>.jpg, tenant first', () => {
    const path = hazWasteInspectionPhotoPath(TENANT, 'draft-9', 1_700_000_000_000)
    expect(path).toBe(`${TENANT}/hazardous-waste/inspections/draft-9/1700000000000.jpg`)
    expect(path.split('/')[0]).toBe(TENANT)
  })

  it('sanitizes the draft id and varies by timestamp', () => {
    expect(hazWasteInspectionPhotoPath(TENANT, 'a/b', 1)).toBe(`${TENANT}/hazardous-waste/inspections/a_b/1.jpg`)
    expect(hazWasteInspectionPhotoPath(TENANT, 'x', 1)).not.toBe(hazWasteInspectionPhotoPath(TENANT, 'x', 2))
  })
})

describe('hazWasteAreaPhotoPath', () => {
  it('builds <tenant>/hazardous-waste/areas/<area>/<ts>.jpg, tenant first', () => {
    const path = hazWasteAreaPhotoPath(TENANT, 'area-7', 1_700_000_000_000)
    expect(path).toBe(`${TENANT}/hazardous-waste/areas/area-7/1700000000000.jpg`)
    expect(path.split('/')[0]).toBe(TENANT)
  })

  it('sanitizes the area id and varies by timestamp', () => {
    expect(hazWasteAreaPhotoPath(TENANT, 'a/b', 1)).toBe(`${TENANT}/hazardous-waste/areas/a_b/1.jpg`)
    expect(hazWasteAreaPhotoPath(TENANT, 'x', 1)).not.toBe(hazWasteAreaPhotoPath(TENANT, 'x', 2))
  })
})

describe('stagingReviewPhotoPath', () => {
  it('parks the upload under staging/<review_link>/<equipment>/<slot>-<ts>.jpg', () => {
    const path = stagingReviewPhotoPath(REVIEW_LINK, 'SKPF-210', 'ISO', 1_700_000_000_000)
    expect(path).toBe(`staging/${REVIEW_LINK}/SKPF-210/ISO-1700000000000.jpg`)
    // Deliberately NOT tenant-first: it is a service-role-only staging area,
    // kept separate from the live equipmentPhotoPath until reconcile.
    expect(path.split('/')[0]).toBe('staging')
  })

  it('separates EQUIP and ISO slots and varies by timestamp', () => {
    expect(stagingReviewPhotoPath(REVIEW_LINK, 'EQ', 'EQUIP', 1)).toBe(`staging/${REVIEW_LINK}/EQ/EQUIP-1.jpg`)
    expect(stagingReviewPhotoPath(REVIEW_LINK, 'EQ', 'ISO', 1)).not.toBe(stagingReviewPhotoPath(REVIEW_LINK, 'EQ', 'EQUIP', 1))
    expect(stagingReviewPhotoPath(REVIEW_LINK, 'EQ', 'ISO', 1)).not.toBe(stagingReviewPhotoPath(REVIEW_LINK, 'EQ', 'ISO', 2))
  })

  it('sanitizes unsafe characters in the equipment id', () => {
    expect(stagingReviewPhotoPath(REVIEW_LINK, 'a/b#c', 'EQUIP', 5)).toBe(`staging/${REVIEW_LINK}/a_b_c/EQUIP-5.jpg`)
  })
})
