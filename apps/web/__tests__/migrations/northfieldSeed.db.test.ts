// @vitest-environment node
//
// The Northfield demo seed (apps/web/migrations/seed_ems_northfield_demo.sql)
// runs against a real Postgres with migrations 295-301 applied, twice, so a
// broken insert or a non-idempotent re-run fails here rather than in front
// of a demo audience. It also pins the story the hub tells about the seed,
// and inserts exactly the rows the companion evidence script writes
// (apps/web/scripts/seed-ems-northfield-evidence.mjs) against the real
// constraints and triggers.

import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { policyIsComplete, registerHealthFromCounts, scopeAndPolicyHealth } from '@soteria/core/managementSystem'
import { COMPLETIONS, completionRows } from '../../scripts/seed-ems-northfield-evidence.mjs'
import { IDS, createEmsDatabase, migrationSql, scalar } from './_emsTestDatabase'

const DB_SETUP_TIMEOUT_MS = 120_000

// The real function hands out the platform's tenant numbers (migration 027).
const NEXT_TENANT_NUMBER_STUB = `
create sequence if not exists public.tenant_number_seq start 9000;
create or replace function public.next_tenant_number() returns text
language sql as $$ select nextval('public.tenant_number_seq')::text $$;
`

let db: PGlite
let tenantId: string

async function count(sql: string): Promise<number> {
  return Number(await scalar<number | string>(db, sql, [tenantId]))
}

/** Insert the columns a row names, as PostgREST would; omitted columns take their defaults. */
async function insertRow(table: string, row: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(row).join(', ')
  await db.query(
    `insert into public.${table} (${columns}) select ${columns} from jsonb_populate_record(null::public.${table}, $1::jsonb)`,
    [JSON.stringify(row)],
  )
}

beforeAll(async () => {
  db = await createEmsDatabase()
  await db.exec(NEXT_TENANT_NUMBER_STUB)
  await db.exec(migrationSql('seed_ems_northfield_demo.sql'))
  tenantId = (await scalar<string>(db, `select id from public.tenants where slug = 'northfield-forge-demo'`))!
}, DB_SETUP_TIMEOUT_MS)

afterAll(async () => { await db?.close() })

describe('seed_ems_northfield_demo.sql', () => {
  it('creates the demo tenant with only the Environmental module on, and its plant', async () => {
    const tenant = await db.query<{ is_demo: boolean; modules: Record<string, boolean> }>(
      `select is_demo, modules from public.tenants where id = $1`, [tenantId])
    expect(tenant.rows[0]).toEqual({ is_demo: true, modules: { environmental: true } })
    expect(await count(`select count(*) from public.facilities where tenant_id = $1 and is_primary`)).toBe(1)
  })

  it('records 25 aspects across five process areas, every one scored under normal operation', async () => {
    expect(await count(`select count(*) from public.environmental_aspect_register where tenant_id = $1`)).toBe(25)
    expect(await count(`select count(distinct process_area) from public.environmental_aspects where tenant_id = $1`)).toBe(5)
    expect(await count(`
      select count(*) from public.environmental_aspects a
       where a.tenant_id = $1
         and not exists (select 1 from public.environmental_aspect_scores s
                          where s.aspect_id = a.id and s.operating_condition = 'normal')`)).toBe(0)
  })

  it('leaves some abnormal and emergency conditions unscored, so the walk-down shows coverage gaps', async () => {
    const coverage = await db.query<{ conditions: number; aspects: number }>(`
      select jsonb_array_length(current_scores) as conditions, count(*)::int as aspects
        from public.environmental_aspect_register where tenant_id = $1
       group by 1 order by 1`, [tenantId])
    expect(coverage.rows.map(r => r.conditions)).toEqual([1, 2, 3])
    expect(await count(`
      select count(*) from public.environmental_aspect_register
       where tenant_id = $1 and significant`)).toBeGreaterThan(0)
  })

  it('pins every facility-scoped row to the plant, so a facility-filtered view still shows it', async () => {
    for (const table of ['environmental_aspects', 'compliance_calendar_obligations', 'ms_compliance_evaluations']) {
      expect(await count(`select count(*) from public.${table} where tenant_id = $1 and facility_id is null`), table).toBe(0)
    }
  })

  it('records 15 obligations, the calendar\'s own Tier II row among them', async () => {
    expect(await count(`select count(*) from public.compliance_calendar_obligations where tenant_id = $1`)).toBe(15)
    expect(await count(`
      select count(*) from public.compliance_calendar_obligations
       where tenant_id = $1 and source = 'system' and system_key = 'epcra-tier-ii'`)).toBe(1)
  })

  it('tells the hub story: context, scope and policy, and aspects green; obligations amber', async () => {
    const context = registerHealthFromCounts({
      active:        await count(`select count(*) from public.ms_context_issues where tenant_id = $1 and retired_at is null`),
      reviewOverdue: await count(`select count(*) from public.ms_context_issues where tenant_id = $1 and next_review_due < current_date`),
      gaps:          await count(`select count(*) from public.ms_context_issues where tenant_id = $1 and kind = 'climate'`) > 0 ? 0 : 1,
    })
    const aspects = registerHealthFromCounts({
      active:        await count(`select count(*) from public.environmental_aspects where tenant_id = $1 and obsolete_at is null`),
      reviewOverdue: await count(`select count(*) from public.environmental_aspects where tenant_id = $1 and next_review_due < current_date`),
      gaps:          await count(`select count(*) from public.environmental_aspect_register where tenant_id = $1 and max_score is null`),
    })
    const reviewOverdue = await count(`
      select count(*) from public.compliance_calendar_obligations where tenant_id = $1 and next_review_due < current_date`)
    const evaluationsOverdue = await count(`
      select count(*) from public.ms_compliance_evaluations
       where tenant_id = $1 and completed_at is null and scheduled_for < current_date`)
    const unscheduled = await count(`
      select count(*) from public.compliance_calendar_obligations where tenant_id = $1 and evaluation_cadence_days is null`)
    const deadlinesMissed = await count(`
      select count(*) from public.compliance_calendar_obligations
       where tenant_id = $1 and status = 'open' and next_due_at < current_date`)
    const obligations = registerHealthFromCounts({ active: 15, reviewOverdue, gaps: deadlinesMissed + evaluationsOverdue + unscheduled })

    expect({ context, aspects, obligations }).toEqual({ context: 'green', aspects: 'green', obligations: 'amber' })
    // Amber for exactly the two deliberate gaps: no deadline missed, and every obligation has an
    // evaluation frequency (clause 9.1.2 a).
    expect({ reviewOverdue, evaluationsOverdue, unscheduled, deadlinesMissed })
      .toEqual({ reviewOverdue: 1, evaluationsOverdue: 1, unscheduled: 0, deadlinesMissed: 0 })
  })

  it('has a scope and a complete policy signed after it', async () => {
    const policy = (await db.query<{ commitments: Record<string, boolean>; signatory_name: string; signed_at: string; next_review_due: string }>(
      `select commitments, signatory_name, signed_at::text, next_review_due::text from public.ms_policies where tenant_id = $1`, [tenantId])).rows[0]
    const scopeReviewDue = await scalar<string>(db, `select next_review_due::text from public.ms_scope_statements where tenant_id = $1`, [tenantId])
    const complete = policyIsComplete({ commitments: policy.commitments, signatoryName: policy.signatory_name, signedAt: policy.signed_at }, 'ems')
    const today = (await scalar<string>(db, `select current_date::text`))!

    expect(complete).toBe(true)
    expect(scopeAndPolicyHealth({
      scopeNextReviewDue: scopeReviewDue, policyNextReviewDue: policy.next_review_due, policyComplete: complete, signatoryStale: false,
    }, today)).toBe('green')
  })

  it('links interested parties\' adopted needs to the obligations they became', async () => {
    expect(await count(`select count(*) from public.ms_interested_parties where tenant_id = $1`)).toBe(4)
    expect(await count(`
      select count(*) from public.ms_interested_parties p
        join public.compliance_calendar_obligations o on o.id = p.obligation_id
       where p.tenant_id = $1 and p.becomes_obligation`)).toBe(2)
  })

  it('changes nothing when run again', async () => {
    const snapshot = async () => (await db.query(`
      select (select count(*) from public.tenants where slug = 'northfield-forge-demo')      as tenants,
             (select count(*) from public.environmental_aspects where tenant_id = $1)          as aspects,
             (select count(*) from public.environmental_aspect_scores where tenant_id = $1)    as scores,
             (select count(*) from public.environmental_aspect_obligations where tenant_id = $1) as links,
             (select count(*) from public.ms_scoring_methods where tenant_id = $1)             as methods,
             (select count(*) from public.compliance_calendar_obligations where tenant_id = $1) as obligations,
             (select count(*) from public.ms_compliance_evaluations where tenant_id = $1)      as evaluations,
             (select count(*) from public.ms_context_issues where tenant_id = $1)              as issues,
             (select count(*) from public.ms_interested_parties where tenant_id = $1)          as parties,
             (select count(*) from public.ms_scope_statements where tenant_id = $1)            as scopes,
             (select count(*) from public.ms_policies where tenant_id = $1)                    as policies`, [tenantId])).rows[0]
    const before = await snapshot()
    await db.exec(migrationSql('seed_ems_northfield_demo.sql'))
    expect(await snapshot()).toEqual(before)
  })
})

describe('seed-ems-northfield-evidence.mjs', () => {
  it('completes four evaluations whose rows the schema accepts: evidence first, then the sealed result', async () => {
    const facilityId = (await scalar<string>(db, `select id from public.facilities where tenant_id = $1 and is_primary`, [tenantId]))!
    const ctx = { tenantId, facilityId, presenterId: IDS.ownerA }
    for (const plan of COMPLETIONS) {
      for (const { table, row } of completionRows(plan, ctx).writes) await insertRow(table, row)
    }

    const results = await db.query<{ result: string | null }>(`
      select last_result as result from public.ms_obligation_register
       where tenant_id = $1 and last_result is not null order by last_result`, [tenantId])
    expect(results.rows.map(r => r.result)).toEqual(['compliant', 'compliant', 'noncompliant', 'not_applicable'])
    expect(await count(`select count(*) from public.ms_compliance_evaluations where tenant_id = $1`)).toBe(6)
  })

  it('links the noncompliant result to its nonconformity, raised against clause 9.1.2', async () => {
    const link = await db.query<{ classification: string; source_type: string; clause_ref: string; same_obligation: boolean }>(`
      select n.classification, n.source_type, n.clause_ref, n.source_reference = e.obligation_id::text as same_obligation
        from public.ms_compliance_evaluations e
        join public.nonconformities n on n.id = e.nonconformity_id
       where e.tenant_id = $1 and e.result = 'noncompliant'`, [tenantId])
    expect(link.rows).toEqual([{ classification: 'minor', source_type: 'compliance', clause_ref: '9.1.2', same_obligation: true }])
  })

  it('records each evidence file under the hash and size of its actual bytes', () => {
    const ctx = { tenantId, facilityId: null, presenterId: IDS.ownerA }
    for (const plan of COMPLETIONS) {
      const { upload, writes } = completionRows(plan, ctx)
      if (!upload) continue
      const row = writes.find(w => w.table === 'ms_evidence')!.row as Record<string, unknown>
      expect(upload.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-')
      expect(row.sha256).toBe(createHash('sha256').update(upload.bytes).digest('hex'))
      expect(row.file_size_bytes).toBe(upload.bytes.length)
      expect(row.storage_path).toBe(upload.storagePath)
      expect(upload.storagePath).toBe(`${tenantId}/compliance_evaluation/${row.subject_id}/${row.sha256}.pdf`)
    }
  })
})
