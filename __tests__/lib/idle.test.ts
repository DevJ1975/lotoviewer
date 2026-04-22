import { describe, it, expect } from 'vitest'
import { computeIdleState } from '@/lib/idle'

const PARAMS = { idleMs: 30 * 60_000, warningMs: 60_000 }
const t0 = 0

describe('computeIdleState', () => {
  it('reports active immediately after activity', () => {
    expect(computeIdleState(t0, t0, PARAMS)).toEqual({ kind: 'active' })
  })

  it('reports active well before the warning window opens', () => {
    expect(computeIdleState(t0 + 25 * 60_000, t0, PARAMS)).toEqual({ kind: 'active' })
  })

  it('switches to warning the moment idle time enters the last 60s', () => {
    // 29:00.001 → 59.999s remaining → warning
    const now = t0 + 29 * 60_000 + 1
    const state = computeIdleState(now, t0, PARAMS)
    expect(state.kind).toBe('warning')
    expect(state).toMatchObject({ kind: 'warning' })
    if (state.kind === 'warning') {
      expect(state.secondsLeft).toBe(60)  // ceil(59.999) = 60
    }
  })

  it('exact boundary: still active when remaining == warningMs', () => {
    // 29:00 → exactly 60s remaining → ABOVE warning threshold (>) → still active
    expect(computeIdleState(t0 + 29 * 60_000, t0, PARAMS)).toEqual({ kind: 'active' })
  })

  it('counts down each second within the warning window', () => {
    expect(computeIdleState(t0 + (29 * 60_000 + 30_000), t0, PARAMS)).toEqual({
      kind: 'warning', secondsLeft: 30,
    })
    expect(computeIdleState(t0 + (29 * 60_000 + 59_500), t0, PARAMS)).toEqual({
      kind: 'warning', secondsLeft: 1,
    })
  })

  it('clamps to 1s rather than reporting 0s in the final tick', () => {
    // 1ms before expiry → 1ms remaining → ceil(0.001) = 1 → clamp keeps it 1
    const state = computeIdleState(t0 + (30 * 60_000 - 1), t0, PARAMS)
    expect(state).toEqual({ kind: 'warning', secondsLeft: 1 })
  })

  it('reports expired exactly at the idle threshold', () => {
    expect(computeIdleState(t0 + 30 * 60_000, t0, PARAMS)).toEqual({ kind: 'expired' })
  })

  it('reports expired well past the threshold', () => {
    expect(computeIdleState(t0 + 60 * 60_000, t0, PARAMS)).toEqual({ kind: 'expired' })
  })

  it('handles clock skew (lastActivity in the future) by treating idle as zero', () => {
    expect(computeIdleState(t0, t0 + 5_000, PARAMS)).toEqual({ kind: 'active' })
  })

  it('handles arbitrary custom params (short timeouts for quick tests)', () => {
    const params = { idleMs: 5_000, warningMs: 1_000 }
    expect(computeIdleState(0,     0, params)).toEqual({ kind: 'active' })
    expect(computeIdleState(4_001, 0, params)).toEqual({ kind: 'warning', secondsLeft: 1 })
    expect(computeIdleState(5_000, 0, params)).toEqual({ kind: 'expired' })
  })
})
