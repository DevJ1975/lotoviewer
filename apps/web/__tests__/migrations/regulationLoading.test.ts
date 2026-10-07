import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 297 adds the three functions the Python service uses to load
// regulations into the shared knowledge base atomically. Migration-TEXT
// assertions, as in serviceJobs.test.ts. The behavioural proof (atomic replace
// leaving the old section intact on failure, prune scoping, snapshot upsert,
// permissions) was run against Postgres 16 with pgvector and the real knowledge
// base migrations, and is recorded in the PR that added this migration.

const read = (file: string) => readFileSync(resolve(__dirname, '../..', 'migrations', file), 'utf8')
const stripComments = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const sql      = stripComments(read('297_regulation_loading.sql'))
const rollback = stripComments(read('297_rollback.sql'))

const SIGNATURES = [
  'replace_regulation_document(text, text, text, text, text, jsonb)',
  'prune_regulation_documents(text, text[])',
  'record_regulation_snapshot(text, text, text, text, date)',
]

describe('Migration 297 — regulation loading', () => {
  it('runs every function as a pinned-search-path security definer', () => {
    expect(sql.match(/security definer set search_path = pg_catalog, public/g)).toHaveLength(3)
  })

  it('lets only the service role call them', () => {
    for (const fn of SIGNATURES) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated`)
      expect(sql).toContain(`grant execute on function public.${fn} to service_role`)
    }
  })

  it('replaces a section in one statement sequence: delete, then insert document and chunks', () => {
    expect(sql).toMatch(/delete from public\.knowledge_documents where tenant_id is null and source_url = p_source_url/)
    expect(sql).toContain("(null, p_source_type::public.knowledge_source_type")
    expect(sql).toContain('(c ->> \'embedding\')::vector(1024)')
  })

  it('only ever touches global regulation rows, never a tenant document or a company policy', () => {
    const regulationTypes = "source_type::text in ('regulation', 'state_reg', 'dot', 'epa', 'rcra')"
    expect(sql.split(regulationTypes).length - 1).toBe(2) // replace's delete, prune's delete
    expect(sql).toContain("if p_source_type not in ('regulation', 'state_reg', 'dot', 'epa', 'rcra')")
    expect(sql.match(/where tenant_id is null/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('bounds the chunks accepted per section', () => {
    expect(sql).toContain('jsonb_array_length(p_chunks) not between 1 and 2000')
  })

  it('refuses a prune that could delete everything', () => {
    expect(sql).toContain('length(p_url_prefix) < 20')
    expect(sql).toContain('cardinality(p_keep_urls) = 0')
    expect(sql).toContain('left(source_url, length(p_url_prefix)) = p_url_prefix')
  })

  it('creates the tracking row on first load and flags a part still behind the newest amendment', () => {
    expect(sql).toContain('insert into public.regulation_update_checks')
    expect(sql).toContain('on conflict (source) do update')
    expect(sql).toContain('> excluded.ingested_snapshot')
    // The cron owns last_notified_at; a load must not reset its throttle.
    expect(sql).not.toContain('last_notified_at')
  })

  it('rolls back by dropping only the functions', () => {
    for (const fn of SIGNATURES) expect(rollback).toContain(`drop function if exists public.${fn}`)
    expect(rollback).not.toMatch(/drop table/)
  })
})
