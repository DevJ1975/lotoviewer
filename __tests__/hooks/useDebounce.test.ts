import { renderHook, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useDebounce } from '@/hooks/useDebounce'

describe('useDebounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('returns the initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 300))
    expect(result.current).toBe('hello')
  })

  it('does not update value before delay elapses', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'a' },
    })
    rerender({ val: 'b' })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('a')
  })

  it('updates value after delay elapses', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'a' },
    })
    rerender({ val: 'b' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe('b')
  })

  it('only applies the last value when updated rapidly', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'a' },
    })
    rerender({ val: 'b' })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ val: 'c' })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ val: 'd' })
    act(() => { vi.advanceTimersByTime(300) })
    expect(result.current).toBe('d')
  })

  it('works with numeric values', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 200), {
      initialProps: { val: 0 },
    })
    rerender({ val: 42 })
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe(42)
  })

  it('resets timer when delay changes', () => {
    const { result, rerender } = renderHook(({ val, delay }) => useDebounce(val, delay), {
      initialProps: { val: 'a', delay: 300 },
    })
    rerender({ val: 'b', delay: 300 })
    act(() => { vi.advanceTimersByTime(100) })
    rerender({ val: 'b', delay: 500 })
    act(() => { vi.advanceTimersByTime(300) })
    // 100 + 300 = 400ms but new delay is 500 — should not have fired yet
    expect(result.current).toBe('a')
    act(() => { vi.advanceTimersByTime(200) })
    expect(result.current).toBe('b')
  })
})
