import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(__dirname, '../../migrations/300_strike_xapi.sql'), 'utf8').replace(/--[^\n]*/g, '')

describe('strike_xapi migration', () => {
  it('keeps LRS credentials and the outbox away from every browser role', () => {
    for (const table of ['strike_lrs_endpoints', 'strike_xapi_statements']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`)
      expect(sql).toContain(`revoke all on public.${table} from anon, authenticated`)
    }
    expect(sql).not.toMatch(/create policy/)
  })

  it('only accepts an https endpoint', () => {
    expect(sql).toMatch(/endpoint\s+text not null check \(endpoint ~ '\^https:\/\/'/)
  })

  it('keys the outbox by statement id so a retried enqueue cannot duplicate', () => {
    expect(sql).toMatch(/create table if not exists public\.strike_xapi_statements \(\s*id\s+uuid primary key,/)
  })

  it('indexes only the unsent rows the sync cron scans', () => {
    expect(sql).toMatch(/strike_xapi_statements_due_idx\s+on public\.strike_xapi_statements\(next_try_at\)\s+where sent_at is null/)
  })
})
