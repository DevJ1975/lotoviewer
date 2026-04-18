import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useReviews } from '@/hooks/useReviews'
import { supabase } from '@/lib/supabase'
import type { LotoReview } from '@/lib/types'

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }))

const BASE_REVIEW: LotoReview = {
  id: 'r1', department: 'Electrical', reviewer_name: 'Jane Smith',
  reviewer_email: 'jane@example.com', signed_at: '2025-01-01T10:00:00Z',
  approved: true, notes: null, created_at: '2025-01-01T10:00:00Z',
}

function makeFetchChain(data: LotoReview[] | null, error: Error | null = null) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq     = vi.fn().mockReturnValue(chain)
  chain.order  = vi.fn().mockReturnValue(chain)
  chain.limit  = vi.fn().mockResolvedValue({ data, error })
  return chain
}

function makeSubmitChain(data: LotoReview | null, error: Error | null = null) {
  const chain: Record<string, unknown> = {}
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue({ data, error })
  return chain
}

describe('useReviews', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts with empty reviews and loading false', () => {
    vi.mocked(supabase.from).mockReturnValue(makeFetchChain([]) as ReturnType<typeof supabase.from>)
    const { result } = renderHook(() => useReviews('Electrical'))
    expect(result.current.reviews).toHaveLength(0)
    expect(result.current.loading).toBe(false)
  })

  // ── fetchReviews ──────────────────────────────────────────────────────────

  it('populates reviews after successful fetch', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      makeFetchChain([BASE_REVIEW]) as ReturnType<typeof supabase.from>
    )
    const { result } = renderHook(() => useReviews('Electrical'))

    await act(async () => { await result.current.fetchReviews() })

    expect(result.current.reviews).toHaveLength(1)
    expect(result.current.reviews[0].reviewer_name).toBe('Jane Smith')
    expect(result.current.loading).toBe(false)
  })

  it('leaves reviews empty when fetch returns null (offline / DB error)', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      makeFetchChain(null, new Error('Failed to fetch')) as ReturnType<typeof supabase.from>
    )
    const { result } = renderHook(() => useReviews('Electrical'))

    await act(async () => { await result.current.fetchReviews() })

    expect(result.current.reviews).toHaveLength(0)
    expect(result.current.loading).toBe(false)
  })

  it('sets loading true during fetch then false after', async () => {
    let resolveLimit!: (v: unknown) => void
    const pending = new Promise(res => { resolveLimit = res })
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn().mockReturnValue(chain)
    chain.eq     = vi.fn().mockReturnValue(chain)
    chain.order  = vi.fn().mockReturnValue(chain)
    chain.limit  = vi.fn().mockReturnValue(pending)
    vi.mocked(supabase.from).mockReturnValue(chain as ReturnType<typeof supabase.from>)

    const { result } = renderHook(() => useReviews('Electrical'))

    let fetchPromise!: Promise<void>
    act(() => { fetchPromise = result.current.fetchReviews() })

    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolveLimit({ data: [], error: null })
      await fetchPromise
    })

    expect(result.current.loading).toBe(false)
  })

  it('queries with the correct department', async () => {
    const chain = makeFetchChain([])
    vi.mocked(supabase.from).mockReturnValue(chain as ReturnType<typeof supabase.from>)

    const { result } = renderHook(() => useReviews('Maintenance'))
    await act(async () => { await result.current.fetchReviews() })

    expect(vi.mocked(chain.eq as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('department', 'Maintenance')
  })

  // ── submitReview ──────────────────────────────────────────────────────────

  it('prepends new review to list on successful submit', async () => {
    const existingReview = { ...BASE_REVIEW, id: 'r0', created_at: '2024-12-01T00:00:00Z' }
    vi.mocked(supabase.from)
      .mockImplementationOnce(() => makeFetchChain([existingReview]) as ReturnType<typeof supabase.from>)
      .mockImplementationOnce(() => makeSubmitChain(BASE_REVIEW) as ReturnType<typeof supabase.from>)

    const { result } = renderHook(() => useReviews('Electrical'))
    await act(async () => { await result.current.fetchReviews() })

    const payload = { reviewer_name: 'Jane Smith', reviewer_email: null, notes: null, approved: true }
    await act(async () => { await result.current.submitReview(payload) })

    expect(result.current.reviews).toHaveLength(2)
    expect(result.current.reviews[0].id).toBe('r1') // new one is first
  })

  it('returns null error on successful submit', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      makeSubmitChain(BASE_REVIEW) as ReturnType<typeof supabase.from>
    )
    const { result } = renderHook(() => useReviews('Electrical'))

    const payload = { reviewer_name: 'Jane', reviewer_email: null, notes: null, approved: true }
    let res!: { data: LotoReview | null; error: unknown }
    await act(async () => { res = await result.current.submitReview(payload) })

    expect(res.error).toBeNull()
    expect(res.data?.reviewer_name).toBe('Jane Smith')
  })

  it('returns error and does NOT update list when submit fails (offline simulation)', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      makeSubmitChain(null, new Error('Failed to fetch')) as ReturnType<typeof supabase.from>
    )
    const { result } = renderHook(() => useReviews('Electrical'))

    const payload = { reviewer_name: 'Jane', reviewer_email: null, notes: null, approved: true }
    let res!: { data: LotoReview | null; error: unknown }
    await act(async () => { res = await result.current.submitReview(payload) })

    expect((res.error as Error).message).toBe('Failed to fetch')
    expect(result.current.reviews).toHaveLength(0)
  })

  it('returns error when Supabase returns 503 (DB unavailable)', async () => {
    vi.mocked(supabase.from).mockReturnValue(
      makeSubmitChain(null, new Error('Service Unavailable')) as ReturnType<typeof supabase.from>
    )
    const { result } = renderHook(() => useReviews('Electrical'))

    const payload = { reviewer_name: 'Jane', reviewer_email: null, notes: null, approved: true }
    let res!: { error: unknown }
    await act(async () => { res = await result.current.submitReview(payload) })

    expect((res.error as Error).message).toBe('Service Unavailable')
  })

  it('does not modify reviews list on submit error (idempotent failure)', async () => {
    vi.mocked(supabase.from)
      .mockImplementationOnce(() => makeFetchChain([BASE_REVIEW]) as ReturnType<typeof supabase.from>)
      .mockImplementationOnce(() => makeSubmitChain(null, new Error('Network error')) as ReturnType<typeof supabase.from>)

    const { result } = renderHook(() => useReviews('Electrical'))
    await act(async () => { await result.current.fetchReviews() })
    expect(result.current.reviews).toHaveLength(1)

    const payload = { reviewer_name: 'Jane', reviewer_email: null, notes: null, approved: true }
    await act(async () => { await result.current.submitReview(payload) })

    // List should be unchanged after failure
    expect(result.current.reviews).toHaveLength(1)
  })
})
