import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  EPA_ID_RE, MANIFEST_ACTIONS, MANIFEST_MAX_CONTAINERS, MANIFEST_MAX_WASTE_CODES, MANIFEST_STATUSES, MANIFEST_TRACKING_NUMBER_RE,
} from '@soteria/core/hazardousWasteManifest'

// Migration 317 adds manifests to the hazardous-waste module. The behaviour is exercised against a
// real Postgres in hazardousWasteManifests.db.test.ts; these checks read the SQL itself, for the
// properties that are easy to break in a later edit and silent when they break: a migration that
// cannot be applied twice, a rollback that reaches into tables it did not create, a table without
// row-level security, a policy that lets any member write, and SQL that has drifted from the core
// module the screens are built on.

const dir = resolve(__dirname, '../../migrations')
const FORWARD = '317_hazardous_waste_shipments.sql'
const ROLLBACK = '317_rollback.sql'
const read = (name: string) => readFileSync(resolve(dir, name), 'utf8')
const strip = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()

const forward = strip(read(FORWARD))
const rollback = strip(read(ROLLBACK))

const OWN_TABLES = ['hazardous_waste_shipments', 'hazardous_waste_shipment_containers'] as const
const OLDER_TABLES = ['hazardous_waste_streams', 'hazardous_waste_containers', 'hazardous_waste_areas', 'hazardous_waste_inspections']

const matches = (sql: string, pattern: RegExp) => [...sql.matchAll(pattern)].map(m => m[1]!)
const policyNamed = (name: string) => forward.match(new RegExp(`create policy ${name} on [^;]*;`))?.[0] ?? ''

describe('migration 317: structure', () => {
  it('has a rollback, and both run in one transaction', () => {
    expect(existsSync(resolve(dir, ROLLBACK))).toBe(true)
    for (const [name, code] of [[FORWARD, forward], [ROLLBACK, rollback]] as const) {
      expect(code, name).toMatch(/^begin;/)
      expect(code, name).toMatch(/commit;$/)
      expect(code, name).toContain("notify pgrst, 'reload schema';")
    }
  })

  it('the rollback says what it destroys and what it does to containers', () => {
    const header = read(ROLLBACK)
    expect(header).toMatch(/DESTRUCTIVE/)
    expect(header).toMatch(/'closed'/)
    expect(header).toMatch(/in shipment/i)
  })

  it('never opens a table to everyone: no policy uses (true)', () => {
    expect(forward).not.toMatch(/using \( ?true ?\)/i)
    expect(forward).not.toMatch(/with check \( ?true ?\)/i)
  })

  it('stays out of the environmental management system', () => {
    for (const [name, code] of [[FORWARD, forward], [ROLLBACK, rollback]] as const) {
      expect(code, name).not.toMatch(/\bems_|\benvironmental_|\bms_/)
    }
  })

  it('never creates, alters or drops anything on a table another migration owns', () => {
    const onOlderTable = (table: string) => new RegExp(
      `(alter table (if exists )?public\\.${table}\\b|(create|drop) table (if not exists |if exists )?public\\.${table}\\b|(create|drop) (policy|trigger) (if exists )?\\w+ on public\\.${table}\\b)`, 'g')
    for (const table of OLDER_TABLES) {
      expect(forward.match(onOlderTable(table)) ?? [], `${table} in ${FORWARD}`).toEqual([])
      expect(rollback.match(onOlderTable(table)) ?? [], `${table} in ${ROLLBACK}`).toEqual([])
    }
  })
})

describe('migration 317: idempotent', () => {
  it('creates every table and index only if absent', () => {
    expect(forward.match(/create table (?!if not exists)/g)).toBeNull()
    expect(forward.match(/create (unique )?index (?!if not exists)/g)).toBeNull()
    expect(matches(forward, /create table if not exists public\.(\w+)/g)).toEqual([...OWN_TABLES])
  })

  it('drops each trigger and policy before creating it', () => {
    for (const name of matches(forward, /create trigger (\w+)/g)) {
      expect(forward, name).toMatch(new RegExp(`drop trigger if exists ${name} on`))
    }
    for (const name of matches(forward, /create policy (\w+)/g)) {
      expect(forward, name).toMatch(new RegExp(`drop policy if exists ${name} on`))
    }
  })

  it('defines every function with create or replace', () => {
    expect(forward.match(/create function/g)).toBeNull()
    expect(matches(forward, /create or replace function public\.(\w+)/g).sort()).toEqual([
      'hw_create_shipment', 'hw_manifest_refuse', 'hw_shipment_container_guard', 'hw_shipments_guard',
      'hw_shipments_release_containers', 'hw_transition_shipment',
    ])
  })
})

describe('migration 317: rollback drops what 317 created, and only that', () => {
  const droppedTables = matches(rollback, /drop table if exists public\.(\w+)/g)
  const droppedFunctions = matches(rollback, /drop function if exists public\.(\w+)/g)

  it('drops both tables, the junction first', () => {
    expect(droppedTables).toEqual(['hazardous_waste_shipment_containers', 'hazardous_waste_shipments'])
    expect(rollback).not.toMatch(/drop table (?!if exists)/)
  })

  it('drops every function the migration defines and no other', () => {
    expect(droppedFunctions.sort()).toEqual(matches(forward, /create or replace function public\.(\w+)/g).sort())
    expect(rollback).not.toMatch(/drop function (?!if exists)/)
  })

  it('puts containers back to closed before the lists that explain why are dropped', () => {
    const restore = rollback.indexOf('update public.hazardous_waste_containers set status = \'closed\'')
    expect(restore).toBeGreaterThan(-1)
    expect(restore).toBeLessThan(rollback.indexOf('drop table'))
    expect(rollback).toContain("where status = 'in_shipment'")
  })

  it('touches the older tables only to restore that status', () => {
    const touches = rollback.match(/(update|delete from|insert into) public\.hazardous_waste_\w+/g) ?? []
    expect(touches).toEqual(['update public.hazardous_waste_containers'])
  })
})

describe('migration 317: access', () => {
  it('turns row-level security on for both tables', () => {
    for (const table of OWN_TABLES) expect(forward).toContain(`alter table public.${table}`)
    expect(forward.match(/enable row level security/g)).toHaveLength(2)
  })

  it('has a policy per command: members read and create, the creator or an admin updates, admins delete', () => {
    expect(matches(forward, /create policy (\w+)/g).sort()).toEqual([
      'hw_shipment_containers_admin_delete', 'hw_shipment_containers_creator_or_admin_insert',
      'hw_shipment_containers_creator_or_admin_update', 'hw_shipment_containers_read',
      'hw_shipments_admin_delete', 'hw_shipments_creator_or_admin_update', 'hw_shipments_member_insert', 'hw_shipments_read',
    ])
  })

  it('has no policy for all commands, so no member can delete through a catch-all', () => {
    expect(forward).not.toMatch(/create policy \w+ on [^;]*\bfor all\b/)
  })

  it('every policy is for authenticated users only', () => {
    for (const policy of forward.match(/create policy [^;]*;/g) ?? []) expect(policy, policy.slice(0, 60)).toMatch(/to authenticated/)
  })

  it('every delete policy is for admins', () => {
    for (const name of ['hw_shipments_admin_delete', 'hw_shipment_containers_admin_delete']) {
      expect(policyNamed(name), name).toContain('current_user_admin_tenant_ids()')
    }
  })

  it('a new manifest is a draft in the creator\'s own name', () => {
    const insert = policyNamed('hw_shipments_member_insert')
    expect(insert).toContain("status = 'draft'")
    expect(insert).toContain('created_by = auth.uid()')
  })

  it('an update is for the creator who is still a member, or an admin', () => {
    const update = policyNamed('hw_shipments_creator_or_admin_update')
    expect(update).toContain('current_user_admin_tenant_ids()')
    expect(update).toContain('created_by = auth.uid()')
  })

  it('every manifest policy is scoped to the active account and the active site', () => {
    for (const name of ['hw_shipments_read', 'hw_shipments_member_insert', 'hw_shipments_creator_or_admin_update', 'hw_shipments_admin_delete']) {
      const policy = policyNamed(name)
      expect(policy, name).toContain('public.active_tenant_id() is null or tenant_id = public.active_tenant_id()')
      expect(policy, name).toContain('public.active_facility_id() is null or facility_id = public.active_facility_id()')
    }
  })

  it('the container list is scoped to the active site through its manifest', () => {
    for (const name of ['hw_shipment_containers_read', 'hw_shipment_containers_creator_or_admin_insert', 'hw_shipment_containers_creator_or_admin_update', 'hw_shipment_containers_admin_delete']) {
      expect(policyNamed(name), name).toContain('s.facility_id = public.active_facility_id()')
    }
  })

  it('the functions run as the caller, so RLS applies to everything they do', () => {
    expect(forward).not.toMatch(/security definer/)
    expect(forward).toContain('security invoker')
    for (const fn of matches(forward, /create or replace function public\.(\w+)/g)) {
      expect(forward, fn).toMatch(new RegExp(`create or replace function public\\.${fn}\\([^)]*\\)[^$]*set search_path = pg_catalog, public`))
    }
  })

  it('only signed-in users may call the functions that change a manifest', () => {
    for (const signature of ['hw_create_shipment(uuid[], jsonb)', 'hw_transition_shipment(uuid, text, date, text)', 'hw_manifest_refuse(text, text)']) {
      const escaped = signature.replace(/[()[\]]/g, '\\$&')
      expect(forward).toMatch(new RegExp(`revoke all on function public\\.${escaped}\\s+from public, anon`))
      expect(forward).toMatch(new RegExp(`grant execute on function public\\.${escaped}\\s+to authenticated`))
    }
  })
})

describe('migration 317: the rest of the design', () => {
  it('binds a manifest to its site by a composite foreign key, as 312-314 do', () => {
    expect(forward).toContain('foreign key (tenant_id, facility_id) references public.facilities(tenant_id, id) on delete cascade')
  })

  it('defaults the site to the active one, so an insert through the API is stamped', () => {
    expect(forward).toContain('facility_id uuid not null default public.active_facility_id()')
  })

  it('keeps the audit trigger and the touch trigger', () => {
    expect(forward).toContain("execute function public.log_audit('id')")
    expect(forward).toContain('execute function public.touch_updated_at()')
  })

  it('covers the queries the screens and the clock make with indexes', () => {
    expect(forward).toContain('(tenant_id, facility_id, status)')
    expect(forward).toContain("(tenant_id, shipped_on) where status = 'shipped'")
  })

  it('keeps a container on one open manifest with a partial unique index', () => {
    expect(forward).toContain('create unique index if not exists uq_hw_shipment_containers_on_manifest')
    expect(forward).toContain('(container_id) where released_at is null')
  })

  it('does not restrict a container\'s delete, which would break removing an account', () => {
    expect(forward).not.toMatch(/on delete restrict/)
    expect(forward).toContain('container_id uuid not null references public.hazardous_waste_containers(id),')
  })

  it('locks the containers in a fixed order before reading their status, so two manifests over the same containers cannot both take them or deadlock', () => {
    // Two sessions cannot be run against one PGlite connection, so the property is pinned in the text.
    const lock = forward.indexOf('order by c.id for update')
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(forward.indexOf("c.status <> 'closed'"))
  })

  it('the manifest is a draft with no dates, and past draft its dates are checked', () => {
    for (const name of ['hw_shipments_tracking_once_past_draft', 'hw_shipments_shipped_on_required', 'hw_shipments_completed_on_required',
      'hw_shipments_exception_on_required', 'hw_shipments_completed_after_shipped', 'hw_shipments_exception_after_shipped',
      'hw_shipments_draft_has_no_dates']) {
      expect(forward, name).toContain(`constraint ${name}`)
    }
  })
})

describe('migration 317 and @soteria/core agree', () => {
  it('the tracking number and EPA ID patterns are the same text', () => {
    expect(forward).toContain(`manifest_tracking_number ~ '${MANIFEST_TRACKING_NUMBER_RE.source}'`)
    for (const column of ['generator_epa_id', 'transporter_epa_id', 'tsdf_epa_id']) {
      expect(forward, column).toContain(`${column} ~ '${EPA_ID_RE.source}'`)
    }
  })

  it('the status list is the same', () => {
    expect(forward).toContain(`status in (${MANIFEST_STATUSES.map(s => `'${s}'`).join(', ')})`)
  })

  it('the jurisdiction pattern accepts federal and a state code', () => {
    expect(forward).toContain("jurisdiction ~ '^(federal|state:[A-Z]{2})$'")
  })

  it('the actions the function accepts are the ones core lists', () => {
    expect(forward).toContain(`p_action not in (${MANIFEST_ACTIONS.map(a => `'${a}'`).join(', ')})`)
  })

  it('the limits are the same', () => {
    expect(forward).toContain(`cardinality(v_ids) > ${MANIFEST_MAX_CONTAINERS}`)
    expect(forward).toContain(`cardinality(waste_codes) <= ${MANIFEST_MAX_WASTE_CODES}`)
  })
})
