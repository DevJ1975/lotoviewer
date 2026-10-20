import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(__dirname, '../../migrations/304_strike_offline_devices.sql'), 'utf8').replace(/--[^\n]*/g, '')

describe('strike offline devices migration', () => {
  it('keeps device credentials away from every browser role', () => {
    expect(sql).toContain('alter table public.strike_devices enable row level security')
    expect(sql).toContain('revoke all on public.strike_devices from anon, authenticated')
    expect(sql).not.toMatch(/create policy/)
  })

  it('stores only a sha256 hex digest of the device secret', () => {
    expect(sql).toMatch(/secret_hash\s+text not null check \(secret_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
    expect(sql).not.toMatch(/\bsecret\s+text/)
  })

  it('makes the device-generated attempt id unique per tenant, so a replayed sync finds the first row', () => {
    expect(sql).toMatch(/create unique index if not exists strike_attempts_client_attempt_uidx\s+on public\.strike_attempts\(tenant_id, client_attempt_id\)\s+where client_attempt_id is not null/)
  })

  it('keeps what the device clock said apart from the clamped record time', () => {
    for (const column of ['client_started_at', 'client_submitted_at', 'synced_at', 'provisional_passed']) {
      expect(sql).toContain(`add column if not exists ${column}`)
    }
    expect(sql).toContain('add column if not exists occurred_at timestamptz')
  })

  it('is safe to run twice', () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/)
    expect(sql).not.toMatch(/add column (?!if not exists)/)
  })
})
