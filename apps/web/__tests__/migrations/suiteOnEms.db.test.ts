// @vitest-environment node
//
// Migrations 311-316 (the Environmental Compliance Suite) applied on top of the ISO 14001
// EMS migrations, against a real Postgres (PGlite), exercised as real users. The two streams
// share tables, so the properties that matter are the ones that break at the seam:
//
//   * nothing the suite adds reopens a table EMS closed (member-writable policies),
//   * a row the suite writes is one the obligations register accepts,
//   * the database itself refuses an outfall under another site's permit,
//   * only the right people can complete a deadline, and never twice,
//   * every rollback leaves what another migration owns alone.
//
// SQLSTATEs: 23503 foreign_key_violation  23514 check_violation  42501 insufficient_privilege
//            P0002 no_data_found

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { advanceDueDate, type ObligationCadence } from '@soteria/core/complianceCalendar'
import { DELETE_ORDER } from '@/lib/demoReset'
import { IDS, asCaller, migrationSql, scalar } from './_emsTestDatabase'
import { SUITE_MIGRATIONS, createSuiteDatabase, rollbackOf } from './_suiteTestDatabase'

const DB_SETUP_TIMEOUT_MS = 180_000
const TA = IDS.tenantA
const TB = IDS.tenantB
const MEMBER_C = '00000000-0000-4000-8000-0000000000c3'   // a plain member who submits checklists
const MEMBER_D = '00000000-0000-4000-8000-0000000000d4'   // owned a deadline and submitted a checklist, then left the account

const ownerA  = { userId: IDS.ownerA,  tenantId: TA }
const memberA = { userId: IDS.memberA, tenantId: TA }
const memberC = { userId: MEMBER_C,    tenantId: TA }
const memberD = { userId: MEMBER_D,    tenantId: TA }
const adminB  = { userId: IDS.adminB,  tenantId: TA }   // an admin of ANOTHER account, working in this one's context

let db: PGlite
let siteA: string
let siteB: string
let template1: string
let template2: string
let seq = 0

async function insert(client: PGlite, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row)
  const result = await client.query<{ id: string }>(
    `insert into public.${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    columns.map(column => row[column]),
  )
  return result.rows[0]!.id
}

const obligation = (fields: Record<string, unknown> = {}) => insert(db, 'compliance_calendar_obligations', {
  tenant_id: TA, facility_id: siteA, title: `Deadline ${++seq}`, next_due_at: '2026-03-31', cadence: 'quarterly', source: 'library',
  system_key: `env:${seq}:${siteA}`, discipline: 'ems', jurisdiction: 'federal', due_anchor: 'period_end', checklist_template_id: template1, ...fields,
})

/** An environmental inspection and the run that ties it to a deadline's occurrence. */
async function checklist(forObligation: string | null, fields: { inspection?: Record<string, unknown>; run?: Record<string, unknown> } = {}): Promise<string> {
  const id = await insert(db, 'inspections', {
    tenant_id: TA, template_id: template1, template_version: 1, title: `Checklist ${++seq}`, status: 'submitted', domain: 'environmental',
    submitted_by: MEMBER_C, facility_id: siteA, submitted_at: new Date().toISOString(), ...fields.inspection,
  })
  await db.query(
    `insert into public.environmental_checklist_runs (inspection_id, tenant_id, facility_id, obligation_id, occurrence_at, attested)
     values ($1, $2, $3, $4, $5, true)`,
    [id, TA, siteA, forObligation, '2026-03-31'],
  )
  if (fields.run) {
    const sets = Object.keys(fields.run).map((column, i) => `${column} = $${i + 2}`).join(', ')
    await db.query(`update public.environmental_checklist_runs set ${sets} where inspection_id = $1`, [id, ...Object.values(fields.run)])
  }
  return id
}

const complete = (caller: Parameters<typeof asCaller>[1], obligationId: string, dueOn: string, extra: { note?: string | null; evidence?: string | null; inspection?: string | null } = {}) =>
  asCaller(db, caller, () => db.query<{ id: string }>(
    'select public.env_complete_obligation($1, $2::date, $3, $4, $5) as id',
    [obligationId, dueOn, extra.note ?? null, extra.evidence ?? null, extra.inspection ?? null],
  ))

async function row<T>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0] as T
}

beforeAll(async () => {
  db = await createSuiteDatabase()
  await db.exec(`
    insert into auth.users (id, email) values ('${MEMBER_C}', 'member-c@example.test'), ('${MEMBER_D}', 'member-d@example.test');
    insert into public.profiles (id, email) values ('${MEMBER_C}', 'member-c@example.test'), ('${MEMBER_D}', 'member-d@example.test');
    insert into public.tenant_memberships (user_id, tenant_id, role) values ('${MEMBER_C}', '${TA}', 'member');
    insert into public.tenant_memberships (user_id, tenant_id, role, invite_cancelled_at) values ('${MEMBER_D}', '${TA}', 'member', now());
  `)
  siteA = (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [TA]))!
  siteB = await insert(db, 'facilities', { tenant_id: TA, name: 'Site B', code: 'SB', is_primary: false })
  template1 = await insert(db, 'inspection_templates', { tenant_id: TA, name: 'QSE sampling' })
  template2 = await insert(db, 'inspection_templates', { tenant_id: TA, name: 'Some other checklist' })
}, DB_SETUP_TIMEOUT_MS)

afterAll(async () => { await db?.close() })

describe('applying and rolling back', () => {
  it('can be applied a second time without error', async () => {
    for (const file of SUITE_MIGRATIONS) await db.exec(migrationSql(file))
  })

  it('rolls back newest first, leaving the permit vault and EMS\'s policies and columns alone, and applies again afterwards', async () => {
    const other = await createSuiteDatabase()
    try {
      for (const file of [...SUITE_MIGRATIONS].slice(1).reverse()) await other.exec(migrationSql(rollbackOf(file)))

      expect(await scalar(other, `select to_regclass('public.environmental_permits')::text`)).toBe('environmental_permits')
      expect(await scalar(other, `select to_regclass('public.stormwater_outfalls')::text`)).toBeNull()
      // 314 must not drop nonconformities.facility_id: it belongs to migration 300 and its policy depends on it.
      expect(await scalar(other, `select count(*) from information_schema.columns where table_name = 'nonconformities' and column_name = 'facility_id'`)).toBe(1)
      expect(await scalar(other, `select count(*) from pg_policies where tablename = 'compliance_calendar_obligations'`)).toBe(2)
      expect(await scalar(other, `select count(*) from pg_constraint where conname = 'environmental_permits_tenant_facility_id_key'`)).toBe(0)

      for (const file of [...SUITE_MIGRATIONS].slice(1)) await other.exec(migrationSql(file))
    } finally {
      await other.close()
    }
  }, DB_SETUP_TIMEOUT_MS)
})

describe('access: nothing the suite adds reopens a table EMS closed', () => {
  it('has no write policy on the obligations, events, outfalls or profiles that is open to plain members', async () => {
    const policies = (await db.query<{ tablename: string; policyname: string; qual: string | null }>(
      `select tablename, policyname, qual from pg_policies
        where tablename in ('compliance_calendar_obligations', 'compliance_calendar_events', 'stormwater_outfalls', 'environmental_site_profiles')
          and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')`,
    )).rows
    expect(policies.length).toBeGreaterThan(0)
    expect(policies.filter(p => !(p.qual ?? '').includes('current_user_admin_tenant_ids')).map(p => `${p.tablename}.${p.policyname}`)).toEqual([])
    expect(policies.map(p => p.policyname)).not.toContain('ccal_obligations_tenant_scope')
  })

  it('refuses a plain member who tries to write a deadline', async () => {
    await expect(asCaller(db, memberA, () => db.query(
      `insert into public.compliance_calendar_obligations (tenant_id, title, next_due_at, source, discipline, jurisdiction)
       values ($1, 'member write', current_date + 30, 'library', 'ems', 'federal')`, [TA],
    ))).rejects.toMatchObject({ code: '42501' })
  })

  it('refuses a plain member who tries to write a completion event directly', async () => {
    const id = await obligation()
    await expect(asCaller(db, memberC, () => db.query(
      'insert into public.compliance_calendar_events (tenant_id, obligation_id, occurrence_at, completed_by) values ($1, $2, $3, $4)',
      [TA, id, '2026-03-31', MEMBER_C],
    ))).rejects.toMatchObject({ code: '42501' })
  })
})

describe('the obligations register accepts what the suite writes', () => {
  it('takes an EMS-shaped library deadline: ISO 14001 register, a legal requirement, state:CA, period-end anchor', async () => {
    const id = await asCaller(db, ownerA, async () => (await db.query<{ id: string }>(
      `insert into public.compliance_calendar_obligations
         (tenant_id, facility_id, title, next_due_at, cadence, source, system_key, discipline, source_kind, jurisdiction, program, library_key, due_anchor, lead_days)
       values ($1, $2, 'CA QSE sampling', '2026-12-31', 'quarterly', 'library', 'env:sw-ca-qse:site', 'ems', 'law', 'state:CA', 'stormwater', 'sw-ca-qse', 'period_end', 14)
       returning id`, [TA, siteA])).rows[0]!.id)
    expect(id).toBeTruthy()
  })

  it('refuses the bare pack key "CA" as a jurisdiction, and an unknown source', async () => {
    await expect(obligation({ jurisdiction: 'CA' })).rejects.toMatchObject({ code: '23514' })
    await expect(obligation({ source: 'bogus' })).rejects.toMatchObject({ code: '23514' })
  })

  it('admits the sources the suite uses next to the register\'s own', async () => {
    for (const source of ['system', 'tenant', 'library', 'ai']) await expect(obligation({ source, system_key: `env:src-${source}-${++seq}` })).resolves.toBeTruthy()
  })
})

describe('outfalls: the database holds the same-site rule', () => {
  it('lets an outfall name a permit at its own site, and none at all', async () => {
    const permit = await insert(db, 'environmental_permits', {
      tenant_id: TA, facility_id: siteA, program: 'stormwater', title: 'Industrial General Permit', agency: 'State Water Board',
      permit_number: `4 19I${++seq}`, jurisdiction: 'state:CA', holder_of_record: 'Tenant A',
    })
    await expect(insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, permit_id: permit, code: `O-${++seq}` })).resolves.toBeTruthy()
    await expect(insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteB, permit_id: null, code: `O-${++seq}` })).resolves.toBeTruthy()
  })

  it('refuses an outfall under a permit held at another site', async () => {
    const permit = await insert(db, 'environmental_permits', {
      tenant_id: TA, facility_id: siteA, program: 'stormwater', title: 'Permit at A', agency: 'Agency', permit_number: `P-${++seq}`,
      jurisdiction: 'federal', holder_of_record: 'Tenant A',
    })
    await expect(insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteB, permit_id: permit, code: `O-${++seq}` }))
      .rejects.toMatchObject({ code: '23503' })
  })

  it('keeps the link when a permit is retired, and if a permit row ever goes clears only the permit, not the site', async () => {
    const permit = await insert(db, 'environmental_permits', {
      tenant_id: TA, facility_id: siteA, program: 'air', title: 'Air permit', agency: 'Air District', permit_number: `A-${++seq}`,
      jurisdiction: 'federal', holder_of_record: 'Tenant A',
    })
    const outfall = await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, permit_id: permit, code: `O-${++seq}` })
    await db.query(`update public.environmental_permits set retired_at = now(), retired_reason = 'replaced' where id = $1`, [permit])
    expect(await row<{ permit_id: string }>('select permit_id from public.stormwater_outfalls where id = $1', [outfall])).toMatchObject({ permit_id: permit })

    await db.query('delete from public.environmental_permits where id = $1', [permit])
    expect(await row('select permit_id, facility_id from public.stormwater_outfalls where id = $1', [outfall])).toEqual({ permit_id: null, facility_id: siteA })
  })
})

describe('completing a deadline (env_complete_obligation)', () => {
  describe('who may', () => {
    it('lets the member who submitted the checklist complete its deadline, moving a period-end deadline to the next period end', async () => {
      const ob = await obligation()
      const inspection = await checklist(ob)
      const event = (await complete(memberC, ob, '2026-03-31', { note: ' Sampled all drains ', inspection })).rows[0]!.id

      expect(await row('select next_due_at::text, status from public.compliance_calendar_obligations where id = $1', [ob]))
        .toEqual({ next_due_at: '2026-06-30', status: 'open' })
      expect(await row('select completed_by, inspection_id, occurrence_at::text, note from public.compliance_calendar_events where id = $1', [event]))
        .toEqual({ completed_by: MEMBER_C, inspection_id: inspection, occurrence_at: '2026-03-31', note: 'Sampled all drains' })
    })

    it('lets a deadline\'s owner, and any admin, complete it without a checklist', async () => {
      const owned = await obligation({ owner_user_id: IDS.memberA, cadence: 'annual', next_due_at: '2026-06-15', due_anchor: 'fixed' })
      await complete(memberA, owned, '2026-06-15')
      const adminDone = await obligation({ cadence: 'annual', next_due_at: '2026-06-15', due_anchor: 'fixed' })
      await complete(ownerA, adminDone, '2026-06-15')
      expect(await scalar(db, 'select next_due_at::text from public.compliance_calendar_obligations where id = $1', [owned])).toBe('2027-06-15')
      expect(await scalar(db, 'select next_due_at::text from public.compliance_calendar_obligations where id = $1', [adminDone])).toBe('2027-06-15')
    })

    it('closes a one-off deadline instead of rolling it forward', async () => {
      const ob = await obligation({ cadence: 'once', next_due_at: '2026-07-01' })
      await complete(ownerA, ob, '2026-07-01')
      expect(await scalar(db, 'select status from public.compliance_calendar_obligations where id = $1', [ob])).toBe('completed')
    })
  })

  describe('who may not: always "not found", never "forbidden"', () => {
    const denied = async (caller: Parameters<typeof asCaller>[1], ob: string, inspection: string | null = null) =>
      expect(complete(caller, ob, '2026-03-31', { inspection })).rejects.toMatchObject({ code: 'P0002' })

    it('refuses a member who is neither the owner nor the submitter, or who names someone else\'s checklist', async () => {
      const ob = await obligation()
      const mine = await checklist(ob)   // submitted by member C
      await denied(memberA, ob, mine)
      await denied(memberA, ob)
      await denied(memberC, ob)           // the submitter, but naming no checklist
      await denied(memberC, ob, await checklist(ob, { inspection: { submitted_by: IDS.memberA } }))
    })

    it('refuses a checklist that does not belong to this deadline, occurrence, site or template', async () => {
      const ob = await obligation()
      const other = await obligation()
      await denied(memberC, ob, await checklist(other))                                                 // started against another deadline
      await denied(memberC, ob, await checklist(ob, { run: { occurrence_at: '2026-01-01' } }))          // for another occurrence
      await denied(memberC, ob, await checklist(ob, { inspection: { template_id: template2 } }))        // from another checklist
      await denied(memberC, ob, await checklist(ob, { inspection: { facility_id: siteB }, run: { facility_id: siteB } }))   // at another site
    })

    it('refuses a checklist that is not a submitted environmental one', async () => {
      const ob = await obligation()
      await denied(memberC, ob, await checklist(ob, { inspection: { status: 'in_progress', submitted_at: null } }))
      await denied(memberC, ob, await checklist(ob, { inspection: { domain: 'safety' } }))
      await denied(memberC, ob, '99999999-9999-4999-8999-999999999999')
    })

    it('refuses someone who has left the account, even as the deadline\'s owner or a checklist\'s submitter', async () => {
      const ob = await obligation({ owner_user_id: MEMBER_D })
      await denied(memberD, ob)
      await denied(memberD, ob, await checklist(ob, { inspection: { submitted_by: MEMBER_D } }))
    })

    it('refuses an admin of another account, a deadline that is not there, and a caller who is not signed in', async () => {
      const ob = await obligation({ cadence: 'annual', next_due_at: '2026-06-15' })
      await expect(complete(adminB, ob, '2026-06-15')).rejects.toMatchObject({ code: 'P0002' })
      await expect(complete(ownerA, '99999999-9999-4999-8999-999999999999', '2026-06-15')).rejects.toMatchObject({ code: 'P0002' })
      await expect(asCaller(db, { userId: '', tenantId: TA }, () => db.query('select public.env_complete_obligation($1, $2::date)', [ob, '2026-06-15'])))
        .rejects.toMatchObject({ code: '42501' })
    })

    it('refuses the right checklist while working in another site, and writes nothing for any refusal', async () => {
      const ob = await obligation()
      const inspection = await checklist(ob)
      await expect(complete({ ...memberC, facilityId: siteB }, ob, '2026-03-31', { inspection })).rejects.toMatchObject({ code: 'P0002' })
      expect(await scalar(db, 'select count(*) from public.compliance_calendar_events where obligation_id = $1', [ob])).toBe(0)
    })
  })

  describe('what is checked whoever asks', () => {
    it('refuses evidence from another account\'s folder, a path that climbs out of its own, and an over-long note', async () => {
      const ob = await obligation({ cadence: 'annual', next_due_at: '2026-06-15' })
      await expect(complete(ownerA, ob, '2026-06-15', { evidence: `${TB}/photo.jpg` })).rejects.toMatchObject({ code: '23514' })
      await expect(complete(ownerA, ob, '2026-06-15', { evidence: `${TA}/../x.jpg` })).rejects.toMatchObject({ code: '23514' })
      await expect(complete(ownerA, ob, '2026-06-15', { note: 'x'.repeat(2001) })).rejects.toMatchObject({ code: '23514' })
      await expect(complete(ownerA, ob, '2026-06-15', { evidence: `${TA}/reports/ar-2026.pdf` })).resolves.toBeTruthy()
    })

    it('refuses an admin who names an unsubmitted checklist, or one that already completed a different deadline', async () => {
      const ob = await obligation()
      await expect(complete(ownerA, ob, '2026-03-31', { inspection: await checklist(ob, { inspection: { status: 'in_progress', submitted_at: null } }) }))
        .rejects.toMatchObject({ code: '23514' })

      const first = await obligation()
      const used = await checklist(first)
      await complete(memberC, first, '2026-03-31', { inspection: used })
      await expect(complete(ownerA, ob, '2026-03-31', { inspection: used })).rejects.toMatchObject({ code: '23514' })
    })

    it('refuses the same occurrence twice, and a deadline that is already closed', async () => {
      const ob = await obligation({ cadence: 'annual', next_due_at: '2026-06-15' })
      await complete(ownerA, ob, '2026-06-15')
      await expect(complete(ownerA, ob, '2026-06-15')).rejects.toMatchObject({ code: '23514' })
      const once = await obligation({ cadence: 'once', next_due_at: '2026-07-01' })
      await complete(ownerA, once, '2026-07-01')
      await expect(complete(ownerA, once, '2026-07-01')).rejects.toMatchObject({ code: '23514' })
    })

    it('treats a replay of the same checklist as the same completion: one event, the deadline not advanced twice', async () => {
      const ob = await obligation()
      const inspection = await checklist(ob)
      const first = (await complete(memberC, ob, '2026-03-31', { inspection })).rows[0]!.id
      const again = (await complete(memberC, ob, '2026-03-31', { inspection })).rows[0]!.id
      expect(again).toBe(first)
      expect(await scalar(db, 'select count(*) from public.compliance_calendar_events where obligation_id = $1', [ob])).toBe(1)
      expect(await scalar(db, 'select next_due_at::text from public.compliance_calendar_obligations where id = $1', [ob])).toBe('2026-06-30')
    })
  })
})

describe('date arithmetic agrees between SQL and the calendar code', () => {
  const CADENCES: ObligationCadence[] = ['monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'triennial', 'quinquennial']

  it('moves every date by every month cadence to the same day, with and without the period-end anchor', async () => {
    const rows = (await db.query<{ d: string; c: string; clamp: boolean; next: string }>(
      `select d::date::text as d, c, clamp, public.env_advance_due_date(d::date, c, null, clamp)::text as next
         from generate_series(date '2026-01-01', date '2028-12-31', interval '1 day') d,
              unnest($1::text[]) c, unnest(array[true, false]) clamp`, [CADENCES],
    )).rows
    expect(rows.length).toBeGreaterThan(10_000)
    const mismatches = rows
      .map(r => ({ ...r, ts: advanceDueDate(r.d, r.c as ObligationCadence, null, { clampToMonthEnd: r.clamp }) }))
      .filter(r => r.ts !== r.next)
      .map(r => `${r.d} ${r.c} clamp=${r.clamp}: sql=${r.next} ts=${r.ts}`)
    expect(mismatches.slice(0, 10), `${mismatches.length} disagree`).toEqual([])
  })

  it('without the anchor, is exactly the register\'s own arithmetic', async () => {
    const differing = await scalar<number>(db,
      `select count(*) from generate_series(date '2026-01-01', date '2027-12-31', interval '1 day') d,
              unnest(array['monthly','quarterly','annual']) c
        where public.env_advance_due_date(d::date, c, null, false) <> public.ms_advance_due_date(d::date, c, null)`)
    expect(differing).toBe(0)
  })
})

describe('the demo reset', () => {
  it('wipes the suite\'s tables in DELETE_ORDER without tripping a foreign key, and leaves the permit vault alone', async () => {
    const permit = await insert(db, 'environmental_permits', {
      tenant_id: TA, facility_id: siteA, program: 'stormwater', title: 'Wipe-test permit', agency: 'Agency', permit_number: `W-${++seq}`,
      jurisdiction: 'federal', holder_of_record: 'Tenant A',
    })
    await insert(db, 'stormwater_outfalls', { tenant_id: TA, facility_id: siteA, permit_id: permit, code: `W-${++seq}` })
    await insert(db, 'legal_register', { tenant_id: TA, facility_id: siteA, title: 'A requirement', citation: '40 CFR 1', jurisdiction: 'federal', source: 'tenant' })

    for (const table of DELETE_ORDER) {
      if (await scalar(db, 'select to_regclass($1)::text', [`public.${table}`]) === null) continue
      await db.query(`delete from public.${table} where tenant_id = $1`, [TA])
    }

    expect(await scalar(db, 'select count(*) from public.stormwater_outfalls where tenant_id = $1', [TA])).toBe(0)
    expect(await scalar(db, 'select count(*) from public.legal_register where tenant_id = $1', [TA])).toBe(0)
    expect(await scalar(db, 'select count(*) from public.environmental_permits where id = $1', [permit])).toBe(1)
  })
})
