import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(__dirname, '../../migrations/297_strike_scheduling.sql'), 'utf8')
  .replace(/--[^\n]*/g, '')

describe('strike_scheduling migration', () => {
  it('records why an assignment exists and when it is released', () => {
    expect(sql).toMatch(/add column if not exists trigger_kind\s+text not null default 'manual'/)
    expect(sql).toMatch(/check \(trigger_kind in \('manual', 'schedule', 'permit', 'pre_job', 'onboarding'\)\)/)
    expect(sql).toMatch(/add column if not exists starts_at\s+timestamptz/)
  })

  it('creates tenant-scoped curricula that only admins can change', () => {
    for (const table of ['strike_curricula', 'strike_curriculum_items']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`)
      const write = sql.match(new RegExp(String.raw`create policy ${table}_write[\s\S]*?;`))?.[0] ?? ''
      expect(write).toContain('current_user_admin_tenant_ids()')
    }
  })

  it('keeps release offsets and due windows sane', () => {
    expect(sql).toMatch(/release_offset_days\s+int not null default 0 check \(release_offset_days >= 0\)/)
    expect(sql).toMatch(/due_after_days\s+int not null default 14 check \(due_after_days > 0\)/)
  })
})
