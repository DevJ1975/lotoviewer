// @vitest-environment node
//
// Migration 318 (environmental monitoring: discharge limits and sample results) applied on top of
// the ISO 14001 EMS and the Environmental Compliance Suite, against a real Postgres (PGlite),
// exercised as real users. What matters here is what the database holds whoever asks:
//
//   * a limit or a result names an outfall (and a limit a permit) only at its own site,
//   * a sample result can be added by any member but changed or removed only by a tenant admin,
//   * only tenant admins write limits, and a plain member cannot,
//   * adopting a library limit twice adds nothing, including for the site-wide slot,
//   * a result's evidence file sits in the tenant's own folder,
//   * the rollback removes what 318 added and nothing another migration owns.
//
// SQLSTATEs: 23503 foreign_key_violation  23505 unique_violation  23514 check_violation
//            42501 insufficient_privilege

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { IDS, asCaller, migrationSql, scalar } from './_emsTestDatabase'
import { createSuiteDatabase, rollbackOf } from './_suiteTestDatabase'

const MIGRATION = '318_environmental_monitoring.sql'
const DB_SETUP_TIMEOUT_MS = 180_000
const TA = IDS.tenantA
const TB = IDS.tenantB
const MEMBER_C = '00000000-0000-4000-8000-0000000000c3'   // a second plain member of tenant A
const SUPERADMIN = '00000000-0000-4000-8000-0000000000e5'
const DUAL = '00000000-0000-4000-8000-0000000000d7'   // administers tenant A, and is only a member of tenant B

const ownerA   = { userId: IDS.ownerA,  tenantId: TA }
const memberA  = { userId: IDS.memberA, tenantId: TA }
const memberC  = { userId: MEMBER_C,    tenantId: TA }
const adminBInA = { userId: IDS.adminB, tenantId: TA }   // an admin of ANOTHER account working in this one's context
const superadmin = { userId: SUPERADMIN, tenantId: TA }
const dualAcrossTenants = { userId: DUAL }   // no active tenant: the roll-up

let db: PGlite
let siteA: string
let siteB: string
let siteOfTenantB: string
let outfallA1: string
let outfallA2: string
let outfallB1: string
let outfallOfTenantB: string
let permitA: string
let seq = 0

async function insert(client: PGlite, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row)
  const result = await client.query<{ id: string }>(
    `insert into public.${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    columns.map(column => row[column]),
  )
  return result.rows[0]!.id
}

const limitRow = (fields: Record<string, unknown> = {}) => ({
  tenant_id: TA, facility_id: siteA, outfall_id: null, parameter: 'TSS', unit: 'mg/L', limit_kind: 'instantaneous_max',
  value: 100, basis: 'benchmark', ...fields,
})
const resultRow = (fields: Record<string, unknown> = {}) => ({
  tenant_id: TA, facility_id: siteA, outfall_id: outfallA1, parameter: 'TSS', unit: 'mg/L', value: 42,
  sampled_at: '2026-02-03T10:00:00Z', sampled_by: IDS.memberA, ...fields,
})

const limit = (fields: Record<string, unknown> = {}) => insert(db, 'monitoring_limits', limitRow(fields))
const result = (fields: Record<string, unknown> = {}) => insert(db, 'monitoring_results', resultRow(fields))

/**
 * An insert that asks for nothing back. With RETURNING, the new row must also pass the read policy,
 * which would refuse a wrong-site or wrong-tenant insert on its own; without it, only the insert
 * policy is on trial.
 */
const insertQuietly = (table: string, row: Record<string, unknown>) => {
  const columns = Object.keys(row)
  return db.query(`insert into public.${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')})`, columns.map(c => row[c]))
}
const limitQuietly = (fields: Record<string, unknown> = {}) => insertQuietly('monitoring_limits', limitRow(fields))
const resultQuietly = (fields: Record<string, unknown> = {}) => insertQuietly('monitoring_results', resultRow(fields))

const libraryLimit = (fields: Record<string, unknown> = {}) => limit({
  source: 'library', library_key: 'ca-igp-tss-annual', citation: 'IGP Table 2', verify: 'Confirm against the permit.', ...fields,
})

async function count(sql: string, params: unknown[] = []): Promise<number> {
  return Number(await scalar(db, sql, params))
}

/** The rows a caller can see in a table, by id, so a policy is judged by what it shows. */
const visible = (caller: Parameters<typeof asCaller>[1], table: string, id: string) =>
  asCaller(db, caller, async () => (await db.query(`select id from public.${table} where id = $1`, [id])).rows.length)

beforeAll(async () => {
  db = await createSuiteDatabase({ extra: [MIGRATION] })
  await db.exec(`
    insert into auth.users (id, email) values ('${MEMBER_C}', 'member-c@example.test'), ('${SUPERADMIN}', 'super@example.test'), ('${DUAL}', 'dual@example.test');
    insert into public.profiles (id, email, is_superadmin) values ('${MEMBER_C}', 'member-c@example.test', false), ('${SUPERADMIN}', 'super@example.test', true), ('${DUAL}', 'dual@example.test', false);
    insert into public.tenant_memberships (user_id, tenant_id, role) values ('${MEMBER_C}', '${TA}', 'member'), ('${DUAL}', '${TA}', 'admin'), ('${DUAL}', '${TB}', 'member');
  `)
  siteA = (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [TA]))!
  siteOfTenantB = (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [TB]))!
  siteB = await insert(db, 'facilities', { tenant_id: TA, name: 'Site B', code: 'SB', is_primary: false })
  outfallA1 = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, code: 'OF-A1' })
  outfallA2 = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, code: 'OF-A2' })
  outfallB1 = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteB, code: 'OF-B1' })
  outfallOfTenantB = await insert(db, 'stormwater_outfalls', { tenant_id: TB, facility_id: siteOfTenantB, code: 'OF-TB' })
  permitA = await insert(db, 'environmental_permits', {
    tenant_id: TA, facility_id: siteA, program: 'stormwater', title: 'Industrial General Permit', agency: 'State Water Board',
    permit_number: 'P-318', jurisdiction: 'state:CA', holder_of_record: 'Tenant A',
  })
}, DB_SETUP_TIMEOUT_MS)

afterAll(async () => { await db?.close() })

describe('applying and rolling back', () => {
  it('can be applied a second time without error and without duplicating a policy', async () => {
    const policies = () => count(`select count(*) from pg_policies where tablename in ('monitoring_limits', 'monitoring_results')`)
    const before = await policies()
    await db.exec(migrationSql(MIGRATION))
    expect(await policies()).toBe(before)
    expect(before).toBe(6)
  })

  it('adds the same-site key to stormwater_outfalls, which 313 did not have', async () => {
    expect(await count(`select count(*) from pg_constraint where conrelid = 'public.stormwater_outfalls'::regclass and conname = 'stormwater_outfalls_tenant_facility_id_key'`)).toBe(1)
  })

  it('rolls back what it added and nothing else: no outfall, permit, policy or constraint of another migration changes', async () => {
    const other = await createSuiteDatabase({ extra: [MIGRATION] })
    try {
      const site = (await scalar<string>(other, 'select id from public.facilities where tenant_id = $1 and is_primary', [TA]))!
      const outfall = await insert(other, 'stormwater_outfalls', { tenant_id: TA, facility_id: site, code: 'OF-RB' })
      await insert(other, 'monitoring_results', { tenant_id: TA, facility_id: site, outfall_id: outfall, parameter: 'pH', unit: 's.u.', value: 7, sampled_at: '2026-02-03T10:00:00Z' })
      await insert(other, 'monitoring_limits', { tenant_id: TA, facility_id: site, outfall_id: outfall, parameter: 'pH', unit: 's.u.', limit_kind: 'instantaneous_max', value: 9, basis: 'permit_limit' })

      const inventory = async () => ({
        policies:    (await other.query(`select tablename, policyname from pg_policies where tablename not like 'monitoring\\_%' order by 1, 2`)).rows,
        constraints: (await other.query(`select conrelid::regclass::text as t, conname from pg_constraint where connamespace = 'public'::regnamespace and conrelid::regclass::text not like 'monitoring\\_%' and conname <> 'stormwater_outfalls_tenant_facility_id_key' order by 1, 2`)).rows,
        outfalls:    (await other.query(`select id, code from public.stormwater_outfalls order by id`)).rows,
        permits:     (await other.query(`select id from public.environmental_permits order by id`)).rows,
      })
      const before = await inventory()

      await other.exec(migrationSql(rollbackOf(MIGRATION)))

      expect(await inventory()).toEqual(before)
      expect(await scalar(other, `select to_regclass('public.monitoring_limits')::text`)).toBeNull()
      expect(await scalar(other, `select to_regclass('public.monitoring_results')::text`)).toBeNull()
      expect(await scalar(other, `select count(*) from pg_constraint where conname = 'stormwater_outfalls_tenant_facility_id_key'`)).toBe(0)
      expect(await scalar(other, `select count(*) from pg_constraint where conname = 'environmental_permits_tenant_facility_id_key'`)).toBe(1)

      await other.exec(migrationSql(rollbackOf(MIGRATION)))   // idempotent
      await other.exec(migrationSql(MIGRATION))               // and applies again
      expect(await scalar(other, `select to_regclass('public.monitoring_results')::text`)).toBe('monitoring_results')
    } finally {
      await other.close()
    }
  }, DB_SETUP_TIMEOUT_MS)
})

describe('a limit: what the table refuses', () => {
  it('takes a valid limit and fills in its defaults', async () => {
    const id = await limit()
    expect(await db.query('select source, library_key, effective_from, created_at is not null as stamped from public.monitoring_limits where id = $1', [id]))
      .toMatchObject({ rows: [{ source: 'tenant', library_key: null, effective_from: null, stamped: true }] })
  })

  it('refuses a limit kind or a basis it does not know', async () => {
    await expect(limit({ limit_kind: 'weekly_max' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ basis: 'guideline' })).rejects.toMatchObject({ code: '23514' })
    for (const kind of ['instantaneous_max', 'instantaneous_min', 'daily_max', 'monthly_average', 'annual_average']) await expect(limit({ limit_kind: kind })).resolves.toBeTruthy()
    for (const basis of ['permit_limit', 'benchmark', 'numeric_action_level', 'local_limit', 'self_imposed']) await expect(limit({ basis })).resolves.toBeTruthy()
  })

  it('refuses a negative value, a blank or over-long parameter or unit, and an over-long citation or verify note', async () => {
    await expect(limit({ value: -1 })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ value: 0 })).resolves.toBeTruthy()
    await expect(limit({ parameter: '   ' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ parameter: 'p'.repeat(81) })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ unit: '' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ unit: 'u'.repeat(21) })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ citation: 'c'.repeat(301) })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ verify: 'v'.repeat(1001) })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ parameter: 'p'.repeat(80), unit: 'u'.repeat(20), citation: 'c'.repeat(300) })).resolves.toBeTruthy()
  })

  it('refuses effective dates out of order, and allows open ends and a single day', async () => {
    await expect(limit({ effective_from: '2026-07-01', effective_to: '2026-06-30' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ effective_from: '2026-07-01', effective_to: '2026-07-01' })).resolves.toBeTruthy()
    await expect(limit({ effective_from: '2026-07-01' })).resolves.toBeTruthy()
    await expect(limit({ effective_to: '2026-07-01' })).resolves.toBeTruthy()
  })

  it('has a library key exactly when its source is the library, and a library row always cites', async () => {
    await expect(limit({ source: 'library', library_key: null, citation: 'x' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ source: 'tenant', library_key: 'k' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ source: 'library', library_key: `k-${++seq}`, citation: null })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ source: 'other' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ source: 'library', library_key: 'Has Space', citation: 'x' })).rejects.toMatchObject({ code: '23514' })
    await expect(limit({ source: 'library', library_key: `k-${++seq}`, citation: 'IGP' })).resolves.toBeTruthy()
  })
})

describe('a limit or a result names an outfall only at its own site', () => {
  it('accepts an outfall at the same site, and none at all (a site-wide limit, a site-level sample)', async () => {
    await expect(limit({ outfall_id: outfallA1 })).resolves.toBeTruthy()
    await expect(limit({ outfall_id: null })).resolves.toBeTruthy()
    await expect(result({ outfall_id: outfallA1 })).resolves.toBeTruthy()
    await expect(result({ outfall_id: null })).resolves.toBeTruthy()
  })

  it('refuses another site\'s outfall, however the id was come by', async () => {
    await expect(limit({ outfall_id: outfallB1 })).rejects.toMatchObject({ code: '23503' })
    await expect(result({ outfall_id: outfallB1 })).rejects.toMatchObject({ code: '23503' })
    await expect(limit({ facility_id: siteB, outfall_id: outfallA1 })).rejects.toMatchObject({ code: '23503' })
    await expect(result({ facility_id: siteB, outfall_id: outfallA1 })).rejects.toMatchObject({ code: '23503' })
    await expect(limit({ facility_id: siteB, outfall_id: outfallB1 })).resolves.toBeTruthy()
  })

  it('refuses another tenant\'s outfall, and an outfall that does not exist', async () => {
    await expect(limit({ outfall_id: outfallOfTenantB })).rejects.toMatchObject({ code: '23503' })
    await expect(result({ outfall_id: outfallOfTenantB })).rejects.toMatchObject({ code: '23503' })
    await expect(result({ outfall_id: '99999999-9999-4999-8999-999999999999' })).rejects.toMatchObject({ code: '23503' })
  })

  it('refuses a site that is not the tenant\'s own', async () => {
    await expect(limit({ facility_id: siteOfTenantB })).rejects.toMatchObject({ code: '23503' })
    await expect(result({ facility_id: siteOfTenantB, outfall_id: null })).rejects.toMatchObject({ code: '23503' })
  })

  it('accepts a permit at the same site and refuses one held at another site', async () => {
    await expect(limit({ permit_id: permitA, basis: 'permit_limit' })).resolves.toBeTruthy()
    await expect(limit({ facility_id: siteB, permit_id: permitA, basis: 'permit_limit' })).rejects.toMatchObject({ code: '23503' })
  })

  it('clears only the permit, never the site, if a permit row ever goes', async () => {
    const permit = await insert(db, 'environmental_permits', {
      tenant_id: TA, facility_id: siteA, program: 'stormwater', title: 'Short-lived', agency: 'Agency', permit_number: `S-${++seq}`,
      jurisdiction: 'federal', holder_of_record: 'Tenant A',
    })
    const id = await limit({ permit_id: permit, basis: 'permit_limit' })
    await db.query('delete from public.environmental_permits where id = $1', [permit])
    expect((await db.query('select permit_id, facility_id, tenant_id from public.monitoring_limits where id = $1', [id])).rows)
      .toEqual([{ permit_id: null, facility_id: siteA, tenant_id: TA }])
  })
})

describe('deleting what limits and results point at', () => {
  it('refuses to delete an outfall that has results or limits: neither is cascaded nor reattached to the site', async () => {
    const withResult = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, code: `DEL-R-${++seq}` })
    const withLimit = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, code: `DEL-L-${++seq}` })
    const sample = await result({ outfall_id: withResult })
    const cap = await limit({ outfall_id: withLimit })

    await expect(db.query('delete from public.stormwater_outfalls where id = $1', [withResult])).rejects.toMatchObject({ code: '23503' })
    await expect(db.query('delete from public.stormwater_outfalls where id = $1', [withLimit])).rejects.toMatchObject({ code: '23503' })

    expect((await db.query('select outfall_id from public.monitoring_results where id = $1', [sample])).rows).toEqual([{ outfall_id: withResult }])
    expect((await db.query('select outfall_id from public.monitoring_limits where id = $1', [cap])).rows).toEqual([{ outfall_id: withLimit }])
  })

  it('lets an outfall with nothing recorded go', async () => {
    const outfall = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, code: `DEL-${++seq}` })
    await expect(db.query('delete from public.stormwater_outfalls where id = $1', [outfall])).resolves.toBeTruthy()
  })

  it('clears a whole site with its outfalls, limits and results in one delete', async () => {
    const site = await insert(db, 'facilities', { tenant_id: TA, name: 'Closing site', code: `CL${++seq}`, is_primary: false })
    const outfall = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: site, code: 'OF-CL' })
    await limit({ facility_id: site, outfall_id: outfall })
    await limit({ facility_id: site, outfall_id: null })
    await result({ facility_id: site, outfall_id: outfall })

    await db.query('delete from public.facilities where id = $1', [site])

    for (const table of ['stormwater_outfalls', 'monitoring_limits', 'monitoring_results']) {
      expect(await count(`select count(*) from public.${table} where facility_id = $1`, [site]), table).toBe(0)
    }
  })

  it('clears a whole tenant\'s monitoring when the tenant goes', async () => {
    const tenant = (await db.query<{ id: string }>(`insert into public.tenants (slug, name) values ('closing-${++seq}', 'Closing') returning id`)).rows[0]!.id
    const site = await insert(db, 'facilities', { tenant_id: tenant, name: 'Only site', code: `ON${seq}`, is_primary: true })
    const outfall = await insert(db, 'stormwater_outfalls', { tenant_id: tenant, facility_id: site, code: 'OF-T' })
    await limit({ tenant_id: tenant, facility_id: site, outfall_id: outfall })
    await result({ tenant_id: tenant, facility_id: site, outfall_id: outfall })

    await db.query('delete from public.tenants where id = $1', [tenant])

    expect(await count('select count(*) from public.monitoring_results where tenant_id = $1', [tenant])).toBe(0)
    expect(await count('select count(*) from public.monitoring_limits where tenant_id = $1', [tenant])).toBe(0)
  })

  it('keeps a result when the person who took it is removed, and forgets who', async () => {
    const user = '00000000-0000-4000-8000-0000000000f6'
    await db.query(`insert into auth.users (id, email) values ($1, 'leaver@example.test')`, [user])
    const id = await result({ sampled_by: user })
    await db.query('delete from auth.users where id = $1', [user])
    expect((await db.query('select sampled_by from public.monitoring_results where id = $1', [id])).rows).toEqual([{ sampled_by: null }])
  })
})

describe('adopting a library limit twice adds nothing', () => {
  it('refuses the same key twice for the site-wide slot: no outfall is one slot, not many', async () => {
    const key = `ca-igp-tss-${++seq}`
    await libraryLimit({ library_key: key, outfall_id: null })
    await expect(libraryLimit({ library_key: key, outfall_id: null })).rejects.toMatchObject({ code: '23505' })
  })

  it('refuses the same key twice for one outfall, and lets each outfall and each site hold its own copy', async () => {
    const key = `ca-igp-og-${++seq}`
    await libraryLimit({ library_key: key, outfall_id: outfallA1 })
    await expect(libraryLimit({ library_key: key, outfall_id: outfallA1 })).rejects.toMatchObject({ code: '23505' })
    await expect(libraryLimit({ library_key: key, outfall_id: outfallA2 })).resolves.toBeTruthy()
    await expect(libraryLimit({ library_key: key, outfall_id: null })).resolves.toBeTruthy()
    await expect(libraryLimit({ library_key: key, facility_id: siteB, outfall_id: null })).resolves.toBeTruthy()
    await expect(libraryLimit({ library_key: key, tenant_id: TB, facility_id: siteOfTenantB, outfall_id: null })).resolves.toBeTruthy()
  })

  it('lets different keys sit side by side', async () => {
    await libraryLimit({ library_key: `ca-igp-a-${++seq}` })
    await expect(libraryLimit({ library_key: `ca-igp-b-${++seq}` })).resolves.toBeTruthy()
  })

  it('does not limit limits a tenant enters itself: the same parameter may appear many times', async () => {
    await limit({ parameter: 'Zinc' })
    await expect(limit({ parameter: 'Zinc' })).resolves.toBeTruthy()
  })
})

describe('a result: what the table refuses', () => {
  it('takes a valid result and fills in its defaults', async () => {
    const id = await result()
    expect((await db.query('select below_detection, event_label, lab, evidence_id, created_at is not null as stamped from public.monitoring_results where id = $1', [id])).rows)
      .toEqual([{ below_detection: false, event_label: null, lab: null, evidence_id: null, stamped: true }])
  })

  it('refuses a negative value, and takes zero (a reading of nothing is still a reading)', async () => {
    await expect(result({ value: -0.01 })).rejects.toMatchObject({ code: '23514' })
    await expect(result({ value: 0 })).resolves.toBeTruthy()
  })

  it('refuses a missing time or value, and a blank parameter or unit', async () => {
    await expect(result({ sampled_at: null })).rejects.toMatchObject({ code: '23502' })
    await expect(result({ value: null })).rejects.toMatchObject({ code: '23502' })
    await expect(result({ parameter: ' ' })).rejects.toMatchObject({ code: '23514' })
    await expect(result({ unit: '' })).rejects.toMatchObject({ code: '23514' })
  })

  it('bounds the free text it keeps', async () => {
    await expect(result({ lab: 'l'.repeat(121) })).rejects.toMatchObject({ code: '23514' })
    await expect(result({ event_label: 'e'.repeat(121) })).rejects.toMatchObject({ code: '23514' })
    await expect(result({ note: 'n'.repeat(2001) })).rejects.toMatchObject({ code: '23514' })
    await expect(result({ lab: 'l'.repeat(120), event_label: 'e'.repeat(120), note: 'n'.repeat(2000) })).resolves.toBeTruthy()
  })

  describe('its evidence file', () => {
    it('must sit in the tenant\'s own folder', async () => {
      await expect(result({ evidence_id: `${TA}/monitoring/lab-1.pdf` })).resolves.toBeTruthy()
      await expect(result({ evidence_id: `${TB}/monitoring/lab-1.pdf` })).rejects.toMatchObject({ code: '23514' })
      await expect(result({ evidence_id: 'monitoring/lab-1.pdf' })).rejects.toMatchObject({ code: '23514' })
    })

    it('must name a file inside that folder, with the separator: the tenant id alone or as a prefix of a longer name is not it', async () => {
      await expect(result({ evidence_id: TA })).rejects.toMatchObject({ code: '23514' })
      await expect(result({ evidence_id: `${TA}x/file.pdf` })).rejects.toMatchObject({ code: '23514' })
      await expect(result({ evidence_id: '' })).rejects.toMatchObject({ code: '23514' })
    })

    it('may not climb out of the folder', async () => {
      await expect(result({ evidence_id: `${TA}/../${TB}/lab.pdf` })).rejects.toMatchObject({ code: '23514' })
      await expect(result({ evidence_id: `${TA}/a..b.pdf` })).rejects.toMatchObject({ code: '23514' })
    })

    it('is at most 300 characters', async () => {
      const path = (length: number) => `${TA}/${'a'.repeat(length - TA.length - 1)}`
      await expect(result({ evidence_id: path(300) })).resolves.toBeTruthy()
      await expect(result({ evidence_id: path(301) })).rejects.toMatchObject({ code: '23514' })
    })
  })
})

describe('limits: who may read and write', () => {
  it('lets every member of the tenant read the site\'s limits, and nobody from outside', async () => {
    const id = await limit()
    expect(await visible(ownerA, 'monitoring_limits', id)).toBe(1)
    expect(await visible(memberA, 'monitoring_limits', id)).toBe(1)
    expect(await visible(memberC, 'monitoring_limits', id)).toBe(1)
    expect(await visible(adminBInA, 'monitoring_limits', id)).toBe(0)
    expect(await visible({ userId: IDS.adminB, tenantId: TB }, 'monitoring_limits', id)).toBe(0)
  })

  it('shows nothing of this tenant to someone working in another tenant\'s context, even a member of both', async () => {
    const id = await limit()
    const sample = await result()
    expect(await visible({ userId: IDS.ownerA, tenantId: TB }, 'monitoring_limits', id)).toBe(0)
    expect(await visible({ userId: IDS.ownerA, tenantId: TB }, 'monitoring_results', sample)).toBe(0)
    expect(await visible({ userId: IDS.ownerA, tenantId: TA }, 'monitoring_results', sample)).toBe(1)
  })

  it('lets a tenant admin write limits, and a plain member neither add nor change nor remove one', async () => {
    const id = await asCaller(db, ownerA, () => limit({ parameter: 'Admin wrote this' }))
    expect(id).toBeTruthy()

    await expect(asCaller(db, memberA, () => limitQuietly({ parameter: 'Member wrote this' }))).rejects.toMatchObject({ code: '42501' })

    const changed = await asCaller(db, memberA, () => db.query(`update public.monitoring_limits set value = 1 where id = $1`, [id]))
    expect(changed.affectedRows).toBe(0)
    const removed = await asCaller(db, memberA, () => db.query(`delete from public.monitoring_limits where id = $1`, [id]))
    expect(removed.affectedRows).toBe(0)
    expect(await scalar(db, 'select value::int from public.monitoring_limits where id = $1', [id])).toBe(100)

    const adminChanged = await asCaller(db, ownerA, () => db.query(`update public.monitoring_limits set value = 120 where id = $1`, [id]))
    expect(adminChanged.affectedRows).toBe(1)
    const adminRemoved = await asCaller(db, ownerA, () => db.query(`delete from public.monitoring_limits where id = $1`, [id]))
    expect(adminRemoved.affectedRows).toBe(1)
  })

  it('refuses an admin of another account, even working in this account\'s context', async () => {
    await expect(asCaller(db, adminBInA, () => limitQuietly({ parameter: 'Other tenant admin' }))).rejects.toMatchObject({ code: '42501' })
    const id = await limit()
    const changed = await asCaller(db, adminBInA, () => db.query(`update public.monitoring_limits set value = 1 where id = $1`, [id]))
    expect(changed.affectedRows).toBe(0)
  })

  it('refuses a write into a tenant other than the active one, even by an admin of both', async () => {
    await expect(asCaller(db, { userId: IDS.ownerA, tenantId: TB }, () => limitQuietly({ parameter: 'Wrong context' }))).rejects.toMatchObject({ code: '42501' })
  })

  it('shows a member only the site they are working at, and everything in the roll-up', async () => {
    const atA = await limit({ parameter: 'Only A' })
    const atB = await limit({ facility_id: siteB, parameter: 'Only B' })

    expect(await visible({ ...memberA, facilityId: siteA }, 'monitoring_limits', atA)).toBe(1)
    expect(await visible({ ...memberA, facilityId: siteA }, 'monitoring_limits', atB)).toBe(0)
    expect(await visible({ ...memberA, facilityId: siteB }, 'monitoring_limits', atA)).toBe(0)
    expect(await visible({ ...memberA, facilityId: siteB }, 'monitoring_limits', atB)).toBe(1)
    expect(await visible(memberA, 'monitoring_limits', atA)).toBe(1)
    expect(await visible(memberA, 'monitoring_limits', atB)).toBe(1)
  })

  it('keeps an admin at one site from writing a limit for another', async () => {
    await expect(asCaller(db, { ...ownerA, facilityId: siteB }, () => limitQuietly({ facility_id: siteA }))).rejects.toMatchObject({ code: '42501' })
    await expect(asCaller(db, { ...ownerA, facilityId: siteA }, () => limit({ facility_id: siteA, parameter: 'At A' }))).resolves.toBeTruthy()
  })

  it('lets a platform superadmin read and write', async () => {
    const id = await asCaller(db, superadmin, () => limit({ parameter: 'Superadmin wrote this' }))
    expect(await visible(superadmin, 'monitoring_limits', id)).toBe(1)
  })
})

describe('results: who may read, add, change and remove', () => {
  it('lets every member read the site\'s results, and nobody from outside', async () => {
    const id = await result()
    expect(await visible(ownerA, 'monitoring_results', id)).toBe(1)
    expect(await visible(memberC, 'monitoring_results', id)).toBe(1)
    expect(await visible(adminBInA, 'monitoring_results', id)).toBe(0)
    expect(await visible({ userId: IDS.adminB, tenantId: TB }, 'monitoring_results', id)).toBe(0)
  })

  it('lets a plain member add a result as themselves', async () => {
    const id = await asCaller(db, memberA, () => result({ sampled_by: IDS.memberA, note: 'Grab sample' }))
    expect(await scalar(db, 'select sampled_by from public.monitoring_results where id = $1', [id])).toBe(IDS.memberA)
  })

  it('refuses a result that names someone else as the sampler, or nobody', async () => {
    await expect(asCaller(db, memberA, () => resultQuietly({ sampled_by: IDS.ownerA }))).rejects.toMatchObject({ code: '42501' })
    await expect(asCaller(db, memberA, () => resultQuietly({ sampled_by: null }))).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a plain member who tries to change a result, even their own: it is a record', async () => {
    const id = await asCaller(db, memberA, () => result({ sampled_by: IDS.memberA, value: 42 }))
    const changed = await asCaller(db, memberA, () => db.query(`update public.monitoring_results set value = 1 where id = $1`, [id]))
    const moved = await asCaller(db, memberA, () => db.query(`update public.monitoring_results set sampled_at = '2026-01-01T00:00:00Z' where id = $1`, [id]))
    expect(changed.affectedRows).toBe(0)
    expect(moved.affectedRows).toBe(0)
    expect((await db.query('select value::int as value, sampled_at::text from public.monitoring_results where id = $1', [id])).rows)
      .toEqual([{ value: 42, sampled_at: '2026-02-03 10:00:00+00' }])
  })

  it('refuses a plain member who tries to delete a result, even their own', async () => {
    const id = await asCaller(db, memberA, () => result({ sampled_by: IDS.memberA }))
    const removed = await asCaller(db, memberA, () => db.query(`delete from public.monitoring_results where id = $1`, [id]))
    expect(removed.affectedRows).toBe(0)
    expect(await count('select count(*) from public.monitoring_results where id = $1', [id])).toBe(1)
  })

  it('lets a tenant admin correct and remove a result', async () => {
    const id = await result()
    const changed = await asCaller(db, ownerA, () => db.query(`update public.monitoring_results set value = 43, note = 'Corrected from the lab report' where id = $1`, [id]))
    expect(changed.affectedRows).toBe(1)
    expect(await scalar(db, 'select value::int from public.monitoring_results where id = $1', [id])).toBe(43)
    const removed = await asCaller(db, ownerA, () => db.query(`delete from public.monitoring_results where id = $1`, [id]))
    expect(removed.affectedRows).toBe(1)
  })

  it('does not let an update move a result into another tenant (site and all), another site, or past the evidence rule', async () => {
    const id = await result()
    await expect(asCaller(db, ownerA, () => db.query(
      `update public.monitoring_results set tenant_id = $2, facility_id = $3, outfall_id = null where id = $1`, [id, TB, siteOfTenantB],
    ))).rejects.toMatchObject({ code: '42501' })
    await expect(asCaller(db, { ...ownerA, facilityId: siteA }, () => db.query(
      `update public.monitoring_results set facility_id = $2, outfall_id = null where id = $1`, [id, siteB],
    ))).rejects.toMatchObject({ code: '42501' })
    await expect(asCaller(db, ownerA, () => db.query(`update public.monitoring_results set evidence_id = $2 where id = $1`, [id, `${TB}/x.pdf`]))).rejects.toMatchObject({ code: '23514' })
    expect((await db.query('select tenant_id, facility_id from public.monitoring_results where id = $1', [id])).rows).toEqual([{ tenant_id: TA, facility_id: siteA }])
  })

  it('does not let someone who administers one tenant and is only a member of another move a result between them', async () => {
    const id = await result()
    await expect(asCaller(db, dualAcrossTenants, () => db.query(
      `update public.monitoring_results set tenant_id = $2, facility_id = $3, outfall_id = null where id = $1`, [id, TB, siteOfTenantB],
    ))).rejects.toMatchObject({ code: '42501' })
    expect(await scalar(db, 'select tenant_id from public.monitoring_results where id = $1', [id])).toBe(TA)
    // what that person may do in the tenant they administer is unchanged
    expect((await asCaller(db, dualAcrossTenants, () => db.query(`update public.monitoring_results set value = 7 where id = $1`, [id]))).affectedRows).toBe(1)
  })

  it('refuses an admin of another account: no read, no add, no change, no removal', async () => {
    const id = await result()
    await expect(asCaller(db, adminBInA, () => resultQuietly({ sampled_by: IDS.adminB }))).rejects.toMatchObject({ code: '42501' })
    expect((await asCaller(db, adminBInA, () => db.query(`update public.monitoring_results set value = 1 where id = $1`, [id]))).affectedRows).toBe(0)
    expect((await asCaller(db, adminBInA, () => db.query(`delete from public.monitoring_results where id = $1`, [id]))).affectedRows).toBe(0)
    expect(await count('select count(*) from public.monitoring_results where id = $1', [id])).toBe(1)
  })

  it('refuses a member working in another tenant\'s context', async () => {
    await expect(asCaller(db, { userId: IDS.memberA, tenantId: TB }, () => resultQuietly({ sampled_by: IDS.memberA }))).rejects.toMatchObject({ code: '42501' })
  })

  it('shows and accepts a member\'s results only at the site they are working at', async () => {
    const atA = await result({ outfall_id: outfallA1 })
    const atB = await result({ facility_id: siteB, outfall_id: outfallB1 })

    expect(await visible({ ...memberA, facilityId: siteB }, 'monitoring_results', atA)).toBe(0)
    expect(await visible({ ...memberA, facilityId: siteB }, 'monitoring_results', atB)).toBe(1)
    expect(await visible({ ...memberA, facilityId: siteA }, 'monitoring_results', atB)).toBe(0)

    await expect(asCaller(db, { ...memberA, facilityId: siteB }, () => resultQuietly({ sampled_by: IDS.memberA, facility_id: siteA, outfall_id: null }))).rejects.toMatchObject({ code: '42501' })
    await expect(asCaller(db, { ...memberA, facilityId: siteA }, () => result({ sampled_by: IDS.memberA, facility_id: siteA }))).resolves.toBeTruthy()
  })

  it('lets a platform superadmin add and correct a result', async () => {
    const id = await asCaller(db, superadmin, () => result({ sampled_by: SUPERADMIN }))
    expect((await asCaller(db, superadmin, () => db.query(`update public.monitoring_results set value = 5 where id = $1`, [id]))).affectedRows).toBe(1)
  })
})

describe('the record of changes', () => {
  it('stamps updated_at when a row changes', async () => {
    const id = await result()
    await db.query(`update public.monitoring_results set updated_at = '2000-01-01T00:00:00Z' where id = $1`, [id])
    await db.query(`update public.monitoring_results set note = 'touched' where id = $1`, [id])
    expect(await scalar(db, `select updated_at > '2020-01-01' from public.monitoring_results where id = $1`, [id])).toBe(true)
  })

  it('writes every insert, update and delete of a result and of a limit to the audit log', async () => {
    const sample = await asCaller(db, memberA, () => result({ sampled_by: IDS.memberA }))
    await asCaller(db, ownerA, () => db.query(`update public.monitoring_results set value = 44 where id = $1`, [sample]))
    await asCaller(db, ownerA, () => db.query(`delete from public.monitoring_results where id = $1`, [sample]))
    const cap = await limit()
    await db.query(`delete from public.monitoring_limits where id = $1`, [cap])

    const operations = async (table: string, id: string) =>
      (await db.query<{ operation: string }>(`select operation from public.audit_log where table_name = $1 and row_pk = $2 order by id`, [table, id])).rows.map(r => r.operation)
    expect(await operations('monitoring_results', sample)).toEqual(['INSERT', 'UPDATE', 'DELETE'])
    expect(await operations('monitoring_limits', cap)).toEqual(['INSERT', 'DELETE'])
    expect(await scalar(db, `select actor_id from public.audit_log where table_name = 'monitoring_results' and row_pk = $1 and operation = 'UPDATE'`, [sample])).toBe(IDS.ownerA)
  })
})

describe('policies, read from the catalog', () => {
  const policies = async (table: string) =>
    (await db.query<{ policyname: string; cmd: string; roles: string; qual: string | null; with_check: string | null }>(
      `select policyname, cmd, roles::text as roles, qual, with_check from pg_policies where tablename = $1 order by policyname`, [table],
    )).rows

  it('gives results exactly one policy per command, and only the insert is open to members', async () => {
    const rows = await policies('monitoring_results')
    expect(rows.map(r => [r.policyname, r.cmd])).toEqual([
      ['monitoring_results_admin_delete', 'DELETE'],
      ['monitoring_results_admin_update', 'UPDATE'],
      ['monitoring_results_member_insert', 'INSERT'],
      ['monitoring_results_read', 'SELECT'],
    ])
    for (const row of rows.filter(r => r.cmd === 'UPDATE' || r.cmd === 'DELETE')) {
      expect(row.qual, row.policyname).toContain('current_user_admin_tenant_ids')
      expect(row.qual, row.policyname).not.toMatch(/current_user_tenant_ids/)
    }
  })

  it('gives limits a member read and an admin-only write', async () => {
    const rows = await policies('monitoring_limits')
    expect(rows.map(r => [r.policyname, r.cmd])).toEqual([['monitoring_limits_admin_write', 'ALL'], ['monitoring_limits_read', 'SELECT']])
    const write = rows.find(r => r.cmd === 'ALL')!
    expect(write.qual).toContain('current_user_admin_tenant_ids')
    expect(write.with_check).toContain('current_user_admin_tenant_ids')
  })

  it('applies every policy to authenticated users only', async () => {
    for (const table of ['monitoring_limits', 'monitoring_results']) {
      for (const row of await policies(table)) expect(row.roles, row.policyname).toBe('{authenticated}')
    }
  })
})
