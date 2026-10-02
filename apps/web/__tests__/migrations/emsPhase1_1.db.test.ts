// @vitest-environment node
//
// Migration 302 (Phase 1.1) against a real Postgres (PGlite), exercised as
// real users: what the database itself refuses, not just what the SQL says.
//
// SQLSTATEs asserted below:
//   23503 foreign_key_violation      23505 unique_violation
//   23514 check_violation            42501 insufficient_privilege (grants and RLS)

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { IDS, PHASE1_1_MIGRATIONS, asCaller, createEmsDatabase, migrationSql, scalar } from './_emsTestDatabase'

const DB_SETUP_TIMEOUT_MS = 120_000

const ownerA  = { userId: IDS.ownerA,  tenantId: IDS.tenantA }
const memberA = { userId: IDS.memberA, tenantId: IDS.tenantA }
const adminB  = { userId: IDS.adminB,  tenantId: IDS.tenantB }

const COMPLETE = '{"ems.protect_environment": true, "ems.fulfil_obligations": true, "ems.continual_improvement": true}'

async function insertPolicy(db: PGlite, tenantId: string, discipline = 'ems'): Promise<string> {
  const version = Number(await scalar<number>(db,
    'select coalesce(max(version), 0) + 1 from public.ms_policies where tenant_id = $1 and discipline = $2', [tenantId, discipline]))
  return (await scalar<string>(db,
    `insert into public.ms_policies (tenant_id, discipline, version, body, commitments, signatory_name, signed_at)
     values ($1, $2, $3, 'We protect the environment.', $4::jsonb, 'Plant Manager', current_date) returning id`,
    [tenantId, discipline, version, COMPLETE]))!
}

async function communicate(db: PGlite, tenantId: string, policyId: string, discipline = 'ems'): Promise<string> {
  return (await scalar<string>(db,
    `insert into public.ms_policy_communications (tenant_id, discipline, policy_id, audience, method, communicated_on)
     values ($1, $2, $3, 'internal', 'Posted at both entrances', current_date) returning id`,
    [tenantId, discipline, policyId]))!
}

async function count(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  return Number(await scalar<number>(db, sql, params))
}

describe('migration 302 on a real Postgres', () => {
  let db: PGlite

  beforeAll(async () => {
    db = await createEmsDatabase()
  }, DB_SETUP_TIMEOUT_MS)

  afterAll(async () => {
    await db?.close()
  })

  describe('aspects: control or influence (6.1.2)', () => {
    it('accepts control, influence, or not yet decided, and nothing else', async () => {
      const aspect = await scalar<string>(db, 'select id from public.environmental_aspects where tenant_id = $1 limit 1', [IDS.tenantA])
      await db.query(`update public.environmental_aspects set control_level = 'influence' where id = $1`, [aspect])
      await db.query(`update public.environmental_aspects set control_level = null where id = $1`, [aspect])
      await expect(db.query(`update public.environmental_aspects set control_level = 'partial' where id = $1`, [aspect]))
        .rejects.toMatchObject({ code: '23514' })
    })

    it('shows it on the register view, which every aspect reader uses', async () => {
      const aspect = await scalar<string>(db, 'select id from public.environmental_aspects where tenant_id = $1 limit 1', [IDS.tenantA])
      await db.query(`update public.environmental_aspects set control_level = 'control' where id = $1`, [aspect])
      expect(await scalar(db, 'select control_level from public.environmental_aspect_register where id = $1', [aspect])).toBe('control')
      // Still one row per aspect, scores still folded in.
      expect(await count(db, 'select count(*) from public.environmental_aspect_register'))
        .toBe(await count(db, 'select count(*) from public.environmental_aspects'))
    })
  })

  describe('scope: control and influence, exclusions (4.3)', () => {
    it('keeps older versions valid without them, and refuses a blank one', async () => {
      const insert = (control: string | null, exclusions: string | null, version: number) => db.query(
        `insert into public.ms_scope_statements
           (tenant_id, version, legal_entity, physical_boundary, activities, products_services, control_and_influence, exclusions)
         values ($1, $2, 'Tenant A LLC', 'The plant fence line', 'Forging', 'Forgings', $3, $4)`,
        [IDS.tenantA, version, control, exclusions])
      await insert(null, null, 1)
      await insert('We control on-site operations; we influence suppliers and carriers.', 'None.', 2)
      await expect(insert('  ', null, 3)).rejects.toMatchObject({ code: '23514' })
      await expect(insert('Stated.', '', 3)).rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('policy communications (5.2)', () => {
    it('lets members read and admins record, but never edit or delete', async () => {
      const policy = await insertPolicy(db, IDS.tenantA)
      const communication = await asCaller(db, ownerA, () => communicate(db, IDS.tenantA, policy))

      await asCaller(db, memberA, async () => {
        expect(await count(db, 'select count(*) from public.ms_policy_communications where id = $1', [communication])).toBe(1)
        await expect(communicate(db, IDS.tenantA, policy)).rejects.toMatchObject({ code: '42501' })
      })
      await asCaller(db, ownerA, async () => {
        await expect(db.query(`update public.ms_policy_communications set method = 'Edited' where id = $1`, [communication]))
          .rejects.toMatchObject({ code: '42501' })
        await expect(db.query('delete from public.ms_policy_communications where id = $1', [communication]))
          .rejects.toMatchObject({ code: '42501' })
      })
    })

    it('hides one tenant\'s communications from another, and refuses writing into it', async () => {
      const policy = await insertPolicy(db, IDS.tenantA)
      await communicate(db, IDS.tenantA, policy)
      await asCaller(db, adminB, async () => {
        expect(await count(db, 'select count(*) from public.ms_policy_communications where tenant_id = $1', [IDS.tenantA])).toBe(0)
        await expect(communicate(db, IDS.tenantA, policy)).rejects.toMatchObject({ code: '42501' })
      })
    })

    it('refuses a communication of another tenant\'s policy, or of a policy in another discipline', async () => {
      const policyA = await insertPolicy(db, IDS.tenantA)
      await expect(communicate(db, IDS.tenantB, policyA)).rejects.toMatchObject({ code: '23503' })
      await expect(communicate(db, IDS.tenantA, policyA, 'integrated')).rejects.toMatchObject({ code: '23503' })
    })

    it('records who wrote it in the audit log', async () => {
      const policy = await insertPolicy(db, IDS.tenantA)
      const communication = await asCaller(db, ownerA, () => communicate(db, IDS.tenantA, policy))
      expect(await scalar(db,
        `select actor_id from public.audit_log where table_name = 'ms_policy_communications' and row_pk = $1`,
        [communication])).toBe(IDS.ownerA)
    })
  })

  describe('responsibilities (4.4, 5.3)', () => {
    const assign = (tenantId: string, key: string, owner: string | null) => db.query(
      `insert into public.ms_responsibilities (tenant_id, responsibility_key, owner_user_id, assigned_by)
       values ($1, $2, $3, $3)
       on conflict (tenant_id, discipline, responsibility_key)
       do update set owner_user_id = excluded.owner_user_id, assigned_by = excluded.assigned_by`,
      [tenantId, key, owner])

    it('lets admins assign and reassign, members only read', async () => {
      await asCaller(db, ownerA, async () => {
        await assign(IDS.tenantA, 'system_conformity', IDS.ownerA)
        await assign(IDS.tenantA, 'system_conformity', IDS.memberA)
      })
      expect(await scalar(db,
        `select owner_user_id from public.ms_responsibilities where tenant_id = $1 and responsibility_key = 'system_conformity'`,
        [IDS.tenantA])).toBe(IDS.memberA)
      await asCaller(db, memberA, async () => {
        expect(await count(db, 'select count(*) from public.ms_responsibilities where tenant_id = $1', [IDS.tenantA])).toBe(1)
        await expect(assign(IDS.tenantA, 'aspects', IDS.memberA)).rejects.toMatchObject({ code: '42501' })
      })
    })

    it('keeps a tenant\'s assignments to itself', async () => {
      await assign(IDS.tenantA, 'aspects', IDS.ownerA)
      await asCaller(db, adminB, async () => {
        expect(await count(db, 'select count(*) from public.ms_responsibilities where tenant_id = $1', [IDS.tenantA])).toBe(0)
        await expect(assign(IDS.tenantA, 'policy', IDS.adminB)).rejects.toMatchObject({ code: '42501' })
      })
    })

    it('holds one owner per responsibility, and only known responsibilities', async () => {
      await assign(IDS.tenantA, 'obligations', IDS.ownerA)
      await expect(db.query(
        `insert into public.ms_responsibilities (tenant_id, responsibility_key, owner_user_id) values ($1, 'obligations', $2)`,
        [IDS.tenantA, IDS.memberA])).rejects.toMatchObject({ code: '23505' })
      await expect(assign(IDS.tenantA, 'coffee_rota', IDS.ownerA)).rejects.toMatchObject({ code: '23514' })
    })

    it('keeps who held a responsibility before, in the audit log', async () => {
      await asCaller(db, ownerA, async () => {
        await assign(IDS.tenantA, 'policy', IDS.ownerA)
        await assign(IDS.tenantA, 'policy', IDS.memberA)
      })
      const previous = await scalar(db,
        `select old_row ->> 'owner_user_id' from public.audit_log
          where table_name = 'ms_responsibilities' and operation = 'UPDATE' and new_row ->> 'responsibility_key' = 'policy'`)
      expect(previous).toBe(IDS.ownerA)
    })
  })

  describe('re-running and rolling back', () => {
    it('re-runs without changing anything', async () => {
      const before = await count(db, 'select count(*) from public.ms_policy_communications')
      for (const file of PHASE1_1_MIGRATIONS) await db.exec(migrationSql(file))
      expect(await count(db, 'select count(*) from public.ms_policy_communications')).toBe(before)
    })

    it('rolls back to Phase 1\'s exact shape, and forward again', async () => {
      const registerColumns = () => db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'environmental_aspect_register' order by ordinal_position`)
        .then(r => r.rows.map(row => row.column_name))
      const withControlLevel = await registerColumns()

      await db.exec(migrationSql('302_rollback.sql'))
      for (const relation of ['ms_policy_communications', 'ms_responsibilities']) {
        expect(await scalar(db, 'select to_regclass($1)::text', [`public.${relation}`])).toBeNull()
      }
      expect(await registerColumns()).toEqual(withControlLevel.filter(c => c !== 'control_level'))
      expect(await count(db,
        `select count(*) from information_schema.columns
          where table_schema = 'public' and column_name in ('control_level', 'control_and_influence', 'exclusions')`)).toBe(0)
      // Phase 1's own migrations still re-run on the rolled-back shape.
      await db.exec(migrationSql('297_environmental_aspects_register.sql'))

      for (const file of PHASE1_1_MIGRATIONS) await db.exec(migrationSql(file))
      expect(await registerColumns()).toEqual(withControlLevel)
    })
  })
})
