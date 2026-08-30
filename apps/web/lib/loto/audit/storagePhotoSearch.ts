// Search the tenant's OWN storage for a real isolation photo before falling
// back to the watermarked internet placeholder.
//
// Why this exists: the audit's findings show ISO photos are frequently
// cross-wired between equipment — one machine's record points at another
// machine's image — which means a CORRECT photo of *this* machine's isolation
// point often already sits in this tenant's `loto-photos` bucket (in this
// equipment's own folder, or as the wide equipment shot that happens to frame
// the disconnect). Proposing that real in-house photo is strictly better than a
// reference placeholder: it can land as a verified field photo, not a stand-in.
//
// Scope is deliberately narrow (YAGNI): only THIS equipment's folder plus its
// current equip_photo_url are searched — cross-equipment search across the
// whole tenant is out of scope. The current iso_photo_url is excluded because
// it is the known-bad image the audit just flagged.
//
// Everything here is best-effort and degrades to null on ANY error: storage is
// a system boundary and a vision call can fail, but neither must ever throw
// into the audit engine. A null return tells the caller to try the web
// placeholder next, exactly as before.

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import { sanitizeId } from '@soteria/core/storagePaths'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { FPE_SYSTEM, describeEquipment, describeSteps } from './prompts'
import type { FetchedImage } from './imageFetch'
import { ISO_MATCH_SCHEMA, type IsoMatchResult } from './schemas'

const BUCKET = 'loto-photos'
const MODEL = MODEL_BY_SURFACE['loto-audit-fpe']

// Bound cost: at most this many candidates get a vision call. The equipment's
// own folder rarely holds more than a couple of real photos, and each extra
// candidate is one more Sonnet vision request per audited machine.
const MAX_CANDIDATES = 4

export interface ExistingIsoPhotoMatch {
  photoUrl:    string
  storagePath: string
}

// The basename a public URL points at, ignoring the `?v=` cache-bust. Storage
// public URLs end in the object key, whose last segment is the filename that
// `.list()` reports as `name` — so comparing basenames is how we recognize the
// current (known-bad) iso photo among the listed objects.
function basenameFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname
    const last = path.split('/').pop()
    return last ? decodeURIComponent(last) : null
  } catch {
    return null
  }
}

// One candidate: a stored object we can fetch and ask the model about. We carry
// both the storage key (for download + getPublicUrl) and the filename (for the
// exclude-the-known-bad-iso comparison).
interface Candidate {
  key:  string
  name: string
}

// A prior run's watermarked placeholder (storagePaths.placeholderIsoPhotoPath
// writes `<id>_ISO_PLACEHOLDER_<ts>.jpg` into this SAME folder) must never be a
// candidate: a match here is staged as a VERIFIED field photo (provenance
// 'field', is_placeholder false), so one generous vision verdict would launder
// the stand-in past the migration-217 placeholder trigger (Fable 5 finding
// A-C3). Placard renders are excluded on the same principle — generated
// artifacts are not field evidence.
function isGeneratedArtifact(name: string): boolean {
  return /_ISO_PLACEHOLDER_/i.test(name) || /_placard\./i.test(name)
}

// Read a stored object as base64 for a vision block. Prefer a direct
// service-role download by key (the bucket is public for SELECT, but the key
// read is the most direct and avoids depending on the public-URL host); fall
// back to fetching the public URL via the proven fetchImageAsBase64 path.
async function fetchCandidateImage(
  admin: SupabaseClient,
  key: string,
): Promise<FetchedImage | null> {
  try {
    const { data, error } = await admin.storage.from(BUCKET).download(key)
    if (error || !data) return null
    const buf = Buffer.from(await data.arrayBuffer())
    if (buf.byteLength === 0) return null
    // Stored photos are re-encoded to JPEG on upload (lib/imageUtils); the
    // download blob's type is authoritative when present, else JPEG — the same
    // tolerance fetchImageAsBase64 documents for HEIC/unknown bytes.
    const ct = (data.type ?? '').toLowerCase()
    let mediaType: FetchedImage['mediaType'] = 'image/jpeg'
    if (ct.includes('png')) mediaType = 'image/png'
    else if (ct.includes('webp')) mediaType = 'image/webp'
    else if (ct.includes('gif')) mediaType = 'image/gif'
    return { base64: buf.toString('base64'), mediaType }
  } catch {
    return null
  }
}

// One vision call: does THIS image clearly show a real energy-isolation point
// consistent with the equipment and its energy steps? Mirrors the FPE agent's
// proven base64-image-block + json_schema structured-output call.
async function classifyCandidate(
  client: Anthropic,
  equipment: Equipment,
  steps: LotoEnergyStep[],
  image: FetchedImage,
): Promise<IsoMatchResult | null> {
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 600,
    thinking:   { type: 'disabled' },
    system:     [{ type: 'text', text: FPE_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages:   [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
        {
          type: 'text',
          text: [
            'One photo from this tenant\'s own storage is attached. Decide whether it clearly shows a REAL energy-isolation / lockout point for the equipment below — a disconnect, breaker, valve, or lockout device a worker would actually apply a lock and tag to. A nameplate, a wide shot with no visible disconnect, a marketing image, or an unrelated panel is NOT an isolation point.',
            '',
            describeEquipment(equipment),
            '',
            'Energy steps:',
            describeSteps(steps),
            '',
            'Set is_isolation_point true only if you can see a real isolation point that is plausibly THIS equipment\'s. Reply with JSON only per the schema.',
          ].join('\n'),
        },
      ],
    }],
    output_config: { format: { type: 'json_schema', schema: ISO_MATCH_SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') return null
  return JSON.parse(textBlock.text) as IsoMatchResult
}

export async function findExistingIsoPhoto(
  client: Anthropic,
  admin: SupabaseClient,
  tenantId: string,
  equipment: Equipment,
  steps: LotoEnergyStep[],
): Promise<ExistingIsoPhotoMatch | null> {
  try {
    const folder = `${tenantId}/${sanitizeId(equipment.equipment_id)}`
    const { data: objects, error } = await admin.storage.from(BUCKET).list(folder)
    if (error) return null

    // Exclude the known-bad iso photo by filename so we never re-propose it.
    const currentIsoName = equipment.iso_photo_url ? basenameFromUrl(equipment.iso_photo_url) : null
    const folderImages: Candidate[] = (objects ?? [])
      .filter(o => o.name.toLowerCase().endsWith('.jpg'))
      .filter(o => o.name !== currentIsoName)
      .filter(o => !isGeneratedArtifact(o.name))
      .map(o => ({ key: `${folder}/${o.name}`, name: o.name }))

    // Add the wide equipment shot as a candidate: it often frames the
    // disconnect even when no dedicated iso close-up exists. Skip it if it IS
    // the current iso photo (same key) so we don't recheck the known-bad one.
    const equipName = equipment.equip_photo_url ? basenameFromUrl(equipment.equip_photo_url) : null
    const equipAlreadyListed = equipName != null && folderImages.some(c => c.name === equipName)
    const equipIsCurrentIso = equipName != null && equipName === currentIsoName
    const candidates: Candidate[] =
      equipName && !equipAlreadyListed && !equipIsCurrentIso && !isGeneratedArtifact(equipName)
        ? [...folderImages, { key: `${folder}/${equipName}`, name: equipName }]
        : folderImages

    // Nothing to check — bail before spending a single vision call.
    if (candidates.length === 0) return null

    const bucket = admin.storage.from(BUCKET)
    for (const candidate of candidates.slice(0, MAX_CANDIDATES)) {
      const image = await fetchCandidateImage(admin, candidate.key)
      if (!image) continue

      const verdict = await classifyCandidate(client, equipment, steps, image)
      // Require high confidence: this photo can land as a VERIFIED field photo
      // (no watermark, no placeholder flag), so the bar to auto-propose it must
      // match the FPE agent's conservative "a worker's life depends on it"
      // posture — medium is not good enough to skip human-grade certainty here.
      if (!verdict || !verdict.is_isolation_point || verdict.confidence !== 'high') continue

      const { data: { publicUrl } } = bucket.getPublicUrl(candidate.key)
      return { photoUrl: publicUrl, storagePath: candidate.key }
    }

    return null
  } catch {
    return null
  }
}
