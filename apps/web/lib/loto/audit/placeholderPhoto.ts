// Low-confidence ISO point → watermarked reference placeholder.
//
// When the audit can't confirm a real isolation point, it attaches a
// manufacturer/reference image as a STAND-IN so the placard isn't blank — but
// the image is watermarked "REFERENCE ONLY" and the apply RPC flags it so it
// can never read as a verified isolation point (migration 217 trigger).
//
// Everything here is best-effort and degrades to null: web_search/web_fetch
// availability depends on the environment network policy, and not every machine
// has a findable reference image. A null return tells the caller to stage a
// "needs a real ISO photo" provenance change instead of attaching an image.

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Equipment } from '@soteria/core/types'
import { placeholderIsoPhotoPath } from '@soteria/core/storagePaths'

const BUCKET = 'loto-photos'
const WATERMARK_TEXT = 'REFERENCE ONLY — NOT A VERIFIED ISOLATION POINT'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_CONTINUATIONS = 3

export interface PlaceholderResult {
  storagePath: string
  photoUrl:    string
  sourceUrl:   string
}

// Single web_search/web_fetch call asking for ONE direct image URL. Web search
// returns citations, which can't be combined with structured output (see
// lib/ai/discoverSds), so we parse the URL out of the prose ourselves.
async function findReferenceImageUrl(
  client: Anthropic,
  equipment: Equipment,
): Promise<string | null> {
  const subject = [equipment.manufacturer, equipment.model, equipment.description]
    .filter(Boolean).join(' ') || equipment.description || equipment.equipment_id
  const query = [
    `Find a representative reference photo for this food-production machine: ${subject}.`,
    'Prefer the manufacturer product page or spec sheet, ideally a view that shows its main electrical disconnect / lockout point.',
    'Reply with ONLY the single best DIRECT image file URL (ending in .jpg, .jpeg, .png, or .webp). No other text. If you cannot find one, reply exactly "NONE".',
  ].join('\n')

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: query }]
  let response: Anthropic.Message | null = null
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      messages,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 4 },
        { type: 'web_fetch_20260209',  name: 'web_fetch',  max_uses: 4 },
      ],
    })
    if (response.stop_reason !== 'pause_turn') break
    messages.push({ role: 'assistant', content: response.content })
  }

  const text = (response?.content ?? [])
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text).join('\n')
  const match = text.match(/\bhttps?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i)
  return match ? match[0] : null
}

async function fetchImageBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    if (!ct.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_IMAGE_BYTES) return null
    return buf
  } catch {
    return null
  }
}

// Stamp the reference image with an unmissable band. Exported for unit testing
// (the watermark is the deterministic, safety-relevant part).
export async function watermarkReferenceImage(input: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  // Normalize orientation + format first so the SVG overlay matches the final
  // pixel dimensions.
  const normalized = await sharp(input).rotate().jpeg({ quality: 82 }).toBuffer()
  const meta = await sharp(normalized).metadata()
  const w = meta.width ?? 1200
  const h = meta.height ?? 900
  const bandH = Math.max(44, Math.round(h * 0.12))
  const fontSize = Math.max(16, Math.round(bandH * 0.40))
  const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="${h - bandH}" width="${w}" height="${bandH}" fill="#BF1414" fill-opacity="0.88"/>
    <text x="${w / 2}" y="${h - bandH / 2}" font-family="Helvetica, Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="#FFFFFF" text-anchor="middle" dominant-baseline="central">${WATERMARK_TEXT}</text>
  </svg>`
  return sharp(normalized)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer()
}

export async function buildPlaceholderPhoto(
  client: Anthropic,
  admin: SupabaseClient,
  tenantId: string,
  equipment: Equipment,
): Promise<PlaceholderResult | null> {
  try {
    const sourceUrl = await findReferenceImageUrl(client, equipment)
    if (!sourceUrl) return null

    const raw = await fetchImageBytes(sourceUrl)
    if (!raw) return null

    const watermarked = await watermarkReferenceImage(raw)

    const ts = Date.now()
    const path = placeholderIsoPhotoPath(tenantId, equipment.equipment_id, ts)
    const bucket = admin.storage.from(BUCKET)
    const { error } = await bucket.upload(path, watermarked, { contentType: 'image/jpeg', upsert: true })
    if (error) return null

    const { data: { publicUrl } } = bucket.getPublicUrl(path)
    return { storagePath: path, photoUrl: `${publicUrl}?v=${ts}`, sourceUrl }
  } catch {
    return null
  }
}
