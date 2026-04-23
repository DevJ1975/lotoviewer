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

const TEST_URL = 'https://cdn.example.com/photo.jpg'

function makeFile() {
  return new File(['img'], 'photo.jpg', { type: 'image/jpeg' })
}

function setupStorageMock(uploadError: Error | null = null) {
  const bucket = {
    upload:       vi.fn().mockResolvedValue({ error: uploadError }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: TEST_URL } }),
  }
  vi.mocked(supabase.storage.from).mockReturnValue(bucket as ReturnType<typeof supabase.storage.from>)
  return bucket
}

function setupDbMock(selectError: Error | null = null, updateError: Error | null = null) {
  vi.mocked(supabase.from)
    // 1. Initial SELECT for current URLs
    .mockImplementationOnce(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: selectError ? null : { equip_photo_url: null, iso_photo_url: null },
            error: selectError,
          }),
        }),
      }),
    } as unknown as ReturnType<typeof supabase.from>))
    // 2. UPDATE with new URL + status
    .mockImplementationOnce(() => ({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: updateError }),
      }),
    } as unknown as ReturnType<typeof supabase.from>))
    // 3. Reconcile SELECT after patch (returns matching state so no extra write)
    .mockImplementation(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { equip_photo_url: null, iso_photo_url: null, photo_status: 'missing' },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
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
    vi.mocked(supabase.storage.from).mockReturnValue(bucket as ReturnType<typeof supabase.storage.from>)
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
