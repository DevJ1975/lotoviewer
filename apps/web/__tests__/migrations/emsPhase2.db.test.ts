// @vitest-environment node
//
// Migrations 304-306 (Phase 2: the permit vault and management of change)
// against a real Postgres (PGlite), exercised as real users: what the
// database itself refuses, not just what the SQL says.
//
// SQLSTATEs asserted below:
//   23503 foreign_key_violation   23505 unique_violation   23514 check_violation
//   23000 integrity_constraint_violation   42501 insufficient_privilege (grants and RLS)
//   P0002 no_data_found

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { advanceDueDate, OBLIGATION_CADENCES } from '@soteria/core/complianceCalendar'
import { normalizeLegalEntity } from '@soteria/core/managementSystem'
import { IDS, PHASE2_MIGRATIONS, asCaller, createEmsDatabase, migrationSql, scalar } from './_emsTestDatabase'

const DB_SETUP_TIMEOUT_MS = 120_000

const ownerA  = { userId: IDS.ownerA,  tenantId: IDS.tenantA }
const memberA = { userId: IDS.memberA, tenantId: IDS.tenantA }
const adminB  = { userId: IDS.adminB,  tenantId: IDS.tenantB }

const OLD_ENTITY = 'Northfield Metal Products Inc.'
const NEW_ENTITY = 'Northfield Forge & Finish LLC'
const COMPLETE = '{"ems.protect_environment": true, "ems.fulfil_obligations": true, "ems.continual_improvement": true}'

let hashSeed = 0
const nextHash = () => (++hashSeed).toString(16).padStart(64, '0')

async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  return Number(await scalar<number>(db, sql, params))
}

async function facilityOf(db: PGlite, tenantId: string): Promise<string> {
  return (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [tenantId]))!
}

async function insertPermit(db: PGlite, tenantId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const row = {
    tenant_id: tenantId, facility_id: await facilityOf(db, tenantId), program: 'air', title: 'Paint booth permit',
    agency: 'State air agency', jurisdiction: 'state:TX', holder_of_record: OLD_ENTITY, expires_on: '2030-01-01', ...fields,
  }
  const columns = Object.keys(row)
  return (await scalar<string>(db,
    `insert into public.environmental_permits (${columns.join(', ')})
     values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(row)))!
}

async function insertObligation(db: PGlite, tenantId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const row = {
    tenant_id: tenantId, title: 'Quarterly outfall visual', cadence: 'quarterly', next_due_at: '2026-12-31',
    discipline: 'ems', source_kind: 'permit', jurisdiction: 'state:TX', next_review_due: '2027-10-01', ...fields,
  }
  const columns = Object.keys(row)
  return (await scalar<string>(db,
    `insert into public.compliance_calendar_obligations (${columns.join(', ')})
     values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    Object.values(row)))!
}

async function fileEvidence(db: PGlite, tenantId: string, subjectType: string, subjectId: string, exportControlled = false): Promise<string> {
  const hash = nextHash()
  return (await scalar<string>(db,
    `insert into public.ms_evidence
       (tenant_id, subject_type, subject_id, kind, storage_path, file_name, mime_type, file_size_bytes, sha256, uploaded_by, export_controlled)
     values ($1, $2, $3, 'document', $4, 'record.pdf', 'application/pdf', 2048, $5, $6, $7) returning id`,
    [tenantId, subjectType, subjectId, `${tenantId}/${subjectType}/${subjectId}/${hash}.pdf`, hash, IDS.ownerA, exportControlled]))!
}

async function insertScope(db: PGlite, tenantId: string, legalEntity: string, effectiveFrom: string): Promise<string> {
  const version = await count(db,
    "select coalesce(max(version), 0) + 1 from public.ms_scope_statements where tenant_id = $1 and discipline = 'ems'", [tenantId])
  return (await scalar<string>(db,
    `insert into public.ms_scope_statements
       (tenant_id, version, legal_entity, physical_boundary, activities, products_services, effective_from)
     values ($1, $2, $3, 'The plant fence line', 'Forging', 'Forgings', $4) returning id`,
    [tenantId, version, legalEntity, effectiveFrom]))!
}

async function insertPolicy(db: PGlite, tenantId: string, signedAt: string): Promise<string> {
  const version = await count(db,
    "select coalesce(max(version), 0) + 1 from public.ms_policies where tenant_id = $1 and discipline = 'ems'", [tenantId])
  return (await scalar<string>(db,
    `insert into public.ms_policies (tenant_id, version, body, commitments, signatory_name, signed_at)
     values ($1, $2, 'We protect the environment.', $3::jsonb, 'Plant Manager', $4) returning id`,
    [tenantId, version, COMPLETE, signedAt]))!
}

/** Opens a change through ms_open_change() as `caller`, with the given impacts. */
async function openChange(
  db: PGlite,
  caller: { userId: string; tenantId: string },
  change: Record<string, unknown>,
  impacts: Record<string, unknown>[],
): Promise<string> {
  return asCaller(db, caller, async () => (await scalar<string>(db,
    'select public.ms_open_change($1::jsonb, $2::jsonb)',
    [JSON.stringify({ tenant_id: caller.tenantId, ...change }), JSON.stringify(impacts)]))!)
}

const resolve = (db: PGlite, impactId: string, note: string | null = null) =>
  asCaller(db, ownerA, () => db.query(
    'update public.ms_change_impacts set resolved_at = now(), resolution_note = $2 where id = $1', [impactId, note]))

describe('migrations 304-306 on a real Postgres', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createEmsDatabase()
  }, DB_SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await db?.close()
  })

  describe('the permit vault (304)', () => {
    it('lets a member read permits, an admin write them, and nobody else either', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      expect(await asCaller(db, memberA, () => count(db, 'select count(*) from public.environmental_permits where id = $1', [permit]))).toBe(1)
      expect(await asCaller(db, adminB, () => count(db, 'select count(*) from public.environmental_permits where id = $1', [permit]))).toBe(0)

      const facility = await facilityOf(db, IDS.tenantA)
      const insert = `insert into public.environmental_permits (tenant_id, program, title, agency, jurisdiction, holder_of_record)
                      values ($1, 'waste', 'EPA ID registration', 'EPA', 'federal', 'Tenant A LLC') returning facility_id`
      await expect(asCaller(db, { ...memberA, facilityId: facility }, () => db.query(insert, [IDS.tenantA])))
        .rejects.toMatchObject({ code: '42501' })
      await expect(asCaller(db, { ...adminB }, () => db.query(insert, [IDS.tenantA])))
        .rejects.toMatchObject({ code: '42501' })
      // The site defaults to the active facility.
      const stamped = await asCaller(db, { ...ownerA, facilityId: facility }, () => scalar<string>(db, insert, [IDS.tenantA]))
      expect(stamped).toBe(facility)
    })

    it('never deletes a permit for a client: it is retired instead', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      await expect(asCaller(db, ownerA, () => db.query('delete from public.environmental_permits where id = $1', [permit])))
        .rejects.toMatchObject({ code: '42501' })
      await expect(db.query(`update public.environmental_permits set retired_at = now() where id = $1`, [permit]))
        .rejects.toMatchObject({ code: '23514' })
      await asCaller(db, ownerA, () => db.query(
        `update public.environmental_permits set retired_at = now(), retired_reason = 'Surrendered after the line closed' where id = $1`, [permit]))
      expect(await scalar(db, 'select retired_reason from public.environmental_permits where id = $1', [permit]))
        .toBe('Surrendered after the line closed')
    })

    it('holds the term together: expiry after issue, the application due on or before expiry', async () => {
      await expect(insertPermit(db, IDS.tenantA, { issued_on: '2030-01-01', expires_on: '2030-01-01' }))
        .rejects.toMatchObject({ code: '23514' })
      await expect(insertPermit(db, IDS.tenantA, { renewal_application_due_on: '2030-01-02' }))
        .rejects.toMatchObject({ code: '23514' })
      await expect(insertPermit(db, IDS.tenantA, { expires_on: null, renewal_application_due_on: '2029-07-01' }))
        .rejects.toMatchObject({ code: '23514' })
      await expect(insertPermit(db, IDS.tenantA, { jurisdiction: 'Texas' })).rejects.toMatchObject({ code: '23514' })
      expect(await insertPermit(db, IDS.tenantA, { renewal_application_due_on: '2030-01-01' })).toBeTruthy()
    })

    it('allows one active record per agency number, and frees the number when it is retired', async () => {
      const first = await insertPermit(db, IDS.tenantA, { agency: 'City of Northfield', permit_number: 'DEMO-IWD-1' })
      await expect(insertPermit(db, IDS.tenantA, { agency: ' city of northfield', permit_number: 'DEMO-IWD-1 ' }))
        .rejects.toMatchObject({ code: '23505' })
      // Another tenant may hold the same number.
      expect(await insertPermit(db, IDS.tenantB, { agency: 'City of Northfield', permit_number: 'DEMO-IWD-1' })).toBeTruthy()
      await db.query(`update public.environmental_permits set retired_at = now(), retired_reason = 'Replaced' where id = $1`, [first])
      expect(await insertPermit(db, IDS.tenantA, { agency: 'City of Northfield', permit_number: 'DEMO-IWD-1' })).toBeTruthy()
    })

    it('holds the owner to a membership, and clears only the owner when the member leaves', async () => {
      await expect(insertPermit(db, IDS.tenantA, { owner_user_id: IDS.adminB })).rejects.toMatchObject({ code: '23503' })
      const permit = await insertPermit(db, IDS.tenantA, { owner_user_id: IDS.memberA })
      await db.query('delete from public.tenant_memberships where user_id = $1 and tenant_id = $2', [IDS.memberA, IDS.tenantA])
      expect(await scalar(db, 'select owner_user_id from public.environmental_permits where id = $1', [permit])).toBeNull()
      expect(await count(db, 'select count(*) from public.environmental_permits where id = $1', [permit])).toBe(1)
      await db.query(`insert into public.tenant_memberships (user_id, tenant_id, role) values ($1, $2, 'member')`, [IDS.memberA, IDS.tenantA])
    })

    it('audits every write', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      await db.query(`update public.environmental_permits set business_critical = true where id = $1`, [permit])
      expect(await count(db, `select count(*) from public.audit_log where table_name = 'environmental_permits' and row_pk = $1`, [permit]))
        .toBe(2)
    })
  })

  describe('the permit guard (304)', () => {
    const retire = (permit: string) => db.query(
      `update public.environmental_permits set retired_at = now(), retired_reason = 'Surrendered' where id = $1`, [permit])

    it('keeps a retired permit as history: it cannot be un-retired or edited, even by a client with write access', async () => {
      const permit = await insertPermit(db, IDS.tenantA, { holder_of_record: OLD_ENTITY })
      await retire(permit)
      for (const change of [
        'retired_at = null, retired_reason = null', `holder_of_record = 'Someone else'`, `title = 'Renamed'`, `business_critical = true`,
      ]) {
        await expect(asCaller(db, ownerA, () => db.query(`update public.environmental_permits set ${change} where id = $1`, [permit])), change)
          .rejects.toMatchObject({ code: '23514' })
      }
      expect(await scalar(db, 'select title from public.environmental_permits where id = $1', [permit])).toBe('Paint booth permit')
    })

    it('still clears a retired permit\'s owner when that member leaves', async () => {
      const permit = await insertPermit(db, IDS.tenantA, { owner_user_id: IDS.memberA })
      await retire(permit)
      await db.query('delete from public.tenant_memberships where user_id = $1 and tenant_id = $2', [IDS.memberA, IDS.tenantA])
      expect(await scalar(db, 'select owner_user_id from public.environmental_permits where id = $1', [permit])).toBeNull()
      await db.query(`insert into public.tenant_memberships (user_id, tenant_id, role) values ($1, $2, 'member')`, [IDS.memberA, IDS.tenantA])
    })

    it('clears a submitted renewal when the term\'s dates change without it being recorded again', async () => {
      const submitted = async () => scalar<string | null>(db, 'select renewal_submitted_on::text from public.environmental_permits where id = $1', [permit])
      const permit = await insertPermit(db, IDS.tenantA, { issued_on: '2025-01-01', expires_on: '2027-01-01', renewal_submitted_on: '2026-10-01' })

      // Other fields, and a correction that does not touch the term, leave it alone.
      await db.query(`update public.environmental_permits set business_critical = true, notes = 'x' where id = $1`, [permit])
      expect(await submitted()).toBe('2026-10-01')

      // The next term entered by editing the dates: the submission belonged to the old one.
      await db.query(`update public.environmental_permits set issued_on = '2027-01-01', expires_on = '2030-01-01' where id = $1`, [permit])
      expect(await submitted()).toBeNull()
    })

    it('keeps a submission recorded in the same write as the dates', async () => {
      const permit = await insertPermit(db, IDS.tenantA, { issued_on: '2025-01-01', expires_on: '2027-01-01' })
      await db.query(`update public.environmental_permits set renewal_application_due_on = '2026-12-01', renewal_submitted_on = '2026-10-02' where id = $1`, [permit])
      expect(await scalar(db, 'select renewal_submitted_on::text from public.environmental_permits where id = $1', [permit])).toBe('2026-10-02')
    })
  })

  describe('conditions are obligations (304)', () => {
    it('links a condition only to its own tenant\'s permit, and only as a permit obligation', async () => {
      const permitA = await insertPermit(db, IDS.tenantA)
      const permitB = await insertPermit(db, IDS.tenantB)
      expect(await insertObligation(db, IDS.tenantA, { permit_id: permitA })).toBeTruthy()
      await expect(insertObligation(db, IDS.tenantA, { permit_id: permitB })).rejects.toMatchObject({ code: '23503' })
      await expect(insertObligation(db, IDS.tenantA, { permit_id: permitA, source_kind: 'law' }))
        .rejects.toMatchObject({ code: '23514' })
    })

    it('shows the link on the register view every obligation reader uses', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      const obligation = await insertObligation(db, IDS.tenantA, { permit_id: permit })
      expect(await scalar(db, 'select permit_id from public.ms_obligation_register where id = $1', [obligation])).toBe(permit)
      expect(await count(db, 'select count(*) from public.ms_obligation_register'))
        .toBe(await count(db, 'select count(*) from public.compliance_calendar_obligations'))
    })
  })

  describe('ms_advance_due_date (304)', () => {
    const dates = ['2026-01-31', '2026-03-31', '2026-04-30', '2026-12-31', '2027-01-29', '2028-02-29', '2026-10-02']

    it('moves a due date on exactly as advanceDueDate() does, month overflow included', async () => {
      for (const cadence of OBLIGATION_CADENCES) {
        for (const date of dates) {
          for (const cadenceDays of cadence === 'custom_days' ? [null, 0, 1, 45] : [null]) {
            const sql = await scalar<string>(db, `select public.ms_advance_due_date($1::date, $2, $3)::text`, [date, cadence, cadenceDays])
            expect(sql, `${cadence} ${cadenceDays} from ${date}`).toBe(advanceDueDate(date, cadence, cadenceDays))
          }
        }
      }
    })
  })

  describe('ms_record_obligation_occurrence (304)', () => {
    const record = (caller: { userId: string; tenantId: string }, obligation: string, dueOn: string, note: string | null = 'Sampled both outfalls') =>
      asCaller(db, caller, () => scalar<string>(db,
        'select public.ms_record_obligation_occurrence($1, $2::date, $3)', [obligation, dueOn, note]))

    it('lets the owner record it: one event, and the due date moves on', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, { owner_user_id: IDS.memberA, next_due_at: '2026-01-31' })
      const event = await record(memberA, obligation, '2026-01-31')
      expect(await scalar(db, 'select occurrence_at::text from public.compliance_calendar_events where id = $1', [event])).toBe('2026-01-31')
      expect(await scalar(db, 'select completed_by from public.compliance_calendar_events where id = $1', [event])).toBe(IDS.memberA)
      expect(await scalar(db, 'select next_due_at::text from public.compliance_calendar_obligations where id = $1', [obligation]))
        .toBe(advanceDueDate('2026-01-31', 'quarterly'))
      // The audit trail names the owner, not the definer.
      expect(await scalar(db,
        `select actor_id from public.audit_log where table_name = 'compliance_calendar_events' and row_pk = $1`, [event]))
        .toBe(IDS.memberA)
    })

    it('refuses a second record of the same occurrence, so a double click cannot skip a period', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, { owner_user_id: IDS.memberA, next_due_at: '2026-06-30' })
      await record(memberA, obligation, '2026-06-30')
      await expect(record(memberA, obligation, '2026-06-30')).rejects.toMatchObject({ code: '23514' })
    })

    it('lets an admin record it, and refuses another member and another tenant as if it did not exist', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, { next_due_at: '2026-03-31' })
      await expect(record(memberA, obligation, '2026-03-31')).rejects.toMatchObject({ code: 'P0002' })
      await expect(record(adminB, obligation, '2026-03-31')).rejects.toMatchObject({ code: 'P0002' })
      expect(await record(ownerA, obligation, '2026-03-31')).toBeTruthy()
    })

    it('completes a one-off obligation, and then refuses another record', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, { cadence: 'once', next_due_at: '2026-11-15' })
      await record(ownerA, obligation, '2026-11-15')
      expect(await scalar(db, 'select status from public.compliance_calendar_obligations where id = $1', [obligation])).toBe('completed')
      await expect(record(ownerA, obligation, '2026-11-15')).rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('ms_notification_log (304)', () => {
    it('keys a notice once, and is out of reach of every client', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      const insert = `insert into public.ms_notification_log (tenant_id, subject_type, subject_id, notice_key)
                      values ($1, 'environmental_permit', $2, 'renewal:90:2030-01-01')`
      await db.query(insert, [IDS.tenantA, permit])
      await expect(db.query(insert, [IDS.tenantA, permit])).rejects.toMatchObject({ code: '23505' })
      await expect(asCaller(db, ownerA, () => db.query('select * from public.ms_notification_log'))).rejects.toMatchObject({ code: '42501' })
    })
  })

  describe('ms_normalize_legal_entity (305)', () => {
    it('agrees with normalizeLegalEntity() in packages/core', async () => {
      const names = [
        NEW_ENTITY, 'Northfield Forge & Finish, L.L.C.', '  Acme \t Holdings\r\nInc.  ', 'ACME', 'SOCIÉTÉ Générale',
        'Forge-Finish LLC', '', 'a,b.c',
      ]
      for (const name of names) {
        expect(await scalar(db, 'select public.ms_normalize_legal_entity($1)', [name]), JSON.stringify(name)).toBe(normalizeLegalEntity(name))
      }
    })
  })

  describe('management of change (305)', () => {
    it('opens a change with its impacts in one transaction, for an admin only', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      const impacts = [{ target_type: 'permit', target_id: permit, step: 'notify_agency', step_order: 1, action_required: 'Notify the agency.' }]
      const change = { kind: 'ownership_name', title: 'Sale of the plant', description: 'New owner.', new_legal_entity: NEW_ENTITY }
      const id = await openChange(db, ownerA, change, impacts)
      expect(await count(db, 'select count(*) from public.ms_change_impacts where change_id = $1', [id])).toBe(1)
      expect(await scalar(db, 'select requested_by from public.ms_changes where id = $1', [id])).toBe(IDS.ownerA)
      await expect(openChange(db, memberA, change, impacts)).rejects.toMatchObject({ code: '42501' })
    })

    it('refuses a target outside the tenant, and stores nothing', async () => {
      const foreign = await insertPermit(db, IDS.tenantB)
      const before = await count(db, 'select count(*) from public.ms_changes')
      await expect(openChange(db, ownerA,
        { kind: 'ownership_name', title: 'Sale', description: 'New owner.', new_legal_entity: NEW_ENTITY },
        [{ target_type: 'permit', target_id: foreign, step: 'notify_agency', step_order: 1, action_required: 'Notify.' }]))
        .rejects.toMatchObject({ code: '23503' })
      expect(await count(db, 'select count(*) from public.ms_changes')).toBe(before)
    })

    it('checks the shape of a change: the new entity for an ownership change only, an area for a site change', async () => {
      await expect(openChange(db, ownerA, { kind: 'ownership_name', title: 'Sale', description: 'x' }, []))
        .rejects.toMatchObject({ code: '23514' })
      await expect(openChange(db, ownerA, { kind: 'other', title: 'x', description: 'x', new_legal_entity: NEW_ENTITY }, []))
        .rejects.toMatchObject({ code: '23514' })
      await expect(openChange(db, ownerA, { kind: 'equipment', title: 'New press', description: 'x' }, []))
        .rejects.toMatchObject({ code: '23514' })
    })

    describe('the ownership checklist', () => {
      let changeId: string
      let permit: string
      let steps: Record<string, string>
      let scopeImpact: string
      let policyImpact: string

      beforeAll(async () => {
        const facility = await facilityOf(db, IDS.tenantA)
        permit = await insertPermit(db, IDS.tenantA, { facility_id: facility, holder_of_record: OLD_ENTITY })
        const scope = await insertScope(db, IDS.tenantA, OLD_ENTITY, '2020-01-01')
        const policy = await insertPolicy(db, IDS.tenantA, '2020-01-01')
        const stepRows = ['notify_agency', 'submit_transfer', 'confirm_holder'].map((step, i) => (
          { target_type: 'permit', target_id: permit, step, step_order: i + 1, action_required: `Step ${i + 1}.` }))
        changeId = await openChange(db, ownerA,
          { kind: 'ownership_name', title: 'Sale of the plant', description: 'New owner.', new_legal_entity: NEW_ENTITY },
          [...stepRows,
            { target_type: 'scope', target_id: scope, action_required: 'Issue a new scope version.' },
            { target_type: 'policy', target_id: policy, action_required: 'Sign the policy again.' }])
        const rows = (await db.query<{ id: string; target_type: string; step: string | null }>(
          'select id, target_type, step from public.ms_change_impacts where change_id = $1', [changeId])).rows
        steps = Object.fromEntries(rows.filter(r => r.step).map(r => [r.step!, r.id]))
        scopeImpact = rows.find(r => r.target_type === 'scope')!.id
        policyImpact = rows.find(r => r.target_type === 'policy')!.id
      })

      it('needs evidence for every transfer step', async () => {
        await expect(resolve(db, steps.notify_agency)).rejects.toMatchObject({ code: '23514' })
        await fileEvidence(db, IDS.tenantA, 'ms_change_impact', steps.notify_agency)
        await resolve(db, steps.notify_agency)
        expect(await scalar(db, 'select resolved_by from public.ms_change_impacts where id = $1', [steps.notify_agency])).toBe(IDS.ownerA)
      })

      it('seals a resolved impact, and its evidence with it', async () => {
        await expect(resolve(db, steps.notify_agency, 'again')).rejects.toMatchObject({ code: '23514' })
        await expect(fileEvidence(db, IDS.tenantA, 'ms_change_impact', steps.notify_agency)).rejects.toMatchObject({ code: '23000' })
        await expect(asCaller(db, ownerA, () => db.query(
          `update public.ms_change_impacts set action_required = 'Something else' where id = $1`, [steps.submit_transfer])))
          .rejects.toMatchObject({ code: '23514' })
      })

      it('refuses to confirm the holder while the permit still names the old owner', async () => {
        await fileEvidence(db, IDS.tenantA, 'ms_change_impact', steps.confirm_holder)
        await expect(resolve(db, steps.confirm_holder)).rejects.toMatchObject({ code: '23514' })
        await db.query('update public.environmental_permits set holder_of_record = $2 where id = $1', [permit, 'Northfield Forge & Finish, L.L.C.'])
        await resolve(db, steps.confirm_holder)
      })

      it('closes the scope impact only once the scope in force names the new entity', async () => {
        await expect(resolve(db, scopeImpact)).rejects.toMatchObject({ code: '23514' })
        await insertScope(db, IDS.tenantA, NEW_ENTITY, '2026-11-01')
        await resolve(db, scopeImpact)
      })

      it('closes the policy impact only once the policy is signed on or after that scope change', async () => {
        await expect(resolve(db, policyImpact)).rejects.toMatchObject({ code: '23514' })
        await insertPolicy(db, IDS.tenantA, '2026-10-31')
        await expect(resolve(db, policyImpact)).rejects.toMatchObject({ code: '23514' })
        await insertPolicy(db, IDS.tenantA, '2026-11-01')
        await resolve(db, policyImpact)
      })

      it('closes only when every impact is resolved and no active permit still names the old holder, then seals the change', async () => {
        const close = () => asCaller(db, ownerA, () => db.query(`update public.ms_changes set status = 'closed' where id = $1`, [changeId]))
        await expect(close()).rejects.toMatchObject({ code: '23514' })
        await fileEvidence(db, IDS.tenantA, 'ms_change_impact', steps.submit_transfer)
        await resolve(db, steps.submit_transfer)

        // Every impact is resolved, but a permit added after the change opened is not on its checklist.
        await db.query(
          `update public.environmental_permits set retired_at = now(), retired_reason = 'Test cleanup'
            where tenant_id = $1 and retired_at is null and id <> $2`, [IDS.tenantA, permit])
        const late = await insertPermit(db, IDS.tenantA, { title: 'Late permit', holder_of_record: OLD_ENTITY })
        await expect(close()).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('"Late permit" still names another holder') })
        await db.query(`update public.environmental_permits set holder_of_record = $2 where id = $1`, [late, NEW_ENTITY])
        await close()
        expect(await scalar(db, 'select ended_by from public.ms_changes where id = $1', [changeId])).toBe(IDS.ownerA)
        await expect(asCaller(db, ownerA, () => db.query(`update public.ms_changes set title = 'Renamed' where id = $1`, [changeId])))
          .rejects.toMatchObject({ code: '23514' })
      })
    })

    it('lets a permit retired while the change was open be confirmed with its evidence, since it has no holder left to update', async () => {
      const permit = await insertPermit(db, IDS.tenantA, { title: 'Retired mid-change', holder_of_record: OLD_ENTITY })
      const id = await openChange(db, ownerA, { kind: 'ownership_name', title: 'Second sale', description: 'x', new_legal_entity: 'Third Owner LLC' },
        [{ target_type: 'permit', target_id: permit, step: 'confirm_holder', step_order: 3, action_required: 'Confirm the holder.' }])
      const impact = (await scalar<string>(db, 'select id from public.ms_change_impacts where change_id = $1', [id]))!
      await fileEvidence(db, IDS.tenantA, 'ms_change_impact', impact)
      await expect(resolve(db, impact)).rejects.toMatchObject({ code: '23514' })
      await db.query(`update public.environmental_permits set retired_at = now(), retired_reason = 'Surrendered' where id = $1`, [permit])
      await resolve(db, impact)
    })

    it('does not let a change of owner with an empty checklist close while a permit still names the old holder', async () => {
      await insertPermit(db, IDS.tenantA, { title: 'Still old', holder_of_record: OLD_ENTITY })
      const id = await openChange(db, ownerA, { kind: 'ownership_name', title: 'Bare change', description: 'x', new_legal_entity: 'Fourth Owner LLC' }, [])
      await expect(asCaller(db, ownerA, () => db.query(`update public.ms_changes set status = 'closed' where id = $1`, [id])))
        .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('still names another holder') })
      await asCaller(db, ownerA, () => db.query(`update public.ms_changes set status = 'cancelled', cancelled_reason = 'Not going ahead' where id = $1`, [id]))
    })

    it('needs a note to resolve any other impact', async () => {
      const aspect = await scalar<string>(db, 'select id from public.environmental_aspects where tenant_id = $1 limit 1', [IDS.tenantA])
      const area = await scalar<string>(db, 'select process_area from public.environmental_aspects where id = $1', [aspect])
      const id = await openChange(db, ownerA,
        { kind: 'equipment', title: 'New press', description: 'A second press.', process_area: area ?? 'Press' },
        [{ target_type: 'aspect', target_id: aspect, action_required: 'Review the aspect.' }])
      const impact = await scalar<string>(db, 'select id from public.ms_change_impacts where change_id = $1', [id])
      await expect(resolve(db, impact!, '  ')).rejects.toMatchObject({ code: '23514' })
      await resolve(db, impact!, 'Rescored; significance unchanged.')
    })

    it('fixes what the impacts were worked out from, and lets a change be cancelled with a reason', async () => {
      const id = await openChange(db, ownerA, { kind: 'process', title: 'New rinse', description: 'x', process_area: 'Finishing' }, [])
      await expect(asCaller(db, ownerA, () => db.query(`update public.ms_changes set process_area = 'Forge' where id = $1`, [id])))
        .rejects.toMatchObject({ code: '23514' })
      await asCaller(db, ownerA, () => db.query(`update public.ms_changes set title = 'New rinse tank' where id = $1`, [id]))
      await expect(asCaller(db, ownerA, () => db.query(`update public.ms_changes set status = 'cancelled' where id = $1`, [id])))
        .rejects.toMatchObject({ code: '23514' })
      await asCaller(db, ownerA, () => db.query(
        `update public.ms_changes set status = 'cancelled', cancelled_reason = 'Project shelved' where id = $1`, [id]))
      expect(await scalar(db, 'select status from public.ms_changes where id = $1', [id])).toBe('cancelled')
    })

    it('lets members read changes and impacts, never delete them', async () => {
      const id = await openChange(db, ownerA, { kind: 'other', title: 'New supplier', description: 'x' }, [])
      expect(await asCaller(db, memberA, () => count(db, 'select count(*) from public.ms_changes where id = $1', [id]))).toBe(1)
      expect(await asCaller(db, adminB, () => count(db, 'select count(*) from public.ms_changes where id = $1', [id]))).toBe(0)
      await expect(asCaller(db, ownerA, () => db.query('delete from public.ms_changes where id = $1', [id])))
        .rejects.toMatchObject({ code: '42501' })
    })
  })

  describe('evidence subjects (306)', () => {
    it('files a permit document, and refuses one once the permit is retired', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      expect(await fileEvidence(db, IDS.tenantA, 'environmental_permit', permit)).toBeTruthy()
      await db.query(`update public.environmental_permits set retired_at = now(), retired_reason = 'Surrendered' where id = $1`, [permit])
      await expect(fileEvidence(db, IDS.tenantA, 'environmental_permit', permit)).rejects.toMatchObject({ code: '23000' })
    })

    it('refuses a new subject that is not a record of the same tenant', async () => {
      const permitB = await insertPermit(db, IDS.tenantB)
      await expect(fileEvidence(db, IDS.tenantA, 'environmental_permit', permitB)).rejects.toMatchObject({ code: '23503' })
      const missing = '99999999-9999-4999-8999-999999999999'
      for (const subject of ['ms_change_impact', 'compliance_calendar_event', 'compliance_obligation']) {
        await expect(fileEvidence(db, IDS.tenantA, subject, missing)).rejects.toMatchObject({ code: '23503' })
      }
      await expect(fileEvidence(db, IDS.tenantA, 'aspect', missing)).rejects.toMatchObject({ code: '23514' })
    })

    it('files proof of an occurrence and an obligation\'s rule text', async () => {
      const obligation = await insertObligation(db, IDS.tenantA, { next_due_at: '2026-09-30' })
      const event = await asCaller(db, ownerA, () => scalar<string>(db,
        'select public.ms_record_obligation_occurrence($1, $2::date, null)', [obligation, '2026-09-30']))
      expect(await fileEvidence(db, IDS.tenantA, 'compliance_calendar_event', event!)).toBeTruthy()
      expect(await fileEvidence(db, IDS.tenantA, 'compliance_obligation', obligation)).toBeTruthy()
    })

    it('fixes the export-control flag at upload', async () => {
      const permit = await insertPermit(db, IDS.tenantA)
      const evidence = await fileEvidence(db, IDS.tenantA, 'environmental_permit', permit, true)
      await expect(db.query('update public.ms_evidence set export_controlled = false where id = $1', [evidence]))
        .rejects.toMatchObject({ code: '23000' })
    })
  })

  describe('tenant deletion', () => {
    it('takes a tenant\'s permits, changes, impacts and notices with it', async () => {
      const fresh = await createEmsDatabase()
      try {
        const permit = await insertPermit(fresh, IDS.tenantB)
        await insertObligation(fresh, IDS.tenantB, { permit_id: permit })
        await openChange(fresh, adminB, { kind: 'ownership_name', title: 'Sale', description: 'x', new_legal_entity: NEW_ENTITY },
          [{ target_type: 'permit', target_id: permit, step: 'notify_agency', step_order: 1, action_required: 'Notify.' }])
        await fresh.query(`insert into public.ms_notification_log (tenant_id, subject_type, subject_id, notice_key)
                           values ($1, 'environmental_permit', $2, 'renewal:30:2030-01-01')`, [IDS.tenantB, permit])
        await fresh.query('delete from public.tenants where id = $1', [IDS.tenantB])
        for (const table of ['environmental_permits', 'ms_changes', 'ms_change_impacts', 'ms_notification_log']) {
          expect(await count(fresh, `select count(*) from public.${table}`), table).toBe(0)
        }
      } finally {
        await fresh.close()
      }
    }, DB_SETUP_TIMEOUT_MS)
  })

  describe('re-runs and rollbacks', () => {
    it('re-running 304-306 changes nothing', async () => {
      const before = await count(db, 'select count(*) from public.environmental_permits')
      for (const file of PHASE2_MIGRATIONS) await db.exec(migrationSql(file))
      expect(await count(db, 'select count(*) from public.environmental_permits')).toBe(before)
    })

    it('rolls back to Phase 1.1\'s exact shape, keeps filed evidence, and applies again', async () => {
      const fresh = await createEmsDatabase()
      try {
        const permit = await insertPermit(fresh, IDS.tenantA)
        const evidence = await fileEvidence(fresh, IDS.tenantA, 'environmental_permit', permit, true)
        for (const file of [...PHASE2_MIGRATIONS].reverse()) await fresh.exec(migrationSql(file.replace(/_.*$/, '_rollback.sql')))

        for (const table of ['environmental_permits', 'ms_changes', 'ms_change_impacts', 'ms_notification_log']) {
          expect(await scalar(fresh, 'select to_regclass($1)::text', [`public.${table}`]), table).toBeNull()
        }
        for (const fn of ['ms_advance_due_date', 'ms_record_obligation_occurrence', 'ms_normalize_legal_entity', 'ms_open_change']) {
          expect(await count(fresh, 'select count(*) from pg_proc where proname = $1', [fn]), fn).toBe(0)
        }
        expect(await count(fresh, `select count(*) from information_schema.columns
                                    where table_name = 'compliance_calendar_obligations' and column_name = 'permit_id'`)).toBe(0)
        expect(await count(fresh, `select count(*) from information_schema.columns
                                    where table_name = 'ms_obligation_register' and column_name = 'permit_id'`)).toBe(0)
        expect(await scalar(fresh, `select reloptions::text from pg_class where relname = 'ms_obligation_register'`))
          .toContain('security_invoker=true')
        // Evidence is never deleted: the filed row survives, and 299's subject list holds new rows.
        expect(await count(fresh, 'select count(*) from public.ms_evidence where id = $1', [evidence])).toBe(1)
        await expect(fileEvidence(fresh, IDS.tenantA, 'environmental_permit', permit)).rejects.toMatchObject({ code: '23514' })

        for (const file of PHASE2_MIGRATIONS) await fresh.exec(migrationSql(file))
        expect(await scalar(fresh, 'select to_regclass($1)::text', ['public.ms_changes'])).toBe('ms_changes')
      } finally {
        await fresh.close()
      }
    }, DB_SETUP_TIMEOUT_MS)
  })
})
