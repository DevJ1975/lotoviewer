// NFPA 51B §8.7 post-work fire watch.
//
// The watch exists because hot work leaves smouldering ignition that develops
// AFTER the torch stops — which is why the standard sets a 60-minute floor and
// why a permit may not be closed as "task complete" until the watch has run.
//
// Migration 019 states both rules in its own comments ("Permit cannot close
// until now() >= work_completed_at + post_watch_minutes", "60 min is the NFPA
// 51B floor") and enforced neither: the column check allowed 1 minute, and the
// close-out dialog wrote canceled_at unconditionally.
//
// Both writes go from the browser straight through PostgREST, so there is no
// server route in the path — the database is the real enforcement point and
// the client is the courtesy. These tests cover both layers: the shape of the
// migration that binds any writer, and the client rule that keeps a supervisor
// from being told "no" only after they have already pressed the button.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { hotWorkState, hotWorkCountdown } from '@soteria/core/hotWorkPermitStatus'
import type { HotWorkPermit } from '@soteria/core/types'

const migration = readFileSync(
  resolve(process.cwd(), 'migrations/263_hot_work_fire_watch_enforcement.sql'), 'utf8')
const dialog = readFileSync(
  resolve(process.cwd(), 'app/hot-work/[permitId]/_components/CancelDialog.tsx'), 'utf8')
const newPermitForm = readFileSync(
  resolve(process.cwd(), 'app/hot-work/new/page.tsx'), 'utf8')

const MIN = 60_000

function permit(over: Partial<HotWorkPermit> = {}): HotWorkPermit {
  return {
    id: 'p1', canceled_at: null, cancel_reason: null,
    entry_supervisor_signature_at: '2026-08-01T00:00:00Z',
    pai_signature_at: '2026-08-01T00:00:00Z',
    started_at: '2026-08-01T00:00:00Z',
    expires_at: new Date(Date.now() + 4 * 3600_000).toISOString(),
    work_completed_at: null, post_watch_minutes: 60,
    ...over,
  } as unknown as HotWorkPermit
}

describe('post-work fire watch — the state machine already knew the rule', () => {
  it('is not ready to close while the watch is still running', () => {
    // Work finished a minute ago on a 60-minute watch.
    const p = permit({ work_completed_at: new Date(Date.now() - 1 * MIN).toISOString() })
    expect(hotWorkState(p)).toBe('post_work_watch')
    // hotWorkCountdown returns a record, not a bare number — the dialog has to
    // read the field or it renders "[object Object]" at the supervisor.
    expect(hotWorkCountdown(p).postWatchMinutesRemaining).toBeGreaterThan(0)
  })

  it('reports no remaining watch once it has elapsed', () => {
    const p = permit({ work_completed_at: new Date(Date.now() - 61 * MIN).toISOString() })
    expect(hotWorkCountdown(p).postWatchMinutesRemaining).toBeNull()
  })

  it('is ready to close only once the full watch has elapsed', () => {
    const p = permit({ work_completed_at: new Date(Date.now() - 61 * MIN).toISOString() })
    expect(hotWorkState(p)).toBe('post_watch_complete')
  })

  it('has not started the watch at all until work is marked complete', () => {
    expect(hotWorkState(permit({ work_completed_at: null }))).not.toBe('post_watch_complete')
  })

  it('respects a site that lengthens the watch beyond the floor', () => {
    // 90 minutes elapsed is enough for a 60-minute watch but not a 120.
    const elapsed = new Date(Date.now() - 90 * MIN).toISOString()
    expect(hotWorkState(permit({ work_completed_at: elapsed, post_watch_minutes: 60 }))).toBe('post_watch_complete')
    expect(hotWorkState(permit({ work_completed_at: elapsed, post_watch_minutes: 120 }))).toBe('post_work_watch')
  })
})

describe('close-out is gated on the watch, and only for task_complete', () => {
  it('blocks the close-out button rather than failing after the click', () => {
    expect(dialog).toContain('watchBlockedMsg')
    expect(dialog).toMatch(/disabled=\{busy \|\| !!watchBlockedMsg\}/)
    // And refuses in the submit handler too, so a stale render cannot slip past.
    expect(dialog).toMatch(/if \(watchBlockedMsg\) \{ setErr\(watchBlockedMsg\); return \}/)
  })

  it('derives the gate from the shared state machine, not a private copy', () => {
    expect(dialog).toContain("from '@soteria/core/hotWorkPermitStatus'")
    expect(dialog).toContain("state !== 'post_watch_complete'")
  })

  it('gates ONLY task_complete — for-cause cancels must stay available', () => {
    // fire_observed is what a supervisor reaches for when something is burning.
    // Putting that behind a timer would be exactly backwards.
    expect(dialog).toMatch(/isCloseOut && state !== 'post_watch_complete'/)
    expect(migration).toMatch(/cancel_reason is distinct from 'task_complete'/)
    expect(migration).toContain('fire_observed')
  })
})

describe('the database enforces both rules, since the browser is not the only writer', () => {
  it('raises the fire-watch floor to the NFPA minimum', () => {
    expect(migration).toMatch(/post_watch_minutes\s*>=\s*60/)
    expect(migration).toMatch(/post_watch_minutes\s*<=\s*240/)
  })

  it('adds the floor NOT VALID so historical permits are not rewritten', () => {
    // Those rows record what actually happened on past jobs. Editing them to
    // satisfy a new constraint would falsify an audit trail an inspector may
    // later read.
    expect(migration).toMatch(/not valid/i)
  })

  it('blocks a task_complete close-out before the watch has elapsed', () => {
    expect(migration).toMatch(/create or replace function public\.enforce_hot_work_post_watch/)
    expect(migration).toMatch(/before update on public\.loto_hot_work_permits/)
    // Both halves of the rule: work must be marked complete, and the timer run.
    expect(migration).toMatch(/new\.work_completed_at is null/)
    expect(migration).toMatch(/now\(\) < new\.work_completed_at \+ make_interval/)
  })

  it('uses a trigger rather than a CHECK, because the rule reads the clock', () => {
    // A CHECK constraint must be immutable; now() is not.
    expect(migration).toMatch(/language plpgsql/)
  })
})

describe('the issue form cannot mint a permit below the floor', () => {
  it('validates and bounds the input at 60, not 1', () => {
    expect(newPermitForm).toMatch(/POST_WATCH_MIN_MINUTES = 60/)
    expect(newPermitForm).toMatch(/postWatchMinutes < POST_WATCH_MIN_MINUTES/)
    expect(newPermitForm).toMatch(/min=\{POST_WATCH_MIN_MINUTES\}/)
    // The old floor is gone from both the validation and the input.
    expect(newPermitForm).not.toMatch(/postWatchMinutes < 1\b/)
    expect(newPermitForm).not.toMatch(/min=\{1\}/)
  })
})
