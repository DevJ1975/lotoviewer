import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { usePhotoUpload } from '@/hooks/usePhotoUpload'
import { supabase } from '@/lib/supabase'

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

// Phase 5+ requires tenantId from useTenant. Tests don't exercise the
// real provider — mock with a stable demo tenant id so storage paths
// get a valid first segment.
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => ({ tenantId: '00000000-0000-0000-0000-0000000aabbb' }),
}))

const TEST_URL = 'https://cdn.example.com/photo.jpg'

function makeFile() {
  return new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
}

function setupStorageMock(uploadError: Error | null = null) {
  const bucket = {
    upload:       vi.fn().mockResolvedValue({ error: uploadError }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: TEST_URL } }),
  }
  vi.mocked(supabase.storage.from).mockReturnValue(bucket as unknown as ReturnType<typeof supabase.storage.from>)
  return bucket
}

function setupDbMock(selectError: Error | null = null, updateError: Error | null = null) {
  // The uploadPhotoForEquipment pipeline makes three DB round-trips, each
  // with TWO .eq() calls (one for tenant_id, one for equipment_id):
  //   1. SELECT equip_photo_url, iso_photo_url, needs_equip_photo, needs_iso_photo
  //   2. UPDATE { url field, has field, photo_status, updated_at }
  //   3. Reconcile SELECT (same columns + photo_status)
  //   4. (conditional) Reconcile UPDATE — only when photo_status drifted
  const makeSelectChain = (data: unknown, error: Error | null) => {
    const innerEq = vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data, error }) })
    const outerEq = vi.fn().mockReturnValue({ eq: innerEq })
    return { select: vi.fn().mockReturnValue({ eq: outerEq }) }
  }

  const makeUpdateChain = (error: Error | null) => {
    const innerEq = vi.fn().mockResolvedValue({ error })
    const outerEq = vi.fn().mockReturnValue({ eq: innerEq })
    return { update: vi.fn().mockReturnValue({ eq: outerEq }) }
  }

  vi.mocked(supabase.from)
    // 1. Initial SELECT for current URLs (needs_* columns required by computePhotoStatusFromUrls)
    .mockImplementationOnce(() => makeSelectChain(
      selectError ? null : { equip_photo_url: null, iso_photo_url: null, needs_equip_photo: true, needs_iso_photo: true },
      selectError,
    ) as unknown as ReturnType<typeof supabase.from>)
    // 2. UPDATE with new URL + status
    .mockImplementationOnce(() => makeUpdateChain(updateError) as unknown as ReturnType<typeof supabase.from>)
    // 3. Reconcile SELECT after patch (photo_status matches computed value → no extra write)
    .mockImplementation(() => ({
      ...makeSelectChain(
        { equip_photo_url: null, iso_photo_url: null, photo_status: 'missing', needs_equip_photo: true, needs_iso_photo: true },
        null,
      ),
      ...makeUpdateChain(null),
    } as unknown as ReturnType<typeof supabase.from>))
}

// Helper: run upload and flush all retry delays instantly via fake timers
async function runUpload(upload: (f: File) => Promise<string | null>) {
  let result!: string | null
  await act(async () => {
    const p = upload(makeFile())
    await vi.runAllTimersAsync()
    result = await p
  })
  return result
}

describe('usePhotoUpload', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts in idle state', () => {
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))
    expect(result.current.status).toBe('idle')
    expect(result.current.url).toBeNull()
    expect(result.current.errorMsg).toBeNull()
  })

  // ── Happy path ────────────────────────────────────────────────────────────

  it('transitions to success on happy path', async () => {
    setupStorageMock()
    setupDbMock()
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)

    expect(result.current.status).toBe('success')
    expect(result.current.url).toBe(TEST_URL)
    expect(result.current.errorMsg).toBeNull()
  })

  it('returns the public URL on success', async () => {
    setupStorageMock()
    setupDbMock()
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    const returned = await runUpload(result.current.upload)

    expect(returned).toBe(TEST_URL)
  })

  // ── Offline / network failure simulations ────────────────────────────────

  it('enters error state when storage upload fails after retries (network offline)', async () => {
    setupStorageMock(new Error('Failed to fetch'))
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)

    expect(result.current.status).toBe('error')
    expect(result.current.errorMsg).toBe('Failed to fetch')
    expect(result.current.url).toBeNull()
  })

  it('retries the storage upload 3 times before giving up', async () => {
    const bucket = setupStorageMock(new Error('Failed to fetch'))
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)

    // 1 initial attempt + 3 retries = 4 total calls
    expect(bucket.upload).toHaveBeenCalledTimes(4)
  })

  it('enters error state when storage upload times out', async () => {
    setupStorageMock(new Error('Request timed out'))
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)

    expect(result.current.status).toBe('error')
    expect(result.current.errorMsg).toBe('Request timed out')
  })

  it('succeeds on retry if first upload attempt fails', async () => {
    // Fail once then succeed
    const bucket = {
      upload: vi.fn()
        .mockResolvedValueOnce({ error: new Error('Transient error') })
        .mockResolvedValue({ error: null }),
      getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: TEST_URL } }),
    }
    vi.mocked(supabase.storage.from).mockReturnValue(bucket as unknown as ReturnType<typeof supabase.storage.from>)
    setupDbMock()
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)

    expect(result.current.status).toBe('success')
    expect(bucket.upload).toHaveBeenCalledTimes(2) // failed once, succeeded once
  })

  it('enters error state when DB patch fails after successful upload (partial failure)', async () => {
    setupStorageMock()
    setupDbMock(null, new Error('Connection refused'))
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)

    expect(result.current.status).toBe('error')
    expect(result.current.errorMsg).toBe('Connection refused')
  })

  it('enters error state when DB select fails before patch', async () => {
    setupStorageMock()
    setupDbMock(new Error('DB unavailable'))
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)

    expect(result.current.status).toBe('error')
  })

  it('returns null on failure', async () => {
    setupStorageMock(new Error('Failed to fetch'))
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    const returned = await runUpload(result.current.upload)

    expect(returned).toBeNull()
  })

  // ── Reset ─────────────────────────────────────────────────────────────────

  it('reset clears error state back to idle', async () => {
    setupStorageMock(new Error('Offline'))
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)
    expect(result.current.status).toBe('error')

    act(() => { result.current.reset() })

    expect(result.current.status).toBe('idle')
    expect(result.current.errorMsg).toBeNull()
    expect(result.current.url).toBeNull()
  })

  it('reset clears success state', async () => {
    setupStorageMock()
    setupDbMock()
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'EQUIP'))

    await runUpload(result.current.upload)
    expect(result.current.status).toBe('success')

    act(() => { result.current.reset() })

    expect(result.current.status).toBe('idle')
    expect(result.current.url).toBeNull()
  })

  // ── ISO type ──────────────────────────────────────────────────────────────

  it('uses ISO type correctly in storage path', async () => {
    const bucket = setupStorageMock()
    setupDbMock()
    const { result } = renderHook(() => usePhotoUpload('EQ-001', 'ISO'))

    await runUpload(result.current.upload)

    const uploadPath = bucket.upload.mock.calls[0][0] as string
    expect(uploadPath).toMatch(/ISO/)
  })
})
