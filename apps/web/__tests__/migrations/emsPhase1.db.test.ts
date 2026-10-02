// @vitest-environment node
//
// Migrations 295-301 run against a real Postgres (PGlite) and are exercised
// as real users, so these tests prove what the database enforces, not just
// what the SQL says. The platform stand-ins live in _emsTestDatabase.ts.
//
// SQLSTATEs asserted below:
//   23000 integrity_constraint_violation (our triggers: sealed, frozen, append-only)
//   23503 foreign_key_violation      23505 unique_violation
//   23514 check_violation            42501 insufficient_privilege (grants and RLS)
//   22P02 invalid_text_representation

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { scoreAspect } from '@soteria/core/environmentalAspect'
import { DEFAULT_SCORING_METHOD, type ScoringMethodDefinition } from '@soteria/core/scoringMethod'
import { IDS, PHASE1_MIGRATIONS, asCaller, createEmsDatabase, migrationSql, scalar } from './_emsTestDatabase'

const DB_SETUP_TIMEOUT_MS = 120_000

const ownerA  = { userId: IDS.ownerA,  tenantId: IDS.tenantA }
const memberA = { userId: IDS.memberA, tenantId: IDS.tenantA }
const adminB  = { userId: IDS.adminB,  tenantId: IDS.tenantB }

function sha256Hex(seed: number): string {
  return seed.toString(16).padStart(64, '0')
}

async function primaryFacility(db: PGlite, tenantId: string): Promise<string> {
  const id = await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [tenantId])
  if (!id) throw new Error(`fixture: tenant ${tenantId} has no primary facility`)
  return id
}

async function defaultMethod(db: PGlite, tenantId: string): Promise<string> {
  const existing = await scalar<string>(db,
    `select id from public.ms_scoring_methods where tenant_id = $1 and is_default and retired_at is null`, [tenantId])
  if (existing) return existing
  return (await scalar<string>(db,
    `insert into public.ms_scoring_methods (tenant_id, name, significance_threshold, is_default)
     values ($1, 'Severity × likelihood (5×5)', 12, true) returning id`, [tenantId]))!
}

async function insertObligation(db: PGlite, tenantId: string, title: string): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.compliance_calendar_obligations
       (tenant_id, title, next_due_at, source_kind, jurisdiction, evaluation_cadence_days)
     values ($1, $2, current_date + 30, 'permit', 'state:TX', 365) returning id`, [tenantId, title]))!
}

async function insertAspect(db: PGlite, tenantId: string): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.environmental_aspects (tenant_id, activity, aspect, impact, process_area)
     values ($1, 'Parts washing', 'Solvent vapour', 'Air quality', 'Finishing') returning id`, [tenantId]))!
}

async function openEvaluation(db: PGlite, tenantId: string, obligationId: string, assignedTo: string | null = null): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.ms_compliance_evaluations (tenant_id, obligation_id, scheduled_for, assigned_to)
     values ($1, $2, current_date, $3) returning id`, [tenantId, obligationId, assignedTo]))!
}

async function attachEvidence(db: PGlite, tenantId: string, evaluationId: string, seed: number): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.ms_evidence
       (tenant_id, subject_type, subject_id, kind, storage_path, file_name, mime_type, file_size_bytes, sha256, uploaded_by)
     values ($1, 'compliance_evaluation', $2, 'document', $3, 'permit-check.pdf', 'application/pdf', 2048, $4, $5)
     returning id`,
    [tenantId, evaluationId, `${tenantId}/evaluations/${evaluationId}/${seed}.pdf`, sha256Hex(seed), IDS.ownerA]))!
}

async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  return Number(await scalar<number>(db, sql, params))
}

describe('EMS Phase 1 migrations on a real Postgres', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createEmsDatabase()
  }, DB_SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await db?.close()
  })

  describe('the demo register after 297 and 301', () => {
    it('keeps every aspect, with one carried-over score each', async () => {
      expect(await count(db, 'select count(*) from public.environmental_aspects where tenant_id = $1', [IDS.tenantA])).toBe(14)
      expect(await count(db, 'select count(*) from public.environmental_aspect_scores where tenant_id = $1', [IDS.tenantA])).toBe(14)
      expect(await count(db,
        'select count(*) from public.environmental_aspect_current_scores where tenant_id = $1 and significant', [IDS.tenantA])).toBe(5)
    })

    it('puts every aspect in a process area and on the primary facility', async () => {
      const facility = await primaryFacility(db, IDS.tenantA)
      expect(await count(db,
        'select count(*) from public.environmental_aspects where process_area is null or facility_id is distinct from $1',
        [facility])).toBe(0)
    })

    it('folds each aspect\'s current scores into the register view', async () => {
      const register = await db.query<{ significant: boolean; max_score: number | null; current_scores: unknown[] }>(
        `select significant, max_score, current_scores from public.environmental_aspect_register where tenant_id = $1`,
        [IDS.tenantA])
      expect(register.rows).toHaveLength(14)
      expect(register.rows.filter(r => r.significant)).toHaveLength(5)
      expect(register.rows.every(r => r.current_scores.length === 1)).toBe(true)
    })

    it('shows an unscored aspect as not significant, with no scores', async () => {
      const aspect = await insertAspect(db, IDS.tenantA)
      const row = await db.query(
        `select significant, max_score, current_scores from public.environmental_aspect_register where id = $1`, [aspect])
      expect(row.rows).toEqual([{ significant: false, max_score: null, current_scores: [] }])
    })

    it('drops the legacy single-score columns', async () => {
      const legacy = await db.query(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'environmental_aspects'
            and column_name in ('severity','likelihood','operating_condition','significance_score','is_significant')`)
      expect(legacy.rows).toEqual([])
    })

    it('still runs the rewritten demo seed by hand, with no request headers, idempotently', async () => {
      const message = await scalar<string>(db, 'select public.seed_wls_iso14001_demo()')
      expect(message).toContain('scores=')
      expect(await count(db, 'select count(*) from public.environmental_aspect_scores where tenant_id = $1', [IDS.tenantA])).toBe(14)
    })
  })

  describe('active_tenant_id() and active_facility_id() after 300', () => {
    it('return null when no request headers are set', async () => {
      for (const headers of ['', '{}']) {
        await db.query(`select set_config('request.headers', $1, false)`, [headers])
        expect(await scalar(db, 'select public.active_facility_id()')).toBeNull()
        expect(await scalar(db, 'select public.active_tenant_id()')).toBeNull()
      }
    })

    it('return the header values when PostgREST sets them', async () => {
      const facility = await primaryFacility(db, IDS.tenantA)
      await asCaller(db, { userId: IDS.ownerA, tenantId: IDS.tenantA, facilityId: facility }, async () => {
        expect(await scalar(db, 'select public.active_tenant_id()')).toBe(IDS.tenantA)
        expect(await scalar(db, 'select public.active_facility_id()')).toBe(facility)
      })
    })
  })

  describe('aspect scoring', () => {
    const MATRIX_METHOD: ScoringMethodDefinition = {
      severityLevels: 5,
      likelihoodLevels: 5,
      matrix: [
        [1, 2, 3, 4, 6],
        [2, 4, 6, 9, 12],
        [3, 6, 10, 14, 17],
        [5, 9, 14, 18, 22],
        [7, 12, 17, 22, 25],
      ],
      significanceThreshold: 14,
    }

    it.each([
      ['the default 5×5 product', DEFAULT_SCORING_METHOD],
      ['a custom matrix', MATRIX_METHOD],
    ])('matches scoreAspect() on every cell of %s', async (_label, method) => {
      const cells = await db.query<{ severity: number; likelihood: number; score: number; significant: boolean }>(
        `select s as severity, l as likelihood,
                public.ms_method_score($1::jsonb, s, l) as score,
                public.ms_method_score($1::jsonb, s, l) >= $2 as significant
           from generate_series(1, 5) s, generate_series(1, 5) l`,
        [method.matrix === null ? null : JSON.stringify(method.matrix), method.significanceThreshold])
      expect(cells.rows).toHaveLength(25)
      for (const cell of cells.rows) {
        expect({ score: cell.score, significant: cell.significant })
          .toEqual(scoreAspect(cell.severity, cell.likelihood, method))
      }
    })

    it('shows the latest score per operating condition, judged by its method', async () => {
      const aspect = await insertAspect(db, IDS.tenantA)
      const method = await defaultMethod(db, IDS.tenantA)
      await db.query(
        `insert into public.environmental_aspect_scores
           (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale, scored_at)
         values ($1, $2, 'normal',    1, 2, $3, 'First look',          now() - interval '2 days'),
                ($1, $2, 'normal',    4, 4, $3, 'Ventilation failed',  now() - interval '1 day'),
                ($1, $2, 'emergency', 3, 3, $3, 'Drum rupture',        now() - interval '1 day')`,
        [IDS.tenantA, aspect, method])

      const current = await db.query<{ operating_condition: string; score: number; significant: boolean }>(
        `select operating_condition, score, significant from public.environmental_aspect_current_scores
          where aspect_id = $1 order by operating_condition`, [aspect])
      expect(current.rows).toEqual([
        { operating_condition: 'emergency', ...scoreAspect(3, 3, DEFAULT_SCORING_METHOD) },
        { operating_condition: 'normal',    ...scoreAspect(4, 4, DEFAULT_SCORING_METHOD) },
      ])
    })

    it('breaks a scored_at tie by the higher id', async () => {
      const aspect = await insertAspect(db, IDS.tenantA)
      const method = await defaultMethod(db, IDS.tenantA)
      await db.query(
        `insert into public.environmental_aspect_scores
           (id, tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale, scored_at)
         values ('bbbbbbbb-0000-4000-8000-000000000000', $1, $2, 'abnormal', 5, 5, $3, 'Later id', '2026-01-01T00:00:00Z'),
                ('aaaaaaaa-0000-4000-8000-000000000000', $1, $2, 'abnormal', 1, 1, $3, 'Earlier id', '2026-01-01T00:00:00Z')`,
        [IDS.tenantA, aspect, method])
      expect(await scalar(db,
        `select severity from public.environmental_aspect_current_scores where aspect_id = $1`, [aspect])).toBe(5)
    })

    it('refuses a score off its method scale', async () => {
      const aspect = await insertAspect(db, IDS.tenantA)
      const method = await defaultMethod(db, IDS.tenantA)
      await expect(db.query(
        `insert into public.environmental_aspect_scores
           (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale)
         values ($1, $2, 'normal', 6, 1, $3, 'Off the scale')`, [IDS.tenantA, aspect, method]))
        .rejects.toMatchObject({ code: '23514' })
    })

    it('refuses a score that names another tenant\'s method', async () => {
      const aspect = await insertAspect(db, IDS.tenantA)
      const foreignMethod = await defaultMethod(db, IDS.tenantB)
      await expect(db.query(
        `insert into public.environmental_aspect_scores
           (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale)
         values ($1, $2, 'normal', 1, 1, $3, 'Borrowed method')`, [IDS.tenantA, aspect, foreignMethod]))
        .rejects.toMatchObject({ code: '23503' })
    })

    it('freezes a method\'s arithmetic but lets it be renamed', async () => {
      const method = await defaultMethod(db, IDS.tenantA)
      await expect(db.query(`update public.ms_scoring_methods set significance_threshold = 10 where id = $1`, [method]))
        .rejects.toMatchObject({ code: '23000' })
      await expect(db.query(`update public.ms_scoring_methods set matrix = '[[1]]' where id = $1`, [method]))
        .rejects.toMatchObject({ code: '23000' })
      await db.query(`update public.ms_scoring_methods set name = 'Plant 5×5' where id = $1`, [method])
      expect(await scalar(db, 'select name from public.ms_scoring_methods where id = $1', [method])).toBe('Plant 5×5')
    })
  })

  describe('append-only history and versioned documents', () => {
    it('lets nobody rewrite or delete a score, admins included', async () => {
      const scoreId = await scalar<string>(db,
        'select id from public.environmental_aspect_scores where tenant_id = $1 limit 1', [IDS.tenantA])
      await asCaller(db, ownerA, async () => {
        await expect(db.query('update public.environmental_aspect_scores set severity = 1 where id = $1', [scoreId]))
          .rejects.toMatchObject({ code: '42501' })
        await expect(db.query('delete from public.environmental_aspect_scores where id = $1', [scoreId]))
          .rejects.toMatchObject({ code: '42501' })
      })
    })

    it('lets an admin add a policy version, a member read it, and nobody edit it', async () => {
      const policyInsert =
        `insert into public.ms_policies (tenant_id, version, body, commitments, signatory_name, signed_at)
         values ($1, $2, 'We protect the environment.', '{"ems.protect_environment": true}', 'Plant Manager', current_date)
         returning id`
      const policyId = await asCaller(db, ownerA, () => scalar<string>(db, policyInsert, [IDS.tenantA, 1]))
      await asCaller(db, memberA, async () => {
        expect(await count(db, 'select count(*) from public.ms_policies where id = $1', [policyId])).toBe(1)
        await expect(db.query(policyInsert, [IDS.tenantA, 2])).rejects.toMatchObject({ code: '42501' })
      })
      await asCaller(db, ownerA, async () => {
        await expect(db.query(`update public.ms_policies set body = 'Edited' where id = $1`, [policyId]))
          .rejects.toMatchObject({ code: '42501' })
      })
    })
  })

  describe('compliance evaluations', () => {
    it('will not close as compliant without evidence, then closes once it is attached', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Air permit monitoring')
      const evaluation = await openEvaluation(db, IDS.tenantA, obligation)
      const close =
        `update public.ms_compliance_evaluations
            set completed_at = now(), result = 'compliant', evaluator_id = $2 where id = $1`
      await expect(db.query(close, [evaluation, IDS.ownerA])).rejects.toMatchObject({ code: '23514' })

      await attachEvidence(db, IDS.tenantA, evaluation, 1)
      await db.query(close, [evaluation, IDS.ownerA])
      expect(await scalar(db, 'select result from public.ms_compliance_evaluations where id = $1', [evaluation])).toBe('compliant')
    })

    it('is sealed once complete', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Stormwater inspection')
      const evaluation = await openEvaluation(db, IDS.tenantA, obligation)
      await db.query(
        `update public.ms_compliance_evaluations
            set completed_at = now(), result = 'undetermined', evaluator_id = $2 where id = $1`, [evaluation, IDS.ownerA])
      await expect(db.query(`update public.ms_compliance_evaluations set notes = 'Second thoughts' where id = $1`, [evaluation]))
        .rejects.toMatchObject({ code: '23000' })
    })

    it('needs a nonconformity to close as noncompliant, and notes to close as not applicable', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Waste manifest retention')
      const evaluation = await openEvaluation(db, IDS.tenantA, obligation)
      await attachEvidence(db, IDS.tenantA, evaluation, 2)
      await expect(db.query(
        `update public.ms_compliance_evaluations
            set completed_at = now(), result = 'noncompliant', evaluator_id = $2 where id = $1`, [evaluation, IDS.ownerA]))
        .rejects.toMatchObject({ code: '23514' })
      await expect(db.query(
        `update public.ms_compliance_evaluations
            set completed_at = now(), result = 'not_applicable', evaluator_id = $2 where id = $1`, [evaluation, IDS.ownerA]))
        .rejects.toMatchObject({ code: '23514' })

      const nonconformity = await scalar<string>(db,
        `insert into public.nonconformities (tenant_id, title) values ($1, 'Manifests missing for March') returning id`,
        [IDS.tenantA])
      await db.query(
        `update public.ms_compliance_evaluations
            set completed_at = now(), result = 'noncompliant', evaluator_id = $2, nonconformity_id = $3 where id = $1`,
        [evaluation, IDS.ownerA, nonconformity])
    })

    it('allows one open evaluation per obligation', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Tank integrity test')
      await openEvaluation(db, IDS.tenantA, obligation)
      await expect(openEvaluation(db, IDS.tenantA, obligation)).rejects.toMatchObject({ code: '23505' })
    })

    it('lets the assignee complete it, but not another member', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Spill kit check')
      const unassigned = await openEvaluation(db, IDS.tenantA, obligation)
      const close =
        `update public.ms_compliance_evaluations
            set completed_at = now(), result = 'undetermined', evaluator_id = $2 where id = $1`
      await asCaller(db, memberA, async () => {
        expect((await db.query(close, [unassigned, IDS.memberA])).affectedRows).toBe(0)
      })

      await db.query('update public.ms_compliance_evaluations set assigned_to = $2 where id = $1', [unassigned, IDS.memberA])
      await asCaller(db, memberA, async () => {
        expect((await db.query(close, [unassigned, IDS.memberA])).affectedRows).toBe(1)
      })
    })

    it('cannot be deleted, and keeps its obligation from being deleted', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Noise survey')
      const evaluation = await openEvaluation(db, IDS.tenantA, obligation)
      await asCaller(db, ownerA, async () => {
        await expect(db.query('delete from public.ms_compliance_evaluations where id = $1', [evaluation]))
          .rejects.toMatchObject({ code: '42501' })
      })
      await expect(db.query('delete from public.compliance_calendar_obligations where id = $1', [obligation]))
        .rejects.toMatchObject({ code: '23503' })
    })

    it('shows each obligation\'s latest result and open evaluation in the register view', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Wastewater pretreatment permit')
      const first = await openEvaluation(db, IDS.tenantA, obligation)
      await db.query(
        `update public.ms_compliance_evaluations
            set completed_at = now() - interval '2 days', result = 'undetermined', evaluator_id = $2 where id = $1`,
        [first, IDS.ownerA])
      const second = await openEvaluation(db, IDS.tenantA, obligation)
      await attachEvidence(db, IDS.tenantA, second, 8)
      await db.query(
        `update public.ms_compliance_evaluations
            set completed_at = now() - interval '1 day', result = 'compliant', evaluator_id = $2 where id = $1`,
        [second, IDS.ownerA])
      const open = await openEvaluation(db, IDS.tenantA, obligation, IDS.memberA)

      const row = await db.query(
        `select last_evaluation_id, last_result, open_evaluation_id, open_evaluation_assignee
           from public.ms_obligation_register where id = $1`, [obligation])
      expect(row.rows).toEqual([{
        last_evaluation_id: second, last_result: 'compliant', open_evaluation_id: open, open_evaluation_assignee: IDS.memberA,
      }])
      await asCaller(db, adminB, async () => {
        expect(await count(db, 'select count(*) from public.ms_obligation_register where id = $1', [obligation])).toBe(0)
      })
    })

    it('refuses an obligation from another tenant', async () => {
      const foreignObligation = await insertObligation(db, IDS.tenantB, 'Someone else\'s permit')
      await expect(openEvaluation(db, IDS.tenantA, foreignObligation)).rejects.toMatchObject({ code: '23503' })
    })
  })

  describe('evidence', () => {
    it('is written only by the server', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Boiler emissions test')
      const evaluation = await openEvaluation(db, IDS.tenantA, obligation)
      await asCaller(db, ownerA, async () => {
        await expect(attachEvidence(db, IDS.tenantA, evaluation, 3)).rejects.toMatchObject({ code: '42501' })
      })
    })

    it('is readable by its own tenant only', async () => {
      const total = await count(db, 'select count(*) from public.ms_evidence where tenant_id = $1', [IDS.tenantA])
      expect(total).toBeGreaterThan(0)
      await asCaller(db, memberA, async () => {
        expect(await count(db, 'select count(*) from public.ms_evidence')).toBe(total)
      })
      await asCaller(db, adminB, async () => {
        expect(await count(db, 'select count(*) from public.ms_evidence')).toBe(0)
      })
    })

    it('changes only by being superseded, once', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Refrigerant leak log')
      const evaluation = await openEvaluation(db, IDS.tenantA, obligation)
      const original = await attachEvidence(db, IDS.tenantA, evaluation, 4)
      const replacement = await attachEvidence(db, IDS.tenantA, evaluation, 5)

      await expect(db.query(`update public.ms_evidence set file_name = 'renamed.pdf' where id = $1`, [original]))
        .rejects.toMatchObject({ code: '23000' })

      const supersede =
        `update public.ms_evidence
            set superseded_by = $2, superseded_at = now(), superseded_reason = 'Wrong month scanned'
          where id = $1`
      await db.query(supersede, [original, replacement])
      await expect(db.query(supersede, [original, replacement])).rejects.toMatchObject({ code: '23000' })
    })

    it('lives under its tenant\'s storage prefix and carries a SHA-256', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, 'Oil-water separator')
      const evaluation = await openEvaluation(db, IDS.tenantA, obligation)
      const insert =
        `insert into public.ms_evidence
           (tenant_id, subject_type, subject_id, kind, storage_path, file_name, mime_type, file_size_bytes, sha256, uploaded_by)
         values ($1, 'compliance_evaluation', $2, 'photo', $3, 'photo.jpg', 'image/jpeg', 512, $4, $5)`
      await expect(db.query(insert, [IDS.tenantA, evaluation, `${IDS.tenantB}/photo.jpg`, sha256Hex(6), IDS.ownerA]))
        .rejects.toMatchObject({ code: '23514' })
      await expect(db.query(insert, [IDS.tenantA, evaluation, `${IDS.tenantA}/photo.jpg`, 'not-a-hash', IDS.ownerA]))
        .rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('tenant and facility isolation', () => {
    const contextInsert =
      `insert into public.ms_context_issues (tenant_id, facility_id, kind, description)
       values ($1, $2, 'climate', 'Hotter summers raise cooling-water demand') returning id`

    it('lets an admin write context issues, and a member only read them', async () => {
      const issue = await asCaller(db, ownerA, () => scalar<string>(db, contextInsert, [IDS.tenantA, null]))
      await asCaller(db, memberA, async () => {
        expect(await count(db, 'select count(*) from public.ms_context_issues where id = $1', [issue])).toBe(1)
        await expect(db.query(contextInsert, [IDS.tenantA, null])).rejects.toMatchObject({ code: '42501' })
      })
    })

    it('shows another tenant\'s admin none of the registers', async () => {
      await asCaller(db, adminB, async () => {
        for (const table of ['ms_context_issues', 'environmental_aspects', 'environmental_aspect_scores',
          'ms_compliance_evaluations', 'ms_scoring_methods', 'ms_policies', 'environmental_aspect_register']) {
          expect(await count(db, `select count(*) from public.${table} where tenant_id = $1`, [IDS.tenantA])).toBe(0)
        }
        await expect(db.query(contextInsert, [IDS.tenantA, null])).rejects.toMatchObject({ code: '42501' })
      })
    })

    it('hides another facility\'s records when a facility is active', async () => {
      const primary = await primaryFacility(db, IDS.tenantA)
      const annex = await scalar<string>(db,
        `insert into public.facilities (tenant_id, name) values ($1, 'Annex') returning id`, [IDS.tenantA])
      const annexIssue = await scalar<string>(db, contextInsert, [IDS.tenantA, annex])

      const visible = (facilityId?: string) => asCaller(db, { ...ownerA, facilityId },
        () => count(db, 'select count(*) from public.ms_context_issues where id = $1', [annexIssue]))
      expect(await visible(primary)).toBe(0)
      expect(await visible(annex!)).toBe(1)
      expect(await visible()).toBe(1)
    })

    it('refuses an interested party linked to another tenant\'s obligation', async () => {
      const foreignObligation = await insertObligation(db, IDS.tenantB, 'Neighbour\'s permit')
      await expect(db.query(
        `insert into public.ms_interested_parties (tenant_id, name, needs_expectations, becomes_obligation, obligation_id)
         values ($1, 'County water district', 'Discharge within permit limits', true, $2)`,
        [IDS.tenantA, foreignObligation])).rejects.toMatchObject({ code: '23503' })
    })
  })

  describe('deleting a tenant', () => {
    it('removes its sealed evaluations, evidence and score history in one statement', async () => {
      const facility = await primaryFacility(db, IDS.tenantB)
      const obligation = await insertObligation(db, IDS.tenantB, 'Air permit renewal')
      const evaluation = await openEvaluation(db, IDS.tenantB, obligation, IDS.adminB)
      await db.query('update public.ms_compliance_evaluations set facility_id = $2 where id = $1', [evaluation, facility])
      await attachEvidence(db, IDS.tenantB, evaluation, 7)
      const nonconformity = await scalar<string>(db,
        `insert into public.nonconformities (tenant_id, title) values ($1, 'Late renewal') returning id`, [IDS.tenantB])
      await db.query(
        `update public.ms_compliance_evaluations
            set completed_at = now(), result = 'noncompliant', evaluator_id = $2, nonconformity_id = $3 where id = $1`,
        [evaluation, IDS.adminB, nonconformity])
      const aspect = await insertAspect(db, IDS.tenantB)
      await db.query(
        `insert into public.environmental_aspect_scores
           (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale)
         values ($1, $2, 'normal', 2, 2, $3, 'Baseline')`, [IDS.tenantB, aspect, await defaultMethod(db, IDS.tenantB)])

      await db.query('delete from public.tenants where id = $1', [IDS.tenantB])

      for (const table of ['ms_compliance_evaluations', 'ms_evidence', 'environmental_aspect_scores', 'nonconformities',
        'ms_scoring_methods', 'facilities']) {
        expect(await count(db, `select count(*) from public.${table} where tenant_id = $1`, [IDS.tenantB])).toBe(0)
      }
    })
  })
})

describe('EMS Phase 1 rollbacks', () => {
  let db: PGlite

  interface LegacyScore {
    id: string
    operating_condition: string
    severity: number
    likelihood: number
    is_significant: boolean
  }
  const legacyScores = () => db.query<LegacyScore>(
    `select id, operating_condition, severity, likelihood, is_significant
       from public.environmental_aspects order by id`).then(r => r.rows)
  const currentScores = () => db.query<LegacyScore>(
    `select aspect_id as id, operating_condition, severity, likelihood, significant as is_significant
       from public.environmental_aspect_current_scores order by aspect_id`).then(r => r.rows)

  const applyPhase1 = async () => {
    for (const file of PHASE1_MIGRATIONS) await db.exec(migrationSql(file))
  }
  const rollBackPhase1 = async () => {
    for (const file of [...PHASE1_MIGRATIONS].reverse()) {
      await db.exec(migrationSql(file.replace(/_.*$/, '_rollback.sql')))
    }
  }

  beforeAll(async () => {
    db = await createEmsDatabase({ throughPhase1: false })
  }, DB_SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await db?.close()
  })

  it('carries every legacy score forward, back, and forward again unchanged', async () => {
    const before = await legacyScores()
    expect(before).toHaveLength(14)

    await applyPhase1()
    expect(await currentScores()).toEqual(before)

    await rollBackPhase1()
    expect(await legacyScores()).toEqual(before)

    await applyPhase1()
    expect(await currentScores()).toEqual(before)
  }, DB_SETUP_TIMEOUT_MS)

  it('lets every migration be re-run', async () => {
    await applyPhase1()
    expect(await count(db, 'select count(*) from public.environmental_aspect_scores')).toBe(14)
  }, DB_SETUP_TIMEOUT_MS)

  it('removes every Phase 1 object on the way down', async () => {
    await rollBackPhase1()
    for (const relation of ['ms_context_issues', 'ms_interested_parties', 'ms_scope_statements', 'ms_policies',
      'ms_scoring_methods', 'environmental_aspect_scores', 'environmental_aspect_obligations',
      'environmental_aspect_current_scores', 'environmental_aspect_register', 'ms_compliance_evaluations',
      'ms_obligation_register', 'ms_evidence']) {
      expect(await scalar(db, 'select to_regclass($1)::text', [`public.${relation}`])).toBeNull()
    }
    const policies = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where tablename in ('compliance_calendar_obligations', 'environmental_aspects') order by policyname`)
    expect(policies.rows.map(p => p.policyname)).toEqual([
      'ccal_obligations_tenant_scope',
      'environmental_aspects_tenant_scope',
    ])
  }, DB_SETUP_TIMEOUT_MS)

  it('restores the original header readers, which raise without headers', async () => {
    await db.query(`select set_config('request.headers', '', false)`)
    await expect(db.query('select public.active_facility_id()')).rejects.toMatchObject({ code: '22P02' })
  })
})

describe('the deploy window between 300 and 301', () => {
  let db: PGlite
  const UNSCORED = 'dddddddd-0000-4000-8000-000000000001'

  beforeAll(async () => {
    db = await createEmsDatabase({ throughPhase1: false })
    for (const file of PHASE1_MIGRATIONS.slice(0, -1)) await db.exec(migrationSql(file))
    // What the Phase 1 API does: an aspect with no legacy score columns.
    await db.query(
      `insert into public.environmental_aspects (id, tenant_id, activity, aspect, impact, process_area)
       values ($1, $2, 'Pallet washing', 'Wash water', 'Water quality', 'Shipping')`, [UNSCORED, IDS.tenantA])
  }, DB_SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await db?.close()
  })

  it('leaves an aspect the new API created unscored, rather than inventing a 1 × 1 assessment', async () => {
    expect(await scalar(db, 'select severity from public.environmental_aspects where id = $1', [UNSCORED])).toBeNull()
    await db.exec(migrationSql('301_environmental_aspects_contract.sql'))
    expect(await count(db, 'select count(*) from public.environmental_aspect_scores where aspect_id = $1', [UNSCORED])).toBe(0)
    expect(await count(db, 'select count(*) from public.environmental_aspect_scores')).toBe(14)
  }, DB_SETUP_TIMEOUT_MS)

  it('keeps it unscored through 301\'s rollback, and gives it 204\'s defaults only when the old model returns', async () => {
    await db.exec(migrationSql('301_rollback.sql'))
    expect(await scalar(db, 'select severity from public.environmental_aspects where id = $1', [UNSCORED])).toBeNull()

    for (const file of ['300_rollback.sql', '299_rollback.sql', '298_rollback.sql', '297_rollback.sql']) {
      await db.exec(migrationSql(file))
    }
    const legacy = await db.query(
      'select operating_condition, severity, likelihood from public.environmental_aspects where id = $1', [UNSCORED])
    expect(legacy.rows).toEqual([{ operating_condition: 'normal', severity: 1, likelihood: 1 }])
    expect(await count(db, 'select count(*) from public.environmental_aspects where severity is null')).toBe(0)
  }, DB_SETUP_TIMEOUT_MS)
})
