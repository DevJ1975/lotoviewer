import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration-TEXT assertions (no database in the unit suite). The behavioural
// proof after applying to a Supabase branch: a learner session's
// `insert into strike_completions (... passed true ...)` must be denied.

const sql = readFileSync(resolve(__dirname, '../../migrations/295_strike_content_model.sql'), 'utf8')
  .replace(/--[^\n]*/g, '')

describe('strike_content_model migration', () => {
  it('checks only that content.blocks is an array (shape lives in parseStrikeContent)', () => {
    expect(sql).toMatch(/check \(content is null or jsonb_typeof\(content -> 'blocks'\) = 'array'\)/)
  })

  it('extends the freeze to the new content columns but leaves download_path writable', () => {
    const body = sql.match(/function public\.strike_guard_frozen_version\(\)[\s\S]*?\$\$([\s\S]*?)\$\$/)?.[1] ?? ''
    for (const column of ['content', 'validity_days', 'locale', 'passing_score']) expect(body).toContain(`new.${column}`)
    expect(body).not.toContain('new.download_path')
  })

  it('makes a formative check unable to gate a credential', () => {
    expect(sql).toMatch(/check \(block_key is null or graded = false\)/)
  })

  it('re-grants question columns explicitly, still without the answer key', () => {
    const grant = sql.match(/grant\s+select\s*\(([^)]*)\)\s*on public\.strike_quiz_questions/)?.[1] ?? ''
    const columns = grant.split(',').map(c => c.trim())
    expect(columns).toEqual(expect.arrayContaining(['graded', 'block_key', 'bank_tag', 'prompt']))
    expect(columns).not.toContain('explanation')
  })

  it('lets a roster member without a login hold a completion', () => {
    expect(sql).toMatch(/alter table public\.strike_completions alter column user_id drop not null/)
    expect(sql).toMatch(/check \(user_id is not null or member_id is not null\)/)
  })

  it('removes the browser-forgeable learner write paths', () => {
    expect(sql).toMatch(/drop policy if exists strike_attempts_insert/)
    expect(sql).toMatch(/drop policy if exists strike_attempts_update/)
    expect(sql).not.toMatch(/create policy strike_attempts_(insert|update)/)
    const completionInsert = sql.match(/create policy strike_completions_insert[\s\S]*?;/)?.[0] ?? ''
    expect(completionInsert).toContain("source = 'admin'")
    expect(completionInsert).toContain('current_user_admin_tenant_ids')
    expect(completionInsert).not.toContain('auth.uid()')
  })

  it('stores block evidence with one row per attempt, block and event', () => {
    expect(sql).toMatch(/unique \(attempt_id, block_key, event\)/)
    expect(sql).toMatch(/alter table public\.strike_block_events enable row level security/)
  })
})
