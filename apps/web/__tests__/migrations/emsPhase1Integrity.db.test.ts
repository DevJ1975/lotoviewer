// @vitest-environment node
//
// The rules that keep Phase 1's compliance records honest when someone goes
// around the API: RLS is the boundary and the anon key is public, so a
// PostgREST call must not be able to forge an evaluation, change evidence
// after a result is sealed, or plant a score dated in the future. Also the
// migrations' own bookkeeping: original dates survive the backfills, a
// re-run moves nothing and widens nothing, and the register's per-aspect
// lookup can use its index.
//
// SQLSTATEs: 23000 our integrity triggers, 23503 foreign key, 23505 unique,
// 23514 check, 42501 insufficient privilege.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { IDS, PHASE1_MIGRATIONS, asCaller, createEmsDatabase, migrationSql, scalar } from './_emsTestDatabase'

const DB_SETUP_TIMEOUT_MS = 120_000

const ownerA  = { userId: IDS.ownerA,  tenantId: IDS.tenantA }
const memberA = { userId: IDS.memberA, tenantId: IDS.tenantA }

function sha256Hex(seed: number): string {
  return seed.toString(16).padStart(64, '0')
}

async function insertObligation(db: PGlite, tenantId = IDS.tenantA): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.compliance_calendar_obligations
       (tenant_id, title, next_due_at, source_kind, jurisdiction, evaluation_cadence_days)
     values ($1, 'Air permit monitoring', current_date + 30, 'permit', 'state:TX', 365) returning id`, [tenantId]))!
}

async function openEvaluation(db: PGlite, obligationId: string, assignedTo: string | null = null, tenantId = IDS.tenantA): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.ms_compliance_evaluations (tenant_id, obligation_id, scheduled_for, assigned_to)
     values ($1, $2, current_date, $3) returning id`, [tenantId, obligationId, assignedTo]))!
}

async function attachEvidence(db: PGlite, evaluationId: string, seed: number, tenantId = IDS.tenantA): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.ms_evidence
       (tenant_id, subject_type, subject_id, kind, storage_path, file_name, mime_type, file_size_bytes, sha256, uploaded_by)
     values ($1, 'compliance_evaluation', $2, 'document', $3, 'record.pdf', 'application/pdf', 2048, $4, $5) returning id`,
    [tenantId, evaluationId, `${tenantId}/compliance_evaluation/${evaluationId}/${seed}.pdf`, sha256Hex(seed), IDS.ownerA]))!
}

async function completeAsService(db: PGlite, evaluationId: string): Promise<void> {
  await db.query(
    `update public.ms_compliance_evaluations set completed_at = now(), result = 'undetermined', evaluator_id = $2 where id = $1`,
    [evaluationId, IDS.ownerA])
}

async function compliantNonconformity(db: PGlite, obligationId: string, sourceType = 'compliance'): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.nonconformities (tenant_id, title, source_type, source_reference)
     values ($1, 'Report filed late', $2, $3) returning id`, [IDS.tenantA, sourceType, obligationId]))!
}

describe('Phase 1 records written around the API', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createEmsDatabase()
  }, DB_SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await db?.close()
  })

  describe('a compliance evaluation', () => {
    it('cannot be inserted already sealed by a person, even an admin', async () => {
      const obligation = await insertObligation(db)
      await asCaller(db, ownerA, async () => {
        await expect(db.query(
          `insert into public.ms_compliance_evaluations
             (tenant_id, obligation_id, scheduled_for, completed_at, evaluator_id, result, notes)
           values ($1, $2, '2020-01-01', '2020-01-02', $3, 'not_applicable', 'Backdated')`,
          [IDS.tenantA, obligation, IDS.ownerA])).rejects.toMatchObject({ code: '23514' })
      })
    })

    it('can be completed by its assignee, but not moved, rescheduled or reassigned', async () => {
      const evaluation = await openEvaluation(db, await insertObligation(db), IDS.memberA)
      const otherObligation = await insertObligation(db)
      await asCaller(db, memberA, async () => {
        for (const [column, value] of [['obligation_id', otherObligation], ['scheduled_for', '2020-01-01'], ['assigned_to', IDS.ownerA]]) {
          await expect(db.query(`update public.ms_compliance_evaluations set ${column} = $2 where id = $1`, [evaluation, value]))
            .rejects.toMatchObject({ code: '42501' })
        }
      })
      await asCaller(db, ownerA, async () => {
        await db.query(`update public.ms_compliance_evaluations set scheduled_for = current_date + 7 where id = $1`, [evaluation])
      })
    })

    it('records the server\'s time and the real evaluator, whatever the caller sends', async () => {
      const evaluation = await openEvaluation(db, await insertObligation(db), IDS.memberA)
      await asCaller(db, memberA, async () => {
        await db.query(
          `update public.ms_compliance_evaluations
              set completed_at = '2020-01-01', result = 'undetermined', evaluator_id = $2 where id = $1`,
          [evaluation, IDS.ownerA])
      })
      const row = (await db.query<{ evaluator_id: string; recent: boolean }>(
        `select evaluator_id, completed_at > now() - interval '1 minute' as recent
           from public.ms_compliance_evaluations where id = $1`, [evaluation])).rows[0]
      expect(row).toEqual({ evaluator_id: IDS.memberA, recent: true })
    })

    it('closes as noncompliant only with the nonconformity raised against its own obligation, used once', async () => {
      const obligation = await insertObligation(db)
      const evaluation = await openEvaluation(db, obligation)
      await attachEvidence(db, evaluation, 101)
      const borrowed = await compliantNonconformity(db, obligation, 'other')
      const own = await compliantNonconformity(db, obligation)
      const close = `update public.ms_compliance_evaluations
                        set completed_at = now(), result = 'noncompliant', evaluator_id = $3, nonconformity_id = $2 where id = $1`

      await asCaller(db, ownerA, async () => {
        await expect(db.query(close, [evaluation, borrowed, IDS.ownerA])).rejects.toMatchObject({ code: '23514' })
        await db.query(close, [evaluation, own, IDS.ownerA])
      })

      const second = await openEvaluation(db, obligation)
      await attachEvidence(db, second, 102)
      await asCaller(db, ownerA, async () => {
        await expect(db.query(close, [second, own, IDS.ownerA])).rejects.toMatchObject({ code: '23505' })
      })
    })
  })

  describe('evidence', () => {
    it('cannot be added to, or superseded on, an evaluation that is sealed', async () => {
      const evaluation = await openEvaluation(db, await insertObligation(db))
      const filed = await attachEvidence(db, evaluation, 201)
      const replacement = await attachEvidence(db, evaluation, 202)
      await completeAsService(db, evaluation)

      await expect(attachEvidence(db, evaluation, 203)).rejects.toMatchObject({ code: '23000' })
      await expect(db.query(
        `update public.ms_evidence set superseded_by = $2, superseded_at = now(), superseded_reason = 'Late swap' where id = $1`,
        [filed, replacement])).rejects.toMatchObject({ code: '23000' })
    })

    it('is superseded only by another file of the same tenant', async () => {
      const evaluation = await openEvaluation(db, await insertObligation(db))
      const filed = await attachEvidence(db, evaluation, 301)
      const foreign = await attachEvidence(db, await openEvaluation(db, await insertObligation(db, IDS.tenantB), null, IDS.tenantB), 302, IDS.tenantB)
      const supersede = `update public.ms_evidence
                            set superseded_by = $2, superseded_at = now(), superseded_reason = 'Replaced' where id = $1`
      await expect(db.query(supersede, [filed, filed])).rejects.toMatchObject({ code: '23514' })
      await expect(db.query(supersede, [filed, foreign])).rejects.toMatchObject({ code: '23503' })
    })
  })

  describe('an aspect score', () => {
    it('is dated and attributed by the server when a person records it', async () => {
      const aspect = (await scalar<string>(db,
        `insert into public.environmental_aspects (tenant_id, activity, aspect, impact, process_area)
         values ($1, 'Parts washing', 'Solvent vapour', 'Air quality', 'Finishing') returning id`, [IDS.tenantA]))!
      const method = (await scalar<string>(db,
        `select id from public.ms_scoring_methods where tenant_id = $1 and is_default and retired_at is null`, [IDS.tenantA]))!
      await asCaller(db, ownerA, async () => {
        await db.query(
          `insert into public.environmental_aspect_scores
             (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale, scored_by, scored_at)
           values ($1, $2, 'normal', 2, 2, $3, 'Routine', $4, '2100-01-01')`, [IDS.tenantA, aspect, method, IDS.memberA])
      })
      const row = (await db.query<{ scored_by: string; recent: boolean }>(
        `select scored_by, scored_at < now() + interval '1 minute' as recent
           from public.environmental_aspect_scores where aspect_id = $1`, [aspect])).rows[0]
      expect(row).toEqual({ scored_by: IDS.ownerA, recent: true })
    })
  })

  describe('a scoring method', () => {
    const insertMethod = (name: string, matrix: unknown) => db.query(
      `insert into public.ms_scoring_methods (tenant_id, name, severity_levels, likelihood_levels, matrix, significance_threshold)
       values ($1, $2, 2, 2, $3::jsonb, 2)`, [IDS.tenantB, name, JSON.stringify(matrix)])

    it('refuses a matrix that would break scoring, and accepts a well-formed one', async () => {
      for (const [name, matrix] of [
        ['text cell', [[1, 2], [2, 'x']]], ['fractional cell', [[1, 2], [2, 2.5]]],
        ['too few rows', [[1, 2]]], ['ragged row', [[1, 2], [2]]], ['zero cell', [[0, 2], [2, 4]]], ['not rows', [1, 2]],
      ] as const) {
        await expect(insertMethod(name, matrix), name).rejects.toMatchObject({ code: '23514' })
      }
      await insertMethod('Two by two', [[1, 2], [2, 4]])
    })
  })

  describe('a system obligation the compliance calendar seeds', () => {
    it('lands in its own register whatever the seeding code sends', async () => {
      const discipline = await scalar<string>(db,
        `insert into public.compliance_calendar_obligations (tenant_id, title, next_due_at, source, system_key)
         values ($1, 'Post OSHA Form 300A summary', current_date + 30, 'system', 'osha-300a-post') returning discipline`,
        [IDS.tenantB])
      expect(discipline).toBe('ohs')
    })
  })

  describe('a facility reference', () => {
    it('must name a facility of the same tenant', async () => {
      const foreignFacility = await scalar<string>(db, 'select id from public.facilities where tenant_id = $1', [IDS.tenantB])
      await expect(db.query(
        `insert into public.environmental_aspects (tenant_id, facility_id, activity, aspect, impact)
         values ($1, $2, 'Welding', 'Fume', 'Air quality')`, [IDS.tenantA, foreignFacility])).rejects.toMatchObject({ code: '23503' })
    })
  })

  describe('the aspects register', () => {
    it('can look each aspect\'s current scores up by tenant and aspect through the index', async () => {
      await db.exec('set enable_seqscan = off')
      try {
        const plan = (await db.query<{ 'QUERY PLAN': string }>(
          `explain select max_score from public.environmental_aspect_register where tenant_id = '${IDS.tenantA}'`)).rows
          .map(r => r['QUERY PLAN']).join('\n')
        expect(plan).toMatch(/Index Cond: \(\(tenant_id = a\.tenant_id\) AND \(aspect_id = a\.id\)\)/)
      } finally {
        await db.exec('reset enable_seqscan')
      }
    })
  })
})

describe('Phase 1 migrations\' own bookkeeping', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createEmsDatabase({ throughPhase1: false })
  }, DB_SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await db?.close()
  })

  it('keeps each aspect\'s last-changed date, and dates its carried-over score by it', async () => {
    await db.exec(`
      alter table public.environmental_aspects disable trigger trg_environmental_aspects_touch;
      update public.environmental_aspects set updated_at = '2026-01-15T09:00:00Z';
      alter table public.environmental_aspects enable trigger trg_environmental_aspects_touch;`)
    const through297 = PHASE1_MIGRATIONS.slice(0, PHASE1_MIGRATIONS.indexOf('297_environmental_aspects_register.sql') + 1)
    for (const file of through297) await db.exec(migrationSql(file))

    const dates = (await db.query<{ updated: string; scored: string }>(
      `select distinct a.updated_at::date::text as updated, s.scored_at::date::text as scored
         from public.environmental_aspects a join public.environmental_aspect_scores s on s.aspect_id = a.id`)).rows
    expect(dates).toEqual([{ updated: '2026-01-15', scored: '2026-01-15' }])

    // The rest of Phase 1, for the tests below. (301's demo reseed is a real edit, so it may move updated_at.)
    for (const file of PHASE1_MIGRATIONS.slice(through297.length)) await db.exec(migrationSql(file))
  })

  it('moves no organization-wide record to the primary facility when re-run', async () => {
    const nonconformity = (await scalar<string>(db,
      `insert into public.nonconformities (tenant_id, facility_id, title) values ($1, null, 'Organization-wide finding') returning id`,
      [IDS.tenantA]))!
    await db.exec(migrationSql('300_ems_facility_scope.sql'))
    expect(await scalar(db, 'select facility_id from public.nonconformities where id = $1', [nonconformity])).toBeNull()
  })

  it('gives members no write access to aspects when 297 is re-run after 301', async () => {
    await db.exec(migrationSql('297_environmental_aspects_register.sql'))
    await asCaller(db, memberA, async () => {
      await expect(db.query(
        `insert into public.environmental_aspects (tenant_id, activity, aspect, impact) values ($1, 'Welding', 'Fume', 'Air')`,
        [IDS.tenantA])).rejects.toMatchObject({ code: '42501' })
    })
  })

  it('keeps an obsolete aspect closed, not live, when Phase 1 is rolled back', async () => {
    const aspect = await scalar<string>(db, 'select id from public.environmental_aspects order by id limit 1')
    await db.query(`update public.environmental_aspects set obsolete_at = now(), obsolete_reason = 'Line removed', status = 'controlled' where id = $1`, [aspect])
    for (const file of [...PHASE1_MIGRATIONS].reverse()) await db.exec(migrationSql(file.replace(/_.*$/, '_rollback.sql')))
    expect(await scalar(db, 'select status from public.environmental_aspects where id = $1', [aspect])).toBe('closed')
  })
})
