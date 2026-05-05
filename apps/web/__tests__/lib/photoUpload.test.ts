import { vi, describe, it, expect, beforeEach } from 'vitest'
import { uploadPhotoForEquipment } from '@soteria/core/photoUpload'
import { supabase } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

const TEST_URL       = 'https://cdn.example.com/photo.jpg'
const TEST_TENANT_ID = '00000000-0000-0000-0000-0000000aabbb'

function setupStorage(uploadError: Error | null = null) {
  const bucket = {
    upload:       vi.fn().mockResolvedValue({ error: uploadError }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: TEST_URL } }),
  }
  vi.mocked(supabase.storage.from).mockReturnValue(bucket as unknown as ReturnType<typeof supabase.storage.from>)
  return bucket
}

// Build a chained `from('loto_equipment').select(...).eq(...).single()` /
// `.update(...).eq(...)` thenable so the helper's three DB round-trips can
// be controlled per-call. The third call is the reconcile re-SELECT; an
// optional 4th update is the reconcile write.
function setupDb(opts: {
  initialSelect?: { data: unknown; error: Error | null }
  update?:        { error: Error | null }
  reconcileSelect?: { data: unknown }
  // When the reconcile would write, we capture it here so the test can
  // assert what new photo_status was reconciled to.
  onReconcileUpdate?: (payload: Record<string, unknown>) => void
}) {
  const initialSelect = opts.initialSelect ?? {
    data: { equip_photo_url: null, iso_photo_url: null, needs_equip_photo: true, needs_iso_photo: true },
    error: null,
  }
  const update = opts.update ?? { error: null }
  const reconcileSelect = opts.reconcileSelect ?? {
    data: { equip_photo_url: TEST_URL, iso_photo_url: null, photo_status: 'partial', needs_equip_photo: true, needs_iso_photo: true },
  }

  const reconcileUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const reconcileUpdate = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
    opts.onReconcileUpdate?.(payload)
    return { eq: reconcileUpdateEq }
  })

  vi.mocked(supabase.from)
    // 1. SELECT current URLs
    .mockImplementationOnce(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue(initialSelect),
        }),
      }),
    } as unknown as ReturnType<typeof supabase.from>))
    // 2. UPDATE with new URL + status
    .mockImplementationOnce(() => ({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue(update),
      }),
    } as unknown as ReturnType<typeof supabase.from>))
    // 3. Reconcile SELECT (and optional 4th reconcile UPDATE on the same chain)
    .mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: reconcileSelect.data, error: null }),
        }),
      }),
      update: reconcileUpdate,
    } as unknown as ReturnType<typeof supabase.from>))

  return { reconcileUpdate, reconcileUpdateEq }
}

function makeBlob() {
  return new Blob(['img'], { type: 'image/jpeg' })
}

describe('uploadPhotoForEquipment', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── Storage path safety ───────────────────────────────────────────────────

  it('sanitises the equipment id in BOTH folder and filename', async () => {
    // Equipment IDs from CSV imports historically contained '/' and '#'.
    // Without sanitising both segments, the storage path could escape its
    // intended folder (the live-upload code path used to put the unsanitised
    // id in the filename — this test pins the fix).
    const bucket = setupStorage()
    setupDb({})

    await uploadPhotoForEquipment({
      equipmentId: 'EQ/01#bad',
      type:        'EQUIP',
      blob:        makeBlob(),
      tenantId:    TEST_TENANT_ID,
    })

    const path = bucket.upload.mock.calls[0][0] as string
    // Phase 5: path is now <tenant_uuid>/<sanitized_id>/<sanitized_id>_<type>_<ts>.jpg
    const segments = path.split('/')
    expect(segments).toHaveLength(3)
    expect(segments[0]).toBe(TEST_TENANT_ID)
    expect(segments[1]).toBe('EQ_01_bad')
    expect(segments[2]).toMatch(/^EQ_01_bad_EQUIP_\d+\.jpg$/)
  })

  it('rejects when tenantId is missing', async () => {
    setupStorage()
    setupDb({})

    await expect(uploadPhotoForEquipment({
      equipmentId: 'EQ-001',
      type:        'EQUIP',
      blob:        makeBlob(),
      // @ts-expect-error — intentionally missing tenantId
      tenantId:    undefined,
    })).rejects.toThrow(/tenantId is required/)
  })

  // ── Reconcile branch ──────────────────────────────────────────────────────

  it('writes a reconcile UPDATE when photo_status drifted from the actual URLs', async () => {
    // Scenario: a concurrent upload (queue drain) wrote between our SELECT
    // and UPDATE. The reconcile re-read shows photo_status=partial but both
    // URL columns are populated → status should be corrected to complete.
    setupStorage()
    let reconciledTo: unknown = undefined
    setupDb({
      reconcileSelect: {
        data: {
          equip_photo_url:    TEST_URL,
          iso_photo_url:      'https://cdn.example.com/other.jpg',
          photo_status:       'partial',                  // stale!
          needs_equip_photo:  true,
          needs_iso_photo:    true,
        },
      },
      onReconcileUpdate: (payload) => { reconciledTo = payload.photo_status },
    })

    await uploadPhotoForEquipment({
      equipmentId: 'EQ-001',
      type:        'EQUIP',
      blob:        makeBlob(),
      tenantId:    TEST_TENANT_ID,
    })

    expect(reconciledTo).toBe('complete')
  })

  it('does NOT write a reconcile UPDATE when photo_status already matches', async () => {
    setupStorage()
    const onReconcileUpdate = vi.fn()
    setupDb({
      reconcileSelect: {
        // photo_status agrees with the URL state — no reconcile needed.
        data: {
          equip_photo_url:    TEST_URL,
          iso_photo_url:      null,
          photo_status:       'partial',
          needs_equip_photo:  true,
          needs_iso_photo:    true,
        },
      },
      onReconcileUpdate,
    })

    await uploadPhotoForEquipment({
      equipmentId: 'EQ-001',
      type:        'EQUIP',
      blob:        makeBlob(),
      tenantId:    TEST_TENANT_ID,
    })

    expect(onReconcileUpdate).not.toHaveBeenCalled()
  })

  // ── Error propagation ─────────────────────────────────────────────────────

  it('throws when storage upload fails (no retry mode)', async () => {
    setupStorage(new Error('Network down'))
    setupDb({})

    await expect(uploadPhotoForEquipment({
      equipmentId: 'EQ-001',
      type:        'EQUIP',
      blob:        makeBlob(),
      tenantId:    TEST_TENANT_ID,
      retry:       false,
    })).rejects.toThrow('Network down')
  })

  it('throws when the post-upload SELECT fails', async () => {
    setupStorage()
    setupDb({
      initialSelect: { data: null, error: new Error('DB unavailable') },
    })

    await expect(uploadPhotoForEquipment({
      equipmentId: 'EQ-001',
      type:        'EQUIP',
      blob:        makeBlob(),
      tenantId:    TEST_TENANT_ID,
    })).rejects.toThrow('DB unavailable')
  })

  it('throws when the UPDATE fails', async () => {
    setupStorage()
    setupDb({
      update: { error: new Error('Connection refused') },
    })

    await expect(uploadPhotoForEquipment({
      equipmentId: 'EQ-001',
      type:        'EQUIP',
      blob:        makeBlob(),
      tenantId:    TEST_TENANT_ID,
    })).rejects.toThrow('Connection refused')
  })
})
