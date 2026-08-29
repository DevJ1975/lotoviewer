import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration 257 carries four security-relevant decisions that are invisible in
// the app code: facility-scoped RLS on hand-written policies, a content-
// addressed natural key that makes the sweep idempotent, storage keys instead
// of public photo URLs, and a bounded evidence column.
//
// These are migration-TEXT assertions, in the same style as
// __tests__/migrations/profilesPrivilegedColumns.test.ts. There is no database
// in the unit suite, so they prove the migration SAYS what it must — not that
// Postgres enforces it. The behavioural proof is the staging checklist in the
// PR body.

const REPO_APPS_WEB = resolve(__dirname, '../..')

const sql = readFileSync(
  resolve(REPO_APPS_WEB, 'migrations/257_predictive_safety_intelligence.sql'),
  'utf8',
)
const rollback = readFileSync(
  resolve(REPO_APPS_WEB, 'migrations/257_rollback.sql'),
  'utf8',
)

// The header necessarily explains the attacks being closed, so every structural
// assertion runs against comment-stripped SQL.
const ddl = sql.replace(/--[^\n]*/g, '').replace(/\n{2,}/g, '\n').trim()

const NEW_TABLES = [
  'vision_sweep_runs',
  'vision_sweep_photos',
  'vision_hazard_signals',
  'document_drafts',
] as const

describe('Migration 257 — structure', () => {
  it('creates all four tables idempotently', () => {
    for (const table of NEW_TABLES) {
      expect(ddl, table).toContain(`create table if not exists public.${table}`)
    }
  })

  it('wraps everything in one transaction', () => {
    expect(ddl.startsWith('begin;')).toBe(true)
    expect(ddl.trimEnd().endsWith('commit;')).toBe(true)
  })

  it('reloads the PostgREST schema cache', () => {
    expect(ddl).toContain("notify pgrst, 'reload schema'")
  })

  it('cascades every table from its tenant', () => {
    const cascades = ddl.match(/tenant_id\s+uuid\s+not null references public\.tenants\(id\) on delete cascade/g)
    expect(cascades).toHaveLength(NEW_TABLES.length)
  })
})

describe('Migration 257 — tenant AND facility isolation', () => {
  // Migration 211 auto-scopes only the generated <table>_tenant_scope
  // policies and explicitly skips hand-written ones. A hand-written policy
  // copied from a pre-facility migration leaves rows from one facility
  // readable by a user scoped to another.
  it('gives every table RLS', () => {
    for (const table of NEW_TABLES) {
      expect(ddl, table).toContain(`alter table public.${table} enable row level security`)
    }
  })

  it('carries the facility clause on every policy, in using AND with check', () => {
    const facilityClauses = ddl.match(
      /public\.active_facility_id\(\) is null or facility_id is null or facility_id = public\.active_facility_id\(\)/g,
    )
    // One `using` + one `with check` per table.
    expect(facilityClauses).toHaveLength(NEW_TABLES.length * 2)
  })

  it('carries the tenant clause on every policy, in using AND with check', () => {
    const tenantClauses = ddl.match(
      /public\.active_tenant_id\(\) is null or tenant_id = public\.active_tenant_id\(\)/g,
    )
    expect(tenantClauses).toHaveLength(NEW_TABLES.length * 2)
  })

  it('restricts membership to the caller tenants or superadmin', () => {
    const membership = ddl.match(
      /tenant_id in \(select public\.current_user_tenant_ids\(\)\) or public\.is_superadmin\(\)/g,
    )
    expect(membership).toHaveLength(NEW_TABLES.length * 2)
  })

  it('scopes every policy to authenticated, never to anon', () => {
    const policies = ddl.match(/create policy [a-z_]+ on public\.[a-z_]+\n\s+for all to authenticated/g)
    expect(policies).toHaveLength(NEW_TABLES.length)
    expect(ddl).not.toContain('to anon')
  })
})

describe('Migration 257 — the sweep cannot be turned into an SSRF', () => {
  // bbs_observations_v2.photo_url is written by a direct browser PostgREST
  // insert into an unconstrained text column, so a stored URL is attacker-
  // controlled. The work row must carry a storage key the service role
  // downloads, never a URL the server fetches.
  it('stores a storage bucket and key on the work row', () => {
    expect(ddl).toContain('storage_bucket text        not null')
    expect(ddl).toContain('storage_key    text        not null')
  })

  it('has no url column anywhere in the migration', () => {
    expect(ddl).not.toMatch(/\b\w*_url\b/)
  })
})

describe('Migration 257 — signals cannot double-count', () => {
  // A sweep is resumable and re-runnable. Keying on the run would let one
  // hazard land once per resume.
  it('makes identity content-addressed, not run-scoped', () => {
    expect(ddl).toContain(
      'create unique index if not exists uq_vision_hazard_signals_identity\n  on public.vision_hazard_signals(tenant_id, source_kind, source_id, photo_sha256, hazard_code)',
    )
  })

  it('keeps run_id as nullable provenance so a purged run cannot orphan a signal', () => {
    expect(ddl).toContain('run_id         uuid        references public.vision_sweep_runs(id) on delete set null')
  })

  it('constrains the photo hash to a sha256', () => {
    expect(ddl).toContain("photo_sha256   text        not null check (photo_sha256 ~ '^[0-9a-f]{64}$')")
  })
})

describe('Migration 257 — the model cannot write outside the taxonomy', () => {
  const CODES = [
    'ppe_head', 'ppe_eye', 'ppe_hand', 'ppe_foot', 'ppe_hi_vis', 'ppe_fall_arrest',
    'guard_removed', 'egress_blocked', 'housekeeping', 'spill_leak',
    'damaged_equipment', 'signage_missing', 'electrical_exposed',
    'working_at_height_unprotected',
  ]

  it('constrains hazard_code to the closed taxonomy', () => {
    for (const code of CODES) {
      expect(ddl, code).toContain(`'${code}'`)
    }
  })

  it('constrains confidence to the ordinal scale, not a number', () => {
    // A self-reported 0..1 from an LLM is not a calibrated probability.
    expect(ddl).toContain("check (confidence in ('high','medium','low'))")
  })

  it('bounds the free-text evidence column', () => {
    // The only unbounded field crossing the boundary, and its content partly
    // originates in the photo.
    expect(ddl).toContain('check (length(evidence) <= 240)')
  })

  it('keeps a signal advisory — pending until a human rules on it', () => {
    expect(ddl).toContain("status         text        not null default 'pending'")
    expect(ddl).toContain("check (status in ('pending','confirmed','dismissed'))")
  })
})

describe('Migration 257 — drafts are grounded and staged', () => {
  it('requires a jurisdiction rather than letting the model infer one', () => {
    expect(ddl).toContain('jurisdiction   text        not null check (length(btrim(jurisdiction)) > 0)')
  })

  it('records the chunks the draft was grounded on', () => {
    expect(ddl).toContain("citation_chunk_ids uuid[]  not null default '{}'")
  })

  it('records how many citations the model fabricated', () => {
    expect(ddl).toContain('fabricated_citation_count int not null default 0')
  })

  it('starts every draft unaccepted', () => {
    expect(ddl).toContain("status         text        not null default 'draft'")
    expect(ddl).toContain("check (status in ('draft','accepted','discarded'))")
  })

  it('versions the payload so a stale draft is detectable on read', () => {
    expect(ddl).toContain('payload_version int        not null default 1')
  })
})

describe('Migration 257 — rollback', () => {
  it('drops every table the migration created', () => {
    for (const table of NEW_TABLES) {
      expect(rollback, table).toContain(`drop table if exists public.${table}`)
    }
  })

  it('drops the children before the run they reference', () => {
    expect(rollback.indexOf('vision_sweep_photos')).toBeLessThan(rollback.indexOf('drop table if exists public.vision_sweep_runs'))
    expect(rollback.indexOf('vision_hazard_signals')).toBeLessThan(rollback.indexOf('drop table if exists public.vision_sweep_runs'))
  })

  it('warns that human review decisions are unrecoverable', () => {
    // A re-run reproduces the signals but not the judgements a person made.
    expect(rollback).toContain('DESTRUCTIVE')
    expect(rollback.toLowerCase()).toContain('cannot be recomputed')
  })
})
