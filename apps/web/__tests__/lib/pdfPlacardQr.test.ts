/**
 * Placard QR code: each generated placard carries a QR to its read-only
 * public view (/qr/{qr_token}). These tests pin the URL contract and that
 * embedding the QR (a) grows the PDF, (b) never breaks placard generation
 * when the token is missing. The QR is an image, so its URL does not appear
 * as PDF text — we assert via byte-size delta + no-throw (same approach as
 * pdfPlacardAnnotations.test.ts).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import QRCode from 'qrcode'
import { generatePlacardPdf, placardQrUrl } from '@/lib/pdfPlacard'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'

// Valid PNG bytes for the tenant-logo tests — reuse qrcode's PNG output so we
// don't hand-roll a PNG header. (The real path converts a WebP logo to PNG.)
async function samplePngBytes(): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL('logo-fixture', { width: 64, margin: 0 })
  return new Uint8Array(Buffer.from(dataUrl.split(',')[1], 'base64'))
}

function makeEquipment(partial: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id:       'EQ-QR',
    description:        'Test equipment',
    department:         'Packaging',
    prefix:             null,
    photo_status:       'missing',
    has_equip_photo:    false,
    has_iso_photo:      false,
    equip_photo_url:    null,
    iso_photo_url:      null,
    placard_url:        null,
    signed_placard_url: null,
    notes:              'Stay clear',
    notes_es:           null,
    internal_notes:     null,
    spanish_reviewed:   true,
    verified:           false,
    verified_date:      null,
    verified_by:        null,
    needs_equip_photo:  true,
    needs_iso_photo:    true,
    needs_verification: false,
    decommissioned:     false,
    annotations:        [],
    iso_annotations:    [],
    created_at:         '2026-01-01T00:00:00Z',
    updated_at:         '2026-04-01T00:00:00Z',
    ...partial,
  }
}

const steps: LotoEnergyStep[] = [{
  id: 's-1', equipment_id: 'EQ-QR', energy_type: 'E', step_number: 1,
  tag_description: 'Open the breaker', isolation_procedure: 'Lock the breaker',
  method_of_verification: 'Test for voltage',
  tag_description_es: null, isolation_procedure_es: null, method_of_verification_es: null,
  step_type: 'isolate', sequence_order: 1, tryout_required: false,
}]

describe('placardQrUrl', () => {
  const ORIG = process.env.NEXT_PUBLIC_APP_URL
  afterEach(() => { process.env.NEXT_PUBLIC_APP_URL = ORIG })

  it('returns null when there is no token', () => {
    expect(placardQrUrl(null)).toBeNull()
    expect(placardQrUrl(undefined)).toBeNull()
    expect(placardQrUrl('')).toBeNull()
  })

  it('builds /qr/{token} on the configured base, stripping a trailing slash', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.com/'
    expect(placardQrUrl('0540373d75a3436e')).toBe('https://example.com/qr/0540373d75a3436e')
  })

  it('falls back to the production host when the env var is unset', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(placardQrUrl('abc123')).toBe('https://soteriafield.app/qr/abc123')
  })
})

describe('generatePlacardPdf — QR embed', () => {
  it('embeds the QR (PDF grows) when a qr_token is present, still 2 pages', async () => {
    const withQr    = await generatePlacardPdf({ equipment: makeEquipment({ qr_token: '0540373d75a3436e' }), steps })
    const withoutQr = await generatePlacardPdf({ equipment: makeEquipment({ qr_token: null }), steps })

    expect(withQr).toBeInstanceOf(Uint8Array)
    expect(withQr.byteLength).toBeGreaterThan(withoutQr.byteLength)

    const doc = await PDFDocument.load(withQr)
    expect(doc.getPageCount()).toBe(2) // EN + ES, both carry the QR
  })

  it('renders without crashing when the token is absent / empty / null', async () => {
    for (const qr_token of [undefined, '', null] as const) {
      const bytes = await generatePlacardPdf({ equipment: makeEquipment({ qr_token }), steps })
      expect(bytes.byteLength).toBeGreaterThan(1000)
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
    }
  })
})

describe('generatePlacardPdf — tenant logo', () => {
  it('embeds the logo (PDF grows) when given valid PNG bytes, still 2 pages', async () => {
    const png = await samplePngBytes()
    const withLogo    = await generatePlacardPdf({ equipment: makeEquipment(), steps, tenantLogoPng: png })
    const withoutLogo = await generatePlacardPdf({ equipment: makeEquipment(), steps, tenantLogoPng: null })
    expect(withLogo.byteLength).toBeGreaterThan(withoutLogo.byteLength)
    expect((await PDFDocument.load(withLogo)).getPageCount()).toBe(2)
  })

  it('falls back to the SL badge (no crash) on null / empty / undecodable bytes', async () => {
    for (const tenantLogoPng of [null, new Uint8Array(0), new Uint8Array([1, 2, 3, 4])]) {
      const bytes = await generatePlacardPdf({ equipment: makeEquipment(), steps, tenantLogoPng })
      expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2)
    }
  })
})
