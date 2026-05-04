import { describe, it, expect } from 'vitest'
import {
  hotWorkState,
  hotWorkCountdown,
  hotWorkTone,
  evaluateSignGates,
} from '@/lib/hotWorkPermitStatus'
import type { HotWorkPermit } from '@/lib/types'

const NOW = new Date('2026-04-27T12:00:00Z').getTime()

// Minimal fixture — only the columns the lifecycle helpers actually
// read. Tests pass partial Pick<HotWorkPermit, ...> shapes.
type LifecycleFields = Pick<HotWorkPermit,
  'pai_signature_at' | 'expires_at' | 'canceled_at'
  | 'work_completed_at' | 'post_watch_minutes'>

function lifecycle(p: Partial<LifecycleFields> = {}): LifecycleFields {
  return {
    pai_signature_at:    null,
    expires_at:          new Date(NOW + 4 * 3600_000).toISOString(),
    canceled_at:         null,
    work_completed_at:   null,
    post_watch_minutes:  60,
    ...p,
  }
}

// ── hotWorkState ───────────────────────────────────────────────────────────

describe('hotWorkState', () => {
  it('returns pending_signature when no PAI signature yet', () => {
    expect(hotWorkState(lifecycle({ pai_signature_at: null }), NOW)).toBe('pending_signature')
  })

  it('returns active when signed and within expires_at', () => {
    expect(hotWorkState(lifecycle({
      pai_signature_at: '2026-04-27T11:00:00Z',
    }), NOW)).toBe('active')
  })

  it('returns expired when past expires_at and never marked complete', () => {
    expect(hotWorkState(lifecycle({
      pai_signature_at: '2026-04-27T08:00:00Z',
      expires_at:       new Date(NOW - 60_000).toISOString(),  // expired 1 min ago
    }), NOW)).toBe('expired')
  })

  it('returns canceled when canceled_at is set, regardless of other fields', () => {
    // Even though work_completed_at is set and post-watch would have
    // ended, canceled_at takes precedence — the row is closed.
    expect(hotWorkState(lifecycle({
      pai_signature_at:  '2026-04-27T08:00:00Z',
      canceled_at:       '2026-04-27T11:30:00Z',
      work_completed_at: '2026-04-27T11:00:00Z',
    }), NOW)).toBe('canceled')
  })

  it('returns post_work_watch when work_completed_at is set and watch timer is still running', () => {
    expect(hotWorkState(lifecycle({
      pai_signature_at:  '2026-04-27T08:00:00Z',
      work_completed_at: '2026-04-27T11:30:00Z',  // 30 min ago, default 60-min watch
      post_watch_minutes: 60,
    }), NOW)).toBe('post_work_watch')
  })

  it('returns post_watch_complete when work_completed_at + post_watch_minutes is in the past', () => {
    expect(hotWorkState(lifecycle({
      pai_signature_at:  '2026-04-27T08:00:00Z',
      work_completed_at: '2026-04-27T10:00:00Z',  // 2 h ago, 60-min watch elapsed
      post_watch_minutes: 60,
    }), NOW)).toBe('post_watch_complete')
  })

  it('uses the per-permit override when post_watch_minutes is non-default', () => {
    // Site bumps to 120 min; same work_completed_at means we're still
    // in post_work_watch even though 60 min elapsed.
    expect(hotWorkState(lifecycle({
      pai_signature_at:  '2026-04-27T08:00:00Z',
      work_completed_at: '2026-04-27T10:30:00Z',  // 90 min ago
      post_watch_minutes: 120,
    }), NOW)).toBe('post_work_watch')
  })

  it('post-work watch ignores expires_at — work-complete supersedes the active-window expiry', () => {
    // Permit nominally expired 5 min ago, but supervisor marked work
    // complete 10 min ago; we're in post-watch, not expired.
    expect(hotWorkState(lifecycle({
      pai_signature_at:  '2026-04-27T08:00:00Z',
      expires_at:        new Date(NOW - 5 * 60_000).toISOString(),
      work_completed_at: new Date(NOW - 10 * 60_000).toISOString(),
      post_watch_minutes: 60,
    }), NOW)).toBe('post_work_watch')
  })

  it('treats unparseable expires_at as expired (fail-closed) — matches CS permitState', () => {
    expect(hotWorkState(lifecycle({
      pai_signature_at: '2026-04-27T08:00:00Z',
      expires_at:       'not-a-date',
    }), NOW)).toBe('expired')
  })

  it('treats unparseable work_completed_at as expired rather than infinite watch', () => {
    expect(hotWorkState(lifecycle({
      pai_signature_at:  '2026-04-27T08:00:00Z',
      work_completed_at: 'garbage',
      post_watch_minutes: 60,
    }), NOW)).toBe('expired')
  })

  it('canceled wins over pending_signature (canceled before signing)', () => {
    expect(hotWorkState(lifecycle({
      pai_signature_at: null,
      canceled_at:      '2026-04-27T10:00:00Z',
    }), NOW)).toBe('canceled')
  })
})

// ── hotWorkCountdown ───────────────────────────────────────────────────────

describe('hotWorkCountdown', () => {
  it('reports active minutes remaining for an active permit', () => {
    const c = hotWorkCountdown(lifecycle({
      pai_signature_at: '2026-04-27T11:00:00Z',
      expires_at:       new Date(NOW + 90 * 60_000).toISOString(),
    }), NOW)
    expect(c.activeMinutesRemaining).toBe(90)
    expect(c.postWatchMinutesRemaining).toBeNull()
  })

  it('reports post-watch minutes remaining during post_work_watch', () => {
    const c = hotWorkCountdown(lifecycle({
      pai_signature_at:   '2026-04-27T08:00:00Z',
      work_completed_at:  new Date(NOW - 20 * 60_000).toISOString(),  // 20 min ago
      post_watch_minutes: 60,
    }), NOW)
    expect(c.activeMinutesRemaining).toBeNull()
    expect(c.postWatchMinutesRemaining).toBe(40)   // 60 - 20
  })

  it('returns nulls for any non-counting state', () => {
    expect(hotWorkCountdown(lifecycle({}), NOW))
      .toEqual({ activeMinutesRemaining: null, postWatchMinutesRemaining: null })
    expect(hotWorkCountdown(lifecycle({
      pai_signature_at: '2026-04-27T08:00:00Z',
      canceled_at:      '2026-04-27T11:00:00Z',
    }), NOW))
      .toEqual({ activeMinutesRemaining: null, postWatchMinutesRemaining: null })
  })

  it('clamps active minutes to 0 (never negative) when right at expiry', () => {
    const c = hotWorkCountdown(lifecycle({
      pai_signature_at: '2026-04-27T11:00:00Z',
      expires_at:       new Date(NOW).toISOString(),
    }), NOW)
    // Exactly at expiry the state is 'expired' so activeMinutesRemaining
    // should be null. The clamp branch matters during the 1-second
    // boundary window — we don't show -0.
    expect(c.activeMinutesRemaining).toBeNull()
  })
})

// ── hotWorkTone ────────────────────────────────────────────────────────────

describe('hotWorkTone', () => {
  it('expired is critical', () => {
    expect(hotWorkTone('expired', { activeMinutesRemaining: null, postWatchMinutesRemaining: null }))
      .toBe('critical')
  })

  it('active with <30 min is critical, <120 min is warning, otherwise safe', () => {
    expect(hotWorkTone('active', { activeMinutesRemaining: 15,  postWatchMinutesRemaining: null })).toBe('critical')
    expect(hotWorkTone('active', { activeMinutesRemaining: 90,  postWatchMinutesRemaining: null })).toBe('warning')
    expect(hotWorkTone('active', { activeMinutesRemaining: 240, postWatchMinutesRemaining: null })).toBe('safe')
  })

  it('post_work_watch is warning until the last 5 min, then safe (almost done)', () => {
    expect(hotWorkTone('post_work_watch', { activeMinutesRemaining: null, postWatchMinutesRemaining: 30 })).toBe('warning')
    expect(hotWorkTone('post_work_watch', { activeMinutesRemaining: null, postWatchMinutesRemaining: 3  })).toBe('safe')
  })

  it('post_watch_complete is safe (ready to close)', () => {
    expect(hotWorkTone('post_watch_complete', { activeMinutesRemaining: null, postWatchMinutesRemaining: null }))
      .toBe('safe')
  })

  it('canceled is neutral (no longer needs attention)', () => {
    expect(hotWorkTone('canceled', { activeMinutesRemaining: null, postWatchMinutesRemaining: null }))
      .toBe('neutral')
  })

  it('pending_signature is warning (action required)', () => {
    expect(hotWorkTone('pending_signature', { activeMinutesRemaining: null, postWatchMinutesRemaining: null }))
      .toBe('warning')
  })
})

// ── evaluateSignGates ──────────────────────────────────────────────────────

type GateFields = Pick<HotWorkPermit,
  'work_location' | 'work_description' | 'work_types'
  | 'hot_work_operators' | 'fire_watch_personnel'
  | 'pre_work_checks' | 'associated_cs_permit_id'>

function fullChecklist() {
  return {
    combustibles_cleared_35ft:    true,
    floor_swept:                  true,
    floor_openings_protected:     true,
    wall_openings_protected:      true,
    sprinklers_operational:       true,
    ventilation_adequate:         true,
    fire_extinguisher_present:    true,
    fire_extinguisher_type:       'ABC',
    curtains_or_shields_in_place: true,
    adjacent_areas_notified:      true,
  }
}

function gates(p: Partial<GateFields> = {}): GateFields {
  return {
    work_location:           'Bay 4 south wall',
    work_description:        'Repair handrail mount',
    work_types:              ['welding'],
    hot_work_operators:      ['Maria Lopez'],
    fire_watch_personnel:    ['Tomás Reyes'],
    pre_work_checks:         fullChecklist(),
    associated_cs_permit_id: null,
    ...p,
  }
}

describe('evaluateSignGates', () => {
  it('returns no blocks for a fully-prepared permit', () => {
    expect(evaluateSignGates(gates())).toEqual([])
  })

  it('blocks when work_location is blank', () => {
    expect(evaluateSignGates(gates({ work_location: '   ' })).map(b => b.code))
      .toContain('location_blank')
  })

  it('blocks when work_description is blank', () => {
    expect(evaluateSignGates(gates({ work_description: '' })).map(b => b.code))
      .toContain('description_blank')
  })

  it('blocks when no work types selected', () => {
    expect(evaluateSignGates(gates({ work_types: [] })).map(b => b.code))
      .toContain('work_types_empty')
  })

  it('blocks when no operators on the roster', () => {
    expect(evaluateSignGates(gates({ hot_work_operators: [] })).map(b => b.code))
      .toContain('no_operators')
  })

  it('blocks when no fire watcher on the roster (Cal/OSHA §6777)', () => {
    expect(evaluateSignGates(gates({ fire_watch_personnel: [] })).map(b => b.code))
      .toContain('no_watcher')
  })

  it('blocks when the same name appears in both operators and watchers (case-insensitive)', () => {
    expect(evaluateSignGates(gates({
      hot_work_operators:   ['Maria Lopez'],
      fire_watch_personnel: ['maria lopez'],
    })).map(b => b.code)).toContain('watcher_operator_overlap')
  })

  it('blocks when pre_work_checks.confined_space=true but no CS permit linked', () => {
    expect(evaluateSignGates(gates({
      pre_work_checks: { ...fullChecklist(), confined_space: true },
      associated_cs_permit_id: null,
    })).map(b => b.code)).toContain('cs_link_required')
  })

  it('does not block on confined_space when an associated CS permit is linked', () => {
    expect(evaluateSignGates(gates({
      pre_work_checks: { ...fullChecklist(), confined_space: true },
      associated_cs_permit_id: 'some-uuid',
    })).map(b => b.code)).not.toContain('cs_link_required')
  })

  it('surfaces underlying checklist failures with checklist: prefix', () => {
    const codes = evaluateSignGates(gates({
      pre_work_checks: { ...fullChecklist(), combustibles_cleared_35ft: false },
    })).map(b => b.code)
    expect(codes).toContain('checklist:combustibles')
  })

  it('combines multiple block reasons in a single result', () => {
    const codes = evaluateSignGates(gates({
      work_types: [],
      fire_watch_personnel: [],
    })).map(b => b.code)
    expect(codes).toContain('work_types_empty')
    expect(codes).toContain('no_watcher')
  })
})
