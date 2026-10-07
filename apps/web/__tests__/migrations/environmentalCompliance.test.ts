import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Migrations 299-303 are the database layer of the Environmental Compliance
// Suite. These tests pin the properties that are easy to break in a later edit
// and expensive to discover in production: tenant/facility isolation on every new
// table, admin-only writes, and rollbacks that actually run. Behaviour was run
// against Postgres 16 (apply twice, 71 RLS/constraint checks, rollback diffed
// against the pre-299 schema); the results are recorded in the PR.

const dir = resolve(__dirname, '../../migrations')
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8')
const strip = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const files = {
  profiles: '299_environmental_site_profiles.sql',
  permits: '300_environmental_permits_outfalls.sql',
  checklists: '301_environmental_checklists.sql',
  calendar: '302_compliance_calendar_v2.sql',
  legal: '303_legal_register_environmental.sql',
} as const

const migrations = Object.values(files)
const rollbackOf = (name: string) => name.slice(0, 3) + '_rollback.sql'

describe('migrations 299-303 — structure', () => {
  it('each has a rollback and runs in one transaction', () => {
    for (const name of migrations) {
      expect(existsSync(resolve(dir, rollbackOf(name))), `${rollbackOf(name)} missing`).toBe(true)
      for (const file of [name, rollbackOf(name)]) {
        const code = strip(read(file))
        expect(code, file).toMatch(/^begin;/)
        expect(code, file).toMatch(/commit;$/)
      }
    }
  })

  it('every rollback says what it destroys', () => {
    for (const name of migrations) {
      expect(read(rollbackOf(name)), rollbackOf(name)).toMatch(/DESTRUCTIVE|Drops|drops/)
    }
  })

  it('never opens a table to everyone: no policy uses (true)', () => {
    for (const name of migrations) {
      expect(strip(read(name)), name).not.toMatch(/using \( ?true ?\)/i)
      expect(strip(read(name)), name).not.toMatch(/with check \( ?true ?\)/i)
    }
  })

  it('every policy is for authenticated users only', () => {
    for (const name of migrations) {
      const policies = strip(read(name)).match(/create policy [^;]*?;/g) ?? []
      for (const policy of policies) {
        expect(policy, `${name}: ${policy.slice(0, 60)}`).toMatch(/to authenticated/)
      }
    }
  })
})

describe('299/300 — site profile, permits, outfalls', () => {
  const profileCode = strip(read(files.profiles))
  const permitCode = strip(read(files.permits))

  it('one profile per facility, bound to its tenant by a composite foreign key', () => {
    expect(profileCode).toContain('unique (facility_id)')
    expect(profileCode).toContain('foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade')
  })

  it('permits and outfalls are bound to the tenant the same way', () => {
    const matches = permitCode.match(/foreign key \(tenant_id, facility_id\) references public\.facilities\(tenant_id, id\)/g) ?? []
    expect(matches).toHaveLength(2)
  })

  it('state is validated as a USPS code without failing on rows already in production', () => {
    expect(profileCode).toContain("check (state is null or state ~ '^[A-Z]{2}$') not valid")
  })

  it('members read, tenant admins write', () => {
    expect(profileCode).toContain('create policy env_site_profiles_read')
    expect(profileCode).toContain('create policy env_site_profiles_admin_write')
    expect(profileCode).toContain('current_user_admin_tenant_ids()')
    expect(permitCode).toContain('_admin_write')
    expect(permitCode).toContain('current_user_admin_tenant_ids()')
  })

  it('a facility view hides other facilities but roll-up (no facility) sees all', () => {
    expect(profileCode).toContain('public.active_facility_id() is null or facility_id = public.active_facility_id()')
  })
})

describe('301 — checklists on the inspection engine', () => {
  const sql = read(files.checklists)
  const code = strip(sql)
  const rollback = strip(read('301_rollback.sql'))

  it("marks inspections with a domain that defaults to 'safety', so injury-risk analytics never absorb environmental findings", () => {
    expect(code).toContain("add column if not exists domain text not null default 'safety'")
    expect(code).toContain("check (domain in ('safety', 'environmental'))")
  })

  it('stops a retried submit raising the same finding twice, for environmental findings only', () => {
    expect(code).toContain("where source_reference like 'env-%'")
  })

  it('links a calendar completion to at most one checklist', () => {
    expect(code).toContain('create unique index if not exists uq_ccal_events_inspection')
    expect(code).toContain('where inspection_id is not null')
  })

  it('evidence bucket is private, size-capped and limited to images and PDF', () => {
    expect(code).toMatch(/'environmental-evidence', 'environmental-evidence', false, 26214400/)
    expect(code).toContain("array['image/jpeg','image/png','image/webp','application/pdf']")
  })

  it('evidence can be uploaded by members but only replaced or deleted by tenant admins', () => {
    const policy = (name: string) => code.match(new RegExp(`create policy "${name}"[^;]*;`))?.[0] ?? ''
    expect(policy('env_evidence_tenant_insert')).toContain('current_user_tenant_ids()')
    expect(policy('env_evidence_admin_update')).toContain('current_user_admin_tenant_ids()')
    expect(policy('env_evidence_admin_delete')).toContain('current_user_admin_tenant_ids()')
  })

  it('rollback deletes environmental inspections before dropping the domain column that identifies them', () => {
    expect(rollback.indexOf("delete from public.inspections where domain = 'environmental'")).toBeGreaterThan(-1)
    expect(rollback.indexOf("delete from public.inspections where domain = 'environmental'")).toBeLessThan(
      rollback.indexOf('alter table public.inspections drop column domain'),
    )
  })

  it('rollback leaves the evidence files alone', () => {
    expect(rollback).not.toMatch(/delete from storage\./)
    expect(rollback).not.toMatch(/drop table[^;]*storage\./)
  })
})

describe('302 — calendar v2', () => {
  const code = strip(read(files.calendar))
  const rollback = strip(read('302_rollback.sql'))

  it('replaces the tenant-only policy with one that also honours the active facility, keeping shared rows visible', () => {
    expect(code).toContain('drop policy if exists ccal_obligations_tenant_scope')
    expect(code).toContain('public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id()')
  })

  it("widens the source check to library and ai without guessing the constraint's generated name", () => {
    expect(code).toContain("check (source in ('system', 'tenant', 'library', 'ai'))")
    expect(code).toContain('pg_get_constraintdef(oid) ilike')
  })

  it('caps the reminder window and constrains jurisdiction and anchor', () => {
    expect(code).toContain('lead_days int not null default 30 check (lead_days between 0 and 365)')
    expect(code).toContain("jurisdiction ~ '^(federal|[A-Z]{2})$'")
    expect(code).toContain("due_anchor in ('fixed', 'period_end')")
  })

  it('rollback removes library/ai obligations before restoring a source check that forbids them', () => {
    const deleted = rollback.indexOf("delete from public.compliance_calendar_obligations where source in ('library', 'ai')")
    const restored = rollback.indexOf("check (source in ('system', 'tenant'))")
    expect(deleted).toBeGreaterThan(-1)
    expect(deleted).toBeLessThan(restored)
  })
})

describe('303 — legal register convergence', () => {
  const code = strip(read(files.legal))
  const rollback = strip(read('303_rollback.sql'))

  it('replaces every existing policy, found dynamically, so production and a rebuild end identical', () => {
    expect(code).toContain("from pg_policies where schemaname = 'public' and tablename = 'legal_register'")
    expect(code).toContain("execute format('drop policy %I on public.legal_register', p.policyname)")
  })

  it('creates exactly two policies: member read, admin write', () => {
    expect(code.match(/create policy/g)).toHaveLength(2)
    expect(code).toContain('create policy legal_register_read')
    expect(code).toContain('create policy legal_register_admin_write')
  })

  it('does not double up triggers production may already have', () => {
    expect(code).toContain("f.proname = 'touch_updated_at'")
    expect(code).toContain("f.proname = 'log_audit'")
  })

  it('stops the same library entry being added twice for a site', () => {
    expect(code).toContain('create unique index if not exists uq_legal_register_library')
    expect(code).toContain('where library_key is not null')
  })

  it('a not-applicable requirement cannot carry a compliance rating', () => {
    expect(code).toContain("check (applicability <> 'not_applicable' or compliance_status = 'not_evaluated')")
  })

  it('rollback drops policies BEFORE the columns they reference (Postgres refuses the reverse)', () => {
    const policiesDropped = rollback.indexOf("execute format('drop policy %I on public.legal_register'")
    const columnsDropped = rollback.indexOf('drop column if exists facility_id')
    expect(policiesDropped).toBeGreaterThan(-1)
    expect(policiesDropped).toBeLessThan(columnsDropped)
  })

  it('rollback restores a working baseline policy rather than leaving the table without one', () => {
    expect(rollback).toContain('create policy legal_register_tenant_scope')
  })
})
