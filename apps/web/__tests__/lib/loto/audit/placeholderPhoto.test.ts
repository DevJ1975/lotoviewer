// Two seams under test:
//   1. watermarkReferenceImage — the deterministic, safety-relevant transform
//      that stamps "REFERENCE ONLY" onto a sourced image. It runs real `sharp`,
//      so we feed it a tiny synthetic image and assert it yields a valid JPEG.
//   2. buildPlaceholderPhoto — best-effort orchestration that returns null on
//      ANY failure. We assert the "model found no URL" path returns null
//      WITHOUT touching storage (the model replying exactly 'NONE').

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Equipment } from '@soteria/core/types'
import sharp from 'sharp'
import { watermarkReferenceImage, buildPlaceholderPhoto } from '@/lib/loto/audit/placeholderPhoto'

// A small but real PNG so sharp has actual pixels to rotate, band, and re-encode.
async function tinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 120, g: 120, b: 120 } },
  }).png().toBuffer()
}

const EQUIPMENT: Equipment = {
  equipment_id: 'EQ-001',
  description: 'Industrial dough mixer',
  department: 'Bakery',
  manufacturer: 'Hobart',
  model: 'HL800',
  equip_photo_url: 'https://cdn.example/eq.jpg',
  iso_photo_url: null,
  decommissioned: false,
} as unknown as Equipment

describe('watermarkReferenceImage', () => {
  it('returns a non-empty JPEG buffer for a valid input image', async () => {
    const out = await watermarkReferenceImage(await tinyPng())

    expect(out.byteLength).toBeGreaterThan(0)
    // JPEG SOI marker (FF D8) — proves it re-encoded to JPEG, not passthrough PNG.
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)

    // The output is a decodable image whose dimensions survive the overlay.
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width).toBe(320)
    expect(meta.height).toBe(240)
  })
})

describe('buildPlaceholderPhoto — no reference image found', () => {
  // Storage stub: if buildPlaceholderPhoto reaches it, the test must fail —
  // a 'NONE' web-search result should short-circuit before any upload.
  const upload = vi.fn(async () => ({ error: null }))
  const getPublicUrl = vi.fn(() => ({ data: { publicUrl: 'https://cdn.example/x.jpg' } }))
  const admin = {
    storage: { from: () => ({ upload, getPublicUrl }) },
  } as unknown as SupabaseClient

  // Anthropic stub whose web-search turn replies exactly "NONE".
  const messagesCreate = vi.fn(async () => ({
    content: [{ type: 'text', text: 'NONE' }],
    stop_reason: 'end_turn',
  }))
  const client = { messages: { create: messagesCreate } } as unknown as Anthropic

  beforeEach(() => {
    upload.mockClear()
    getPublicUrl.mockClear()
    messagesCreate.mockClear()
  })

  it('returns null and never uploads when the model finds no URL', async () => {
    const result = await buildPlaceholderPhoto(client, admin, 'tenant-1', EQUIPMENT)

    expect(result).toBeNull()
    expect(messagesCreate).toHaveBeenCalledTimes(1)
    // No reference URL means no fetch, no watermark, and crucially no upload.
    expect(upload).not.toHaveBeenCalled()
  })

  it('returns null when the model output contains no image-file URL', async () => {
    // A prose answer with a non-image URL — the parser requires a direct image link.
    messagesCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'See the product page at https://example.com/hl800-specs' }],
      stop_reason: 'end_turn',
    } as never)

    const result = await buildPlaceholderPhoto(client, admin, 'tenant-1', EQUIPMENT)

    expect(result).toBeNull()
    expect(upload).not.toHaveBeenCalled()
  })
})
