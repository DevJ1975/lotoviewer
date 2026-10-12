import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Migrations 312-316 are the database layer of the Environmental Compliance
// Suite, applied after the ISO 14001 EMS migrations (294-306) and the legal
// registry recovery (311). These tests pin the properties that are easy to break in
// a later edit and expensive to discover in production: tenant/facility isolation on
// every new table, admin-only writes, rollbacks that never touch what another
// migration owns, and no policy that reopens a table EMS closed. Behaviour was run
// against Postgres 16 with EMS applied first (apply twice, RLS and constraint
// checks, every rollback); the results are recorded in the PR.

const dir = resolve(__dirname, '../../migrations')
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8')
const strip = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const files = {
  profiles: '312_environmental_site_profiles.sql',
  outfalls: '313_stormwater_outfalls.sql',
  checklists: '314_environmental_checklists.sql',
  calendar: '315_compliance_calendar_v2.sql',
  legal: '316_legal_register_environmental.sql',
} as const

const migrations = Object.values(files)
const rollbackOf = (name: string) => name.slice(0, 3) + '_rollback.sql'

describe('migrations 312-316 — structure', () => {
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

describe('312/313 — site profile and outfalls', () => {
  const profileCode = strip(read(files.profiles))
  const outfallCode = strip(read(files.outfalls))
  const outfallRollback = strip(read('313_rollback.sql'))

  it('one profile per facility, bound to its tenant by a composite foreign key', () => {
    expect(profileCode).toContain('unique (facility_id)')
    expect(profileCode).toContain('foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade')
  })

  it('outfalls are bound to the tenant the same way', () => {
    expect(outfallCode).toContain('foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade')
  })

  it("an outfall's permit must be at the outfall's own site: the reference is the composite key, enforced by the database", () => {
    expect(outfallCode).toContain('foreign key (tenant_id, facility_id, permit_id) references public.environmental_permits (tenant_id, facility_id, id) on delete set null (permit_id)')
    expect(outfallCode).toContain('unique (tenant_id, facility_id, id)')
  })

  it("the permit vault's table belongs to migration 304: this suite neither creates nor drops it", () => {
    expect(outfallCode).not.toMatch(/create table (if not exists )?public\.environmental_permits\b/)
    expect(outfallRollback).not.toMatch(/drop table (if exists )?public\.environmental_permits\b/)
  })

  it('state is validated as a USPS code without failing on rows already in production', () => {
    expect(profileCode).toContain("check (state is null or state ~ '^[A-Z]{2}$') not valid")
  })

  it('members read, tenant admins write', () => {
    expect(profileCode).toContain('create policy env_site_profiles_read')
    expect(profileCode).toContain('create policy env_site_profiles_admin_write')
    expect(profileCode).toContain('current_user_admin_tenant_ids()')
    expect(outfallCode).toContain('create policy stormwater_outfalls_read')
    expect(outfallCode).toContain('create policy stormwater_outfalls_admin_write')
    expect(outfallCode).toContain('current_user_admin_tenant_ids()')
  })

  it('a facility view hides other facilities but roll-up (no facility) sees all', () => {
    expect(profileCode).toContain('public.active_facility_id() is null or facility_id = public.active_facility_id()')
    expect(outfallCode).toContain('public.active_facility_id() is null or facility_id = public.active_facility_id()')
  })
})

describe('314 — checklists on the inspection engine', () => {
  const sql = read(files.checklists)
  const code = strip(sql)
  const rollback = strip(read('314_rollback.sql'))

  it("marks inspections with a domain that defaults to 'safety', so injury-risk analytics never absorb environmental findings", () => {
    expect(code).toContain("add column if not exists domain text not null default 'safety'")
    expect(code).toContain("check (domain in ('safety', 'environmental'))")
  })

  it('stops a retried submit raising the same finding twice, for environmental findings only', () => {
    expect(code).toContain("where source_reference like 'env-%'")
  })

  it("does not touch nonconformities.facility_id: that column and its policy belong to migration 300, so dropping it on rollback would break EMS", () => {
    expect(code).not.toMatch(/alter table public\.nonconformities/)
    expect(rollback).not.toMatch(/nonconformities drop column/)
    expect(rollback).not.toContain('idx_nonconformities_facility')
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

describe('315 — calendar v2', () => {
  const code = strip(read(files.calendar))
  const rollback = strip(read('315_rollback.sql'))

  it("changes no policy: access to the obligations register is migration 298's, and an earlier draft recreated the old member-writable policy", () => {
    for (const [name, text] of [['315', code], ['315_rollback', rollback]] as const) {
      expect(text, name).not.toMatch(/create policy/)
      expect(text, name).not.toMatch(/drop policy/)
      expect(text, name).not.toContain('ccal_obligations_tenant_scope')
    }
  })

  it("does not add a jurisdiction column: the register's own (federal | state:XX) column is the only one", () => {
    expect(code).not.toMatch(/add column[^,;]*jurisdiction/)
    expect(rollback).not.toContain('drop column if exists jurisdiction')
  })

  it("widens the source check to library and ai without guessing the constraint's generated name", () => {
    expect(code).toContain("check (source in ('system', 'tenant', 'library', 'ai'))")
    expect(code).toContain('pg_get_constraintdef(oid) ilike')
  })

  it('caps the reminder window and constrains the anchor', () => {
    expect(code).toContain('lead_days int not null default 30 check (lead_days between 0 and 365)')
    expect(code).toContain("due_anchor in ('fixed', 'period_end')")
  })

  it('rollback removes library/ai obligations before restoring a source check that forbids them', () => {
    const deleted = rollback.indexOf("delete from public.compliance_calendar_obligations where source in ('library', 'ai')")
    const restored = rollback.indexOf("check (source in ('system', 'tenant'))")
    expect(deleted).toBeGreaterThan(-1)
    expect(deleted).toBeLessThan(restored)
  })
})

describe('316 — legal register convergence', () => {
  const code = strip(read(files.legal))
  const rollback = strip(read('316_rollback.sql'))

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
