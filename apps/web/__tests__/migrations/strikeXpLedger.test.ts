import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(__dirname, '../../migrations/299_strike_xp_ledger.sql'), 'utf8').replace(/--[^\n]*/g, '')

describe('strike_xp_ledger migration', () => {
  it('makes re-earning the same event impossible', () => {
    expect(sql).toMatch(/unique \(tenant_id, member_id, event_type, dedupe_key\)/)
  })

  it('has no speed or streak event types', () => {
    const types = sql.match(/event_type\s+text not null check \(event_type in \(([^)]*)\)\)/)?.[1] ?? ''
    expect(types).toBe("'module_passed', 'on_time', 'practice_solved', 'curriculum_complete'")
  })

  it('is append-only and has no browser write path', () => {
    expect(sql).toMatch(/create trigger strike_xp_events_no_update\s+before update on public\.strike_xp_events/)
    expect(sql).not.toMatch(/create policy strike_xp_events_(insert|update|delete|write)/)
  })

  it('lets each person manage only their own leaderboard opt-in', () => {
    const policy = sql.match(/create policy strike_leaderboard_optins_own[\s\S]*?;/)?.[0] ?? ''
    expect(policy).toContain('m.profile_id = auth.uid()')
  })
})
