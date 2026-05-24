import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parsePhotoUrls } from '@/app/api/hazardous-waste/inspections/route'

// parsePhotoUrls is the trust boundary: photos arrive as client-supplied
// URLs, and only our own loto-photos public objects may be persisted to the
// CUPA binder. These specs lock that contract.

const BASE = 'https://proj.supabase.co'
const OK = `${BASE}/storage/v1/object/public/loto-photos/tenant/hazardous-waste/inspections/d/1.jpg`

beforeEach(() => { process.env.NEXT_PUBLIC_SUPABASE_URL = BASE })
afterEach(() => { delete process.env.NEXT_PUBLIC_SUPABASE_URL })

describe('parsePhotoUrls', () => {
  it('treats missing/empty as an empty list', () => {
    expect(parsePhotoUrls(undefined)).toEqual({ ok: true, urls: [] })
    expect(parsePhotoUrls(null)).toEqual({ ok: true, urls: [] })
    expect(parsePhotoUrls([])).toEqual({ ok: true, urls: [] })
  })

  it('accepts well-formed loto-photos storage URLs', () => {
    expect(parsePhotoUrls([OK])).toEqual({ ok: true, urls: [OK] })
  })

  it('rejects a non-array', () => {
    expect(parsePhotoUrls('nope').ok).toBe(false)
  })

  it('rejects external / non-storage URLs (no smuggling links into the binder)', () => {
    expect(parsePhotoUrls(['https://evil.com/x.jpg']).ok).toBe(false)
    expect(parsePhotoUrls([`${BASE}/storage/v1/object/public/other-bucket/x.jpg`]).ok).toBe(false)
    expect(parsePhotoUrls(['javascript:alert(1)']).ok).toBe(false)
  })

  it('rejects non-string entries and over-long URLs', () => {
    expect(parsePhotoUrls([123]).ok).toBe(false)
    expect(parsePhotoUrls([`${OK}${'x'.repeat(600)}`]).ok).toBe(false)
  })

  it('caps the photo count at 12', () => {
    expect(parsePhotoUrls(Array(13).fill(OK)).ok).toBe(false)
    expect(parsePhotoUrls(Array(12).fill(OK)).ok).toBe(true)
  })
})
