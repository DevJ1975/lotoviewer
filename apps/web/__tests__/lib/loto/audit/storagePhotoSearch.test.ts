// findExistingIsoPhoto searches the tenant's OWN loto-photos folder for a real
// isolation photo before the audit falls back to the watermarked web
// placeholder. The behaviors that carry consequences:
//   1. A high-confidence vision match returns that candidate's public URL +
//      storage key (so it can land as a verified field photo, no watermark).
//   2. No matching candidate → null (the caller then tries the web placeholder).
//   3. The current (known-bad) iso photo is excluded by filename — it is never
//      re-proposed, even if it sits in the same folder.
//   4. ANY storage error (e.g. a failed list) degrades to null without throwing
//      into the audit engine.
//
// Seams mocked: the Supabase storage builder (list / download / getPublicUrl)
// and a stub Anthropic client. We assert on the vision verdict the model
// returns and on which storage key the match resolves to.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import type { IsoMatchResult } from '@/lib/loto/audit/schemas'
import { findExistingIsoPhoto } from '@/lib/loto/audit/storagePhotoSearch'

const TENANT = 'tenant-1'

const EQUIPMENT: Equipment = {
  equipment_id: 'EQ-001',
  description: 'Industrial dough mixer',
  department: 'Bakery',
  // The known-bad iso photo lives in this equipment's own folder; its basename
  // must be excluded from the candidate set.
  iso_photo_url: 'https://cdn.example/storage/v1/object/public/loto-photos/tenant-1/EQ-001/EQ-001_ISO_bad.jpg?v=9',
  equip_photo_url: 'https://cdn.example/storage/v1/object/public/loto-photos/tenant-1/EQ-001/EQ-001_EQUIP_1.jpg?v=1',
  decommissioned: false,
} as unknown as Equipment

const STEPS: LotoEnergyStep[] = []

// A real-ish list of objects in the equipment's folder: one good iso candidate,
// the known-bad iso photo (to be excluded), and the wide equip shot.
function listObjects() {
  return [
    { name: 'EQ-001_ISO_good.jpg' },
    { name: 'EQ-001_ISO_bad.jpg' },
    { name: 'EQ-001_EQUIP_1.jpg' },
    { name: 'EQ-001_placard.pdf' }, // non-jpg — must be ignored
  ]
}

// A 1x1 JPEG-ish blob; bytes don't matter because the vision call is mocked.
function fakeBlob() {
  return { arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff]).buffer, type: 'image/jpeg' }
}

function visionVerdict(verdict: IsoMatchResult) {
  return { content: [{ type: 'text', text: JSON.stringify(verdict) }], usage: null }
}

// Build a Supabase admin stub whose storage builder records list/download/
// getPublicUrl calls. Each test tweaks the list/download behavior.
function makeAdmin(opts: {
  list?: () => { data: Array<{ name: string }> | null; error: unknown }
  download?: (key: string) => { data: unknown; error: unknown }
}) {
  const list = vi.fn(async () => (opts.list ? opts.list() : { data: listObjects(), error: null }))
  const download = vi.fn(async (key: string) =>
    opts.download ? opts.download(key) : { data: fakeBlob(), error: null },
  )
  const getPublicUrl = vi.fn((key: string) => ({ data: { publicUrl: `https://cdn.example/${key}` } }))
  const admin = { storage: { from: () => ({ list, download, getPublicUrl }) } } as unknown as SupabaseClient
  return { admin, list, download, getPublicUrl }
}

const MATCH: IsoMatchResult = { is_isolation_point: true, confidence: 'high', notes: 'Clear disconnect.' }
const NO_MATCH: IsoMatchResult = { is_isolation_point: false, confidence: 'low', notes: 'Just a nameplate.' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findExistingIsoPhoto — match found', () => {
  it('returns the candidate URL + storage path when the vision call rates it isolation/high', async () => {
    const { admin, getPublicUrl } = makeAdmin({})
    // First candidate the model sees is the good iso photo → high-confidence match.
    const create = vi.fn(async () => visionVerdict(MATCH))
    const client = { messages: { create } } as unknown as Anthropic

    const result = await findExistingIsoPhoto(client, admin, TENANT, EQUIPMENT, STEPS)

    expect(result).toEqual({
      photoUrl: 'https://cdn.example/tenant-1/EQ-001/EQ-001_ISO_good.jpg',
      storagePath: 'tenant-1/EQ-001/EQ-001_ISO_good.jpg',
    })
    // It stopped at the first match — exactly one vision call, not one per file.
    expect(create).toHaveBeenCalledTimes(1)
    expect(getPublicUrl).toHaveBeenCalledWith('tenant-1/EQ-001/EQ-001_ISO_good.jpg')
  })
})

describe('findExistingIsoPhoto — no match', () => {
  it('returns null when no candidate is rated a high-confidence isolation point', async () => {
    const { admin } = makeAdmin({})
    const create = vi.fn(async () => visionVerdict(NO_MATCH))
    const client = { messages: { create } } as unknown as Anthropic

    const result = await findExistingIsoPhoto(client, admin, TENANT, EQUIPMENT, STEPS)

    expect(result).toBeNull()
  })

  it('treats a medium-confidence isolation point as not good enough (returns null)', async () => {
    const { admin } = makeAdmin({})
    const create = vi.fn(async () => visionVerdict({ is_isolation_point: true, confidence: 'medium', notes: 'Maybe.' }))
    const client = { messages: { create } } as unknown as Anthropic

    const result = await findExistingIsoPhoto(client, admin, TENANT, EQUIPMENT, STEPS)

    expect(result).toBeNull()
  })

  it('returns null without a vision call when the folder is empty', async () => {
    // Empty folder AND no equip photo → no candidates at all.
    const { admin } = makeAdmin({ list: () => ({ data: [], error: null }) })
    const create = vi.fn(async () => visionVerdict(MATCH))
    const client = { messages: { create } } as unknown as Anthropic
    const noEquipPhoto = { ...EQUIPMENT, equip_photo_url: null } as Equipment

    const result = await findExistingIsoPhoto(client, admin, TENANT, noEquipPhoto, STEPS)

    expect(result).toBeNull()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('findExistingIsoPhoto — excludes the current iso photo', () => {
  it('never downloads or proposes the known-bad iso photo', async () => {
    const { admin, download } = makeAdmin({})
    // Model would say "match" for anything — so if the bad photo were a
    // candidate, it could be wrongly returned. The exclusion must prevent that.
    const create = vi.fn(async () => visionVerdict(MATCH))
    const client = { messages: { create } } as unknown as Anthropic

    const result = await findExistingIsoPhoto(client, admin, TENANT, EQUIPMENT, STEPS)

    // It matched the good photo, and the bad one was never even downloaded.
    expect(result?.storagePath).toBe('tenant-1/EQ-001/EQ-001_ISO_good.jpg')
    const downloadedKeys = download.mock.calls.map(c => c[0])
    expect(downloadedKeys).not.toContain('tenant-1/EQ-001/EQ-001_ISO_bad.jpg')
  })
})

// EVASION — Fable 5 audit finding A-C3 (placeholder laundering).
//
// The candidate filter is `.endsWith('.jpg')` + "not the current iso photo". A
// watermarked placeholder written by a prior run lives in the SAME folder and is
// also a `.jpg` whose basename is NOT the current iso — so it is a candidate. If
// one Haiku vision call rates it a high-confidence isolation point, this function
// returns it as a field photo (no placeholder flag, provenance='field'), the 217
// trigger never fires, and a stand-in image laund­ers into a "verified" record.
//
// SAFE contract: a basename matching the `_ISO_PLACEHOLDER_` convention
// (storagePaths.placeholderIsoPhotoPath) must be excluded from candidates, no
// matter what the vision model says. `it.fails()` documents the open hole; it
// turns RED — delete `.fails` — the moment the exclusion lands.
describe('EVASION [A-C3] — a leftover placeholder must not launder into a field photo', () => {
  it.fails('never proposes an _ISO_PLACEHOLDER_ object even when the model rates it a match', async () => {
    // Folder holds only the known-bad iso (excluded) and a prior placeholder.
    const { admin } = makeAdmin({
      list: () => ({
        data: [
          { name: 'EQ-001_ISO_bad.jpg' },
          { name: 'EQ-001_ISO_PLACEHOLDER_1700000000000.jpg' },
        ],
        error: null,
      }),
    })
    // A maximally generous model: every image is a high-confidence isolation point.
    const create = vi.fn(async () => visionVerdict(MATCH))
    const client = { messages: { create } } as unknown as Anthropic
    // No equip photo, so the placeholder is the only candidate left.
    const eq = { ...EQUIPMENT, equip_photo_url: null } as Equipment

    const result = await findExistingIsoPhoto(client, admin, TENANT, eq, STEPS)

    expect(result).toBeNull() // SAFE contract. Current code returns the placeholder.
  })
})

describe('findExistingIsoPhoto — degrades to null on error', () => {
  it('returns null when the storage list call errors', async () => {
    const { admin } = makeAdmin({ list: () => ({ data: null, error: { message: 'boom' } }) })
    const create = vi.fn(async () => visionVerdict(MATCH))
    const client = { messages: { create } } as unknown as Anthropic

    const result = await findExistingIsoPhoto(client, admin, TENANT, EQUIPMENT, STEPS)

    expect(result).toBeNull()
    // A failed list means we never reached the vision call.
    expect(create).not.toHaveBeenCalled()
  })

  it('skips a candidate that fails to download and keeps checking the rest', async () => {
    // First candidate (good iso) fails to download; the wide equip shot then
    // matches. Proves a per-candidate download error is non-fatal.
    const { admin } = makeAdmin({
      download: (key: string) =>
        key === 'tenant-1/EQ-001/EQ-001_ISO_good.jpg'
          ? { data: null, error: { message: 'gone' } }
          : { data: fakeBlob(), error: null },
    })
    const create = vi.fn(async () => visionVerdict(MATCH))
    const client = { messages: { create } } as unknown as Anthropic

    const result = await findExistingIsoPhoto(client, admin, TENANT, EQUIPMENT, STEPS)

    expect(result?.storagePath).toBe('tenant-1/EQ-001/EQ-001_EQUIP_1.jpg')
  })
})
