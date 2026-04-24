import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFormDraft } from '@/hooks/useFormDraft'

interface TestDraft {
  name:  string
  count: number
  flag:  boolean
}

const KEY = 'test:formDraft'
const DEFAULT: TestDraft = { name: '', count: 0, flag: false }

beforeEach(() => {
  sessionStorage.clear()
})

afterEach(() => {
  sessionStorage.clear()
})

describe('useFormDraft', () => {
  // ── Mount: restore semantics ────────────────────────────────────────────

  it('returns the initial value when no draft exists', () => {
    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))
    const [state, , , wasRestored] = result.current
    expect(state).toEqual(DEFAULT)
    expect(wasRestored).toBe(false)
  })

  it('restores a previously-saved draft on mount', () => {
    // Pre-seed sessionStorage as if a previous session had saved a draft.
    const saved: TestDraft = { name: 'Widget-01', count: 3, flag: true }
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, t: Date.now(), d: saved }))

    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))
    const [state, , , wasRestored] = result.current
    expect(state).toEqual(saved)
    expect(wasRestored).toBe(true)
  })

  it('ignores drafts older than maxAgeMs and returns the default', () => {
    const stale: TestDraft = { name: 'Ancient', count: 9, flag: true }
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, t: twoDaysAgo, d: stale }))

    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT, { maxAgeMs: 24 * 60 * 60 * 1000 }))
    const [state, , , wasRestored] = result.current
    expect(state).toEqual(DEFAULT)
    expect(wasRestored).toBe(false)
    // Stale draft is evicted from storage.
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('ignores drafts with an unknown version and returns the default', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 99, t: Date.now(), d: { name: 'future', count: 0, flag: false } }))
    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))
    expect(result.current[0]).toEqual(DEFAULT)
    expect(result.current[3]).toBe(false)
  })

  it('swallows malformed JSON and returns the default without throwing', () => {
    sessionStorage.setItem(KEY, '{this is not json')
    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))
    expect(result.current[0]).toEqual(DEFAULT)
  })

  // ── Setter: persists on every change ────────────────────────────────────

  it('persists the new state to sessionStorage on every setState call', () => {
    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))
    const [, setState] = result.current

    act(() => { setState({ name: 'A', count: 1, flag: false }) })

    const raw = sessionStorage.getItem(KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!)
    expect(parsed.v).toBe(1)
    expect(parsed.d).toEqual({ name: 'A', count: 1, flag: false })
    // Timestamp must be recent so the next restore doesn't expire it.
    expect(Date.now() - parsed.t).toBeLessThan(1000)
  })

  it('supports functional updates like useState', () => {
    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))

    act(() => { result.current[1]({ name: 'X', count: 1, flag: false }) })
    act(() => { result.current[1](prev => ({ ...prev, count: prev.count + 1 })) })

    expect(result.current[0]).toEqual({ name: 'X', count: 2, flag: false })
  })

  // ── clear() ─────────────────────────────────────────────────────────────

  it('clear() wipes sessionStorage and resets state to initial', () => {
    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))

    act(() => { result.current[1]({ name: 'X', count: 9, flag: true }) })
    expect(sessionStorage.getItem(KEY)).not.toBeNull()

    act(() => { result.current[2]() })

    expect(result.current[0]).toEqual(DEFAULT)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('wasRestored flips back to false after clear()', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ v: 1, t: Date.now(), d: { name: 'pre', count: 0, flag: false } }))
    const { result } = renderHook(() => useFormDraft<TestDraft>(KEY, DEFAULT))
    expect(result.current[3]).toBe(true)

    act(() => { result.current[2]() })

    expect(result.current[3]).toBe(false)
  })
})
