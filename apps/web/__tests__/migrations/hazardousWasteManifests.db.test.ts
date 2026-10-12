// @vitest-environment node
//
// Migration 317 (hazardous waste manifests) applied on top of the Environmental Compliance Suite
// database and the hazardous-waste tables it builds on, against a real Postgres (PGlite), exercised
// as real users. What matters here is what breaks if a rule is quietly loosened:
//
//   * only closed, un-archived containers at the active site, in the caller's account, go on a manifest,
//   * a manifest and its containers change status together or not at all,
//   * the same table of legal transitions the screens read (core's MANIFEST_TRANSITIONS) is the one
//     the database enforces,
//   * a direct update cannot move a manifest, or edit one that has shipped,
//   * RLS: members read and create, the creator or an admin moves a draft along, only an admin
//     deletes, and another account or another site sees nothing.
//
// SQLSTATEs: 23505 unique_violation  23514 check_violation  42501 insufficient_privilege
//            P0002 no_data_found

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { MANIFEST_ACTIONS, MANIFEST_STATUSES, MANIFEST_TRANSITIONS, type ManifestAction, type ManifestStatus } from '@soteria/core/hazardousWasteManifest'
import { IDS, asCaller, migrationSql, scalar, type Caller } from './_emsTestDatabase'
import { createSuiteDatabase } from './_suiteTestDatabase'

const DB_SETUP_TIMEOUT_MS = 180_000
const MIGRATION = '317_hazardous_waste_shipments.sql'
const ROLLBACK = '317_rollback.sql'
const TA = IDS.tenantA
const TB = IDS.tenantB
const MEMBER_C = '00000000-0000-4000-8000-0000000000c3'   // a second plain member of A: not the creator of A's manifests
const SUPER = '00000000-0000-4000-8000-0000000000e5'      // a superadmin who belongs to no account
const DUAL = '00000000-0000-4000-8000-0000000000d6'       // a member of both accounts, who can see both accounts' containers

const ownerA = { userId: IDS.ownerA, tenantId: TA }
const memberA = { userId: IDS.memberA, tenantId: TA }
const memberC = { userId: MEMBER_C, tenantId: TA }
const adminB  = { userId: IDS.adminB, tenantId: TB }
const adminBInA = { userId: IDS.adminB, tenantId: TA }   // an admin of ANOTHER account, working in A's context

let db: PGlite
let siteA: string
let siteB: string
let siteOfB: string
let streamA: string
let streamB: string
let seq = 0

async function insert(client: PGlite, table: string, row: Record<string, unknown>): Promise<string> {
  const columns = Object.keys(row)
  const result = await client.query<{ id: string }>(
    `insert into public.${table} (${columns.join(', ')}) values (${columns.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
    columns.map(column => row[column]),
  )
  return result.rows[0]!.id
}

const DAY_MS = 86_400_000
/** A calendar day relative to today (UTC), as the dates the transitions take. */
const day = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10)

const trackingNumber = () => `${String(100_000_000 + ++seq)}ELC`

const container = (over: Record<string, unknown> = {}) => insert(db, 'hazardous_waste_containers', {
  tenant_id: TA, stream_id: streamA, facility_id: siteA, label: `Drum ${++seq}`, area_type: 'central_accumulation', status: 'closed', ...over,
})
const closedContainers = async (count: number, over: Record<string, unknown> = {}) => {
  const ids: string[] = []
  for (let i = 0; i < count; i++) ids.push(await container(over))
  return ids
}

const create = (caller: Caller, containerIds: string[], fields: Record<string, unknown> = {}) =>
  asCaller(db, caller, async () => (await scalar<string>(db,
    'select public.hw_create_shipment($1::uuid[], $2::jsonb)', [containerIds, JSON.stringify({ generator_category: 'lqg', ...fields })]))!)

const transition = (caller: Caller, id: string, action: ManifestAction, on: string | null = null, note: string | null = null) =>
  asCaller(db, caller, () => db.query('select public.hw_transition_shipment($1, $2, $3::date, $4)', [id, action, on, note]))

async function row<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0] as T
}
const shipment = (id: string) => row<{
  status: ManifestStatus; shipped_on: string | null; completed_on: string | null; exception_reported_on: string | null
  notes: string | null; facility_id: string; tenant_id: string; updated_at: string
}>(`select status, shipped_on::text, completed_on::text, exception_reported_on::text, notes, facility_id, tenant_id, updated_at::text
      from public.hazardous_waste_shipments where id = $1`, [id])
const statusesOf = async (ids: string[]) =>
  (await db.query<{ status: string }>('select status from public.hazardous_waste_containers where id = any($1::uuid[]) order by id', [ids])).rows.map(r => r.status)
const shipmentCount = async () => Number(await scalar(db, 'select count(*) from public.hazardous_waste_shipments'))

/** A draft with two closed containers and a tracking number, ready to ship. */
async function draft(fields: Record<string, unknown> = {}) {
  const containers = await closedContainers(2)
  const id = await create(ownerA, containers, { manifest_tracking_number: trackingNumber(), ...fields })
  return { id, containers }
}

/** A manifest in the given status, reached the only way the database allows: through the transitions. */
async function shipmentIn(status: ManifestStatus) {
  const made = await draft()
  if (status === 'cancelled') await transition(ownerA, made.id, 'cancel')
  if (status === 'draft' || status === 'cancelled') return made
  await transition(ownerA, made.id, 'ship', day(-10))
  if (status === 'completed') await transition(ownerA, made.id, 'receive', day(-5))
  if (status === 'exception_reported') await transition(ownerA, made.id, 'file_exception', day(-5))
  return made
}

/** The shipments the caller can read. */
const visibleTo = (caller: Caller) =>
  asCaller(db, caller, async () => (await db.query<{ id: string }>('select id from public.hazardous_waste_shipments')).rows.map(r => r.id))

/** As the table owner: RLS does not apply, so only what the function itself checks stands in the way. */
async function asOwnerWithClaim<T>(caller: Caller, work: () => Promise<T>): Promise<T> {
  const headers: Record<string, string> = {}
  if (caller.tenantId) headers['x-active-tenant'] = caller.tenantId
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.headers', $2, false)`, [caller.userId, JSON.stringify(headers)])
  try {
    return await work()
  } finally {
    await db.exec(`select set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '', false)`)
  }
}

beforeAll(async () => {
  db = await createSuiteDatabase({ extra: [MIGRATION] })
  await db.exec(`
    insert into auth.users (id, email) values ('${MEMBER_C}', 'member-c@example.test'), ('${SUPER}', 'super@example.test'), ('${DUAL}', 'dual@example.test');
    insert into public.profiles (id, email, is_superadmin) values
      ('${MEMBER_C}', 'member-c@example.test', false), ('${SUPER}', 'super@example.test', true), ('${DUAL}', 'dual@example.test', false);
    insert into public.tenant_memberships (user_id, tenant_id, role) values
      ('${MEMBER_C}', '${TA}', 'member'), ('${DUAL}', '${TA}', 'member'), ('${DUAL}', '${TB}', 'member');
  `)
  siteA = (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [TA]))!
  siteB = await insert(db, 'facilities', { tenant_id: TA, name: 'Site B', code: 'SB', is_primary: false })
  siteOfB = (await scalar<string>(db, 'select id from public.facilities where tenant_id = $1 and is_primary', [TB]))!
  streamA = await insert(db, 'hazardous_waste_streams', { tenant_id: TA, name: 'Spent solvent', facility_id: siteA })
  streamB = await insert(db, 'hazardous_waste_streams', { tenant_id: TB, name: 'Other account stream', facility_id: siteOfB })
}, DB_SETUP_TIMEOUT_MS)

afterAll(async () => { await db?.close() })

describe('applying and rolling back', () => {
  it('can be applied a second time without error, changing nothing', async () => {
    const before = await row('select (select count(*) from pg_policies where tablename like $1) as policies, (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like $1 and not t.tgisinternal) as triggers, (select count(*) from pg_proc where proname like $2) as functions, (select count(*) from pg_indexes where tablename like $1) as indexes',
      ['hazardous_waste_shipment%', 'hw\\_%'])
    const { id } = await draft()
    await db.exec(migrationSql(MIGRATION))
    const after = await row('select (select count(*) from pg_policies where tablename like $1) as policies, (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like $1 and not t.tgisinternal) as triggers, (select count(*) from pg_proc where proname like $2) as functions, (select count(*) from pg_indexes where tablename like $1) as indexes',
      ['hazardous_waste_shipment%', 'hw\\_%'])
    expect(after).toEqual(before)
    expect((await shipment(id)).status).toBe('draft')
  })

  /** Everything about the older hazardous-waste tables that a migration could change, in a comparable form. */
  async function olderTablesShape(client: PGlite): Promise<string> {
    const query = async (sql: string) => JSON.stringify((await client.query(sql)).rows)
    const tables = `('hazardous_waste_streams', 'hazardous_waste_containers', 'hazardous_waste_areas', 'hazardous_waste_inspections')`
    return [
      await query(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
                    where table_schema = 'public' and table_name in ${tables} order by 1, 2`),
      await query(`select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ${tables} order by 1, 2`),
      await query(`select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where c.relname in ${tables} and not t.tgisinternal order by 1, 2`),
      await query(`select conrelid::regclass::text as tbl, conname, pg_get_constraintdef(oid) as def from pg_constraint
                    where conrelid::regclass::text in ('hazardous_waste_streams', 'hazardous_waste_containers', 'hazardous_waste_areas', 'hazardous_waste_inspections') order by 1, 2`),
      await query(`select tablename, indexname, indexdef from pg_indexes where tablename in ${tables} order by 1, 2`),
    ].join('\n')
  }

  it('adds nothing to, and rolls back to exactly, the older hazardous-waste tables, restoring containers it left in shipment', async () => {
    const plain = await createSuiteDatabase()
    const other = await createSuiteDatabase({ extra: [MIGRATION] })
    try {
      const shapeBefore = await olderTablesShape(plain)
      expect(await olderTablesShape(other)).toBe(shapeBefore)

      // One manifest in each state, each with its own containers, through the real functions.
      const site = (await scalar<string>(other, 'select id from public.facilities where tenant_id = $1 and is_primary', [TA]))!
      const stream = await insert(other, 'hazardous_waste_streams', { tenant_id: TA, name: 'S', facility_id: site })
      const asOwner = <T>(work: () => Promise<T>) => asCaller(other, ownerA, work)
      const made = async (target: ManifestStatus) => {
        const ids: string[] = []
        for (let i = 0; i < 2; i++) ids.push(await insert(other, 'hazardous_waste_containers', { tenant_id: TA, stream_id: stream, facility_id: site, label: `${target}-${i}`, area_type: 'central_accumulation', status: 'closed' }))
        const id = (await asOwner(() => scalar<string>(other, 'select public.hw_create_shipment($1::uuid[], $2::jsonb)', [ids, JSON.stringify({ generator_category: 'lqg', manifest_tracking_number: `${String(200_000_000 + ids.length + MANIFEST_STATUSES.indexOf(target))}ELC` })])))!
        const step = (action: ManifestAction, on: string | null) => asOwner(() => other.query('select public.hw_transition_shipment($1, $2, $3::date)', [id, action, on]))
        if (target === 'cancelled') await step('cancel', null)
        if (target !== 'draft' && target !== 'cancelled') await step('ship', day(-10))
        if (target === 'completed') await step('receive', day(-5))
        if (target === 'exception_reported') await step('file_exception', day(-5))
        return ids
      }
      const byStatus = Object.fromEntries(await Promise.all(MANIFEST_STATUSES.map(async s => [s, await made(s)] as const)))
      const statuses = async (ids: string[]) => (await other.query<{ status: string }>('select status from public.hazardous_waste_containers where id = any($1::uuid[])', [ids])).rows.map(r => r.status)
      expect(await statuses(byStatus.draft)).toEqual(['in_shipment', 'in_shipment'])

      await other.exec(migrationSql(ROLLBACK))

      expect(await statuses(byStatus.draft)).toEqual(['closed', 'closed'])
      expect(await statuses(byStatus.shipped)).toEqual(['closed', 'closed'])
      expect(await statuses(byStatus.exception_reported)).toEqual(['closed', 'closed'])
      expect(await statuses(byStatus.completed)).toEqual(['disposed', 'disposed'])
      expect(await statuses(byStatus.cancelled)).toEqual(['closed', 'closed'])
      for (const name of ['hazardous_waste_shipments', 'hazardous_waste_shipment_containers']) {
        expect(await scalar(other, `select to_regclass('public.${name}')::text`)).toBeNull()
      }
      expect(await scalar(other, `select count(*) from pg_proc where proname in ('hw_create_shipment', 'hw_transition_shipment', 'hw_manifest_refuse', 'hw_shipments_guard', 'hw_shipments_release_containers', 'hw_shipment_container_guard')`)).toBe(0)
      expect(await olderTablesShape(other)).toBe(shapeBefore)
      expect(await scalar(other, 'select count(*) from public.hazardous_waste_containers')).toBe(10)

      // Rolling back twice is harmless, and the migration applies again afterwards.
      await other.exec(migrationSql(ROLLBACK))
      await other.exec(migrationSql(MIGRATION))
      expect(await scalar(other, `select to_regclass('public.hazardous_waste_shipments')::text`)).toBe('hazardous_waste_shipments')
    } finally {
      await plain.close()
      await other.close()
    }
  }, DB_SETUP_TIMEOUT_MS)
})

describe('creating a manifest (hw_create_shipment)', () => {
  it('makes a draft at the containers\' site and puts those containers in shipment, in one step', async () => {
    const containers = await closedContainers(2)
    const id = await create(memberA, containers, {
      manifest_tracking_number: ' ', jurisdiction: 'state:CA', generator_epa_id: 'CAL000123456', transporter_name: ' Haul Co ',
      waste_codes: ['D001', '134'], dot_description: 'UN1993', electronic: true, notes: '',
    })

    expect(await row('select status, facility_id, tenant_id, created_by, generator_category, jurisdiction, generator_epa_id, transporter_name, waste_codes, dot_description, electronic, notes, manifest_tracking_number, shipped_on from public.hazardous_waste_shipments where id = $1', [id]))
      .toEqual({
        status: 'draft', facility_id: siteA, tenant_id: TA, created_by: IDS.memberA, generator_category: 'lqg', jurisdiction: 'state:CA',
        generator_epa_id: 'CAL000123456', transporter_name: 'Haul Co', waste_codes: ['D001', '134'], dot_description: 'UN1993',
        electronic: true, notes: null, manifest_tracking_number: null, shipped_on: null,
      })
    expect(await scalar(db, 'select count(*) from public.hazardous_waste_shipment_containers where shipment_id = $1 and released_at is null', [id])).toBe(2)
    expect(await statusesOf(containers)).toEqual(['in_shipment', 'in_shipment'])
  })

  it('defaults to a federal manifest with no codes, on paper', async () => {
    const id = await create(memberA, await closedContainers(1))
    expect(await row('select jurisdiction, waste_codes, electronic from public.hazardous_waste_shipments where id = $1', [id]))
      .toEqual({ jurisdiction: 'federal', waste_codes: [], electronic: false })
  })

  it('counts a container listed twice once', async () => {
    const [one] = await closedContainers(1)
    const id = await create(memberA, [one!, one!])
    expect(await scalar(db, 'select count(*) from public.hazardous_waste_shipment_containers where shipment_id = $1', [id])).toBe(1)
  })

  describe('only closed containers', () => {
    it.each(['open', 'in_shipment', 'disposed'])('refuses a %s container, naming it, and changes nothing', async status => {
      const ready = await container()
      const notReady = await container({ label: `NOT-READY-${status}`, status })
      const before = await shipmentCount()

      await expect(create(memberA, [ready, notReady])).rejects.toMatchObject({
        code: '23514', detail: 'hw_manifest', message: expect.stringContaining(`NOT-READY-${status} (${status.replace('_', ' ')})`),
      })
      expect(await shipmentCount()).toBe(before)
      expect(await statusesOf([ready])).toEqual(['closed'])
    })

    it('refuses a closed container that has been archived', async () => {
      const archived = await container({ label: 'ARCHIVED-ONE', archived_at: new Date().toISOString() })
      await expect(create(memberA, [archived])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('ARCHIVED-ONE (archived)') })
    })

    it('refuses a container already on a manifest, so it cannot be on two', async () => {
      const [one] = await closedContainers(1)
      await create(memberA, [one!])
      await expect(create(memberA, [one!])).rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('accounts and sites', () => {
    it('answers "not found" for another account\'s container, exactly as for one that does not exist', async () => {
      const foreign = await container({ tenant_id: TB, stream_id: streamB, facility_id: siteOfB })
      const missing = '99999999-9999-4999-8999-999999999999'
      const answers = await Promise.all([foreign, missing].map(id => create(memberA, [id]).catch((e: Error & { code: string }) => ({ code: e.code, message: e.message }))))
      expect(answers[0]).toEqual(answers[1])
      expect(answers[0]).toMatchObject({ code: 'P0002' })
    })

    it('refuses a mixed list as a whole, leaving the caller\'s own containers closed', async () => {
      const mine = await container()
      const foreign = await container({ tenant_id: TB, stream_id: streamB, facility_id: siteOfB })
      await expect(create(memberA, [mine, foreign])).rejects.toMatchObject({ code: 'P0002' })
      expect(await statusesOf([mine, foreign])).toEqual(['closed', 'closed'])
    })

    it('refuses another account\'s container even where RLS does not apply (the function checks the account itself)', async () => {
      const foreign = await container({ tenant_id: TB, stream_id: streamB, facility_id: siteOfB })
      await expect(asOwnerWithClaim(memberA, () => db.query(
        'select public.hw_create_shipment($1::uuid[], $2::jsonb)', [[foreign], JSON.stringify({ generator_category: 'lqg' })],
      ))).rejects.toMatchObject({ code: 'P0002' })
      expect(await statusesOf([foreign])).toEqual(['closed'])
    })

    it('refuses a container from an account the caller does not belong to even with no account selected', async () => {
      const foreign = await container({ tenant_id: TB, stream_id: streamB, facility_id: siteOfB })
      await expect(asCaller(db, { userId: IDS.memberA }, () => db.query(
        'select public.hw_create_shipment($1::uuid[], $2::jsonb)', [[foreign], JSON.stringify({ generator_category: 'lqg' })],
      ))).rejects.toMatchObject({ code: 'P0002' })
    })

    it('refuses containers of two accounts on one manifest, for someone who belongs to both and has chosen neither', async () => {
      const mine = await container()
      const theirs = await container({ tenant_id: TB, stream_id: streamB, facility_id: siteOfB })
      await expect(asCaller(db, { userId: DUAL }, () => db.query(
        'select public.hw_create_shipment($1::uuid[], $2::jsonb)', [[mine, theirs], JSON.stringify({ generator_category: 'lqg' })],
      ))).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('different accounts') })
      expect(await statusesOf([mine, theirs])).toEqual(['closed', 'closed'])
    })

    it('makes the manifest at the containers\' site even with no site selected', async () => {
      const [atB] = await closedContainers(1, { facility_id: siteB })
      const id = await create(ownerA, [atB!])
      expect((await shipment(id)).facility_id).toBe(siteB)
    })

    it('answers "not found" for a container at another site while working in a site', async () => {
      const [atB] = await closedContainers(1, { facility_id: siteB })
      await expect(create({ ...memberA, facilityId: siteA }, [atB!])).rejects.toMatchObject({ code: 'P0002' })
      await expect(create({ ...memberA, facilityId: siteB }, [atB!])).resolves.toBeTruthy()
    })

    it('refuses containers from two sites on one manifest when no site is selected', async () => {
      const [a] = await closedContainers(1)
      const [b] = await closedContainers(1, { facility_id: siteB })
      await expect(create(ownerA, [a!, b!])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('different sites') })
    })

    it('refuses a container with no site', async () => {
      const [unsited] = await closedContainers(1, { facility_id: null })
      await expect(create(ownerA, [unsited!])).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('no site') })
    })
  })

  describe('what is asked for', () => {
    it('refuses no containers, too many, and no signed-in caller', async () => {
      await expect(create(memberA, [])).rejects.toMatchObject({ code: '23514' })
      const many = Array.from({ length: 101 }, (_, i) => `99999999-9999-4999-8999-${String(i).padStart(12, '0')}`)
      await expect(create(memberA, many)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('at most 100') })
      const [one] = await closedContainers(1)
      await expect(asCaller(db, { userId: '', tenantId: TA }, () => db.query(
        'select public.hw_create_shipment($1::uuid[], $2::jsonb)', [[one], '{"generator_category":"lqg"}']))).rejects.toMatchObject({ code: '42501' })
    })

    it('needs the generator category the site shipped under', async () => {
      const [one] = await closedContainers(1)
      for (const fields of [{ generator_category: null }, { generator_category: 'huge' }, { generator_category: '' }]) {
        await expect(create(memberA, [one!], fields)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('generator category') })
      }
      expect(await statusesOf([one!])).toEqual(['closed'])
    })

    it('refuses any field a person does not fill in: a status, an account, an owner', async () => {
      const [one] = await closedContainers(1)
      for (const field of ['status', 'tenant_id', 'created_by', 'shipped_on', 'facility_id', 'id']) {
        await expect(create(memberA, [one!], { [field]: IDS.tenantB }), field).rejects.toMatchObject({ code: '23514', message: expect.stringContaining(`${field} is not a manifest field`) })
      }
      expect(await statusesOf([one!])).toEqual(['closed'])
    })

    it('refuses waste codes that are not a list', async () => {
      const [one] = await closedContainers(1)
      await expect(create(memberA, [one!], { waste_codes: 'D001' })).rejects.toMatchObject({ code: '23514' })
    })

    it('lets the table\'s own checks refuse a malformed identifier, without a message written for people', async () => {
      const [one] = await closedContainers(1)
      await expect(create(memberA, [one!], { tsdf_epa_id: 'nope' })).rejects.toMatchObject({ code: '23514', detail: expect.not.stringContaining('hw_manifest') })
      expect(await statusesOf([one!])).toEqual(['closed'])
    })

    it('marks the messages it writes for people', async () => {
      await expect(create(memberA, [])).rejects.toMatchObject({ detail: 'hw_manifest' })
    })
  })

  it('records who created it in the audit log', async () => {
    const [one] = await closedContainers(1)
    const id = await create(memberA, [one!])
    expect(await row('select actor_id, operation from public.audit_log where table_name = $1 and row_pk = $2', ['hazardous_waste_shipments', id]))
      .toEqual({ actor_id: IDS.memberA, operation: 'INSERT' })
  })
})

describe('a container on two manifests', () => {
  it('is refused by the database whoever adds it, not just by the function', async () => {
    const { id, containers } = await draft()
    const second = await insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteA, generator_category: 'lqg' })
    await expect(db.query('insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [second, containers[0], TA]))
      .rejects.toMatchObject({ code: '23505', constraint: 'uq_hw_shipment_containers_on_manifest' })

    // Once the first manifest is cancelled the container is free again.
    await transition(ownerA, id, 'cancel')
    await expect(db.query('insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [second, containers[0], TA]))
      .resolves.toBeTruthy()
  })

  it('cannot join a container to a manifest of another account or site, or to one that has left draft', async () => {
    const { containers } = await draft()
    const [free] = await closedContainers(1)
    const otherAccount = await insert(db, 'hazardous_waste_shipments', { tenant_id: TB, facility_id: siteOfB, generator_category: 'lqg' })
    const otherSite = await insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteB, generator_category: 'lqg' })
    const sameSite = await insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteA, generator_category: 'lqg' })
    const leftDraft = await insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteA, generator_category: 'lqg', status: 'cancelled' })
    const link = (shipmentId: string, containerId: string, tenantId: string) =>
      db.query('insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [shipmentId, containerId, tenantId])

    await expect(link(otherAccount, free!, TB)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('same account') })
    await expect(link(otherSite, free!, TA)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('same site') })
    await expect(link(sameSite, free!, TB)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('same account') })
    expect(containers.length).toBe(2)

    await expect(link(leftDraft, free!, TA)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('draft') })
  })
})

describe('the composite keys, with the guard trigger out of the way', () => {
  it('refuses a container list under another account than its manifest\'s, and a manifest at a site that is not its account\'s', async () => {
    const [free] = await closedContainers(1)
    const manifest = await insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteA, generator_category: 'lqg' })
    await db.exec('alter table public.hazardous_waste_shipment_containers disable trigger trg_hw_shipment_containers_guard')
    try {
      await expect(db.query('insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [manifest, free, TB]))
        .rejects.toMatchObject({ code: '23503' })
      await expect(db.query('insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [manifest, free, TA]))
        .resolves.toBeTruthy()
    } finally {
      await db.exec('alter table public.hazardous_waste_shipment_containers enable trigger trg_hw_shipment_containers_guard')
    }
  })
})

describe('moving a manifest (hw_transition_shipment)', () => {
  describe('ship', () => {
    it('takes a draft to shipped on the day the transporter accepted the waste, containers still in shipment', async () => {
      const { id, containers } = await draft()
      await transition(ownerA, id, 'ship', day(-3))
      expect(await shipment(id)).toMatchObject({ status: 'shipped', shipped_on: day(-3), completed_on: null })
      expect(await statusesOf(containers)).toEqual(['in_shipment', 'in_shipment'])
    })

    it('needs the tracking number first', async () => {
      const containers = await closedContainers(1)
      const id = await create(ownerA, containers)
      await expect(transition(ownerA, id, 'ship', day(-1))).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('tracking number') })
      expect((await shipment(id)).status).toBe('draft')
    })

    it('needs the ship date', async () => {
      const { id } = await draft()
      await expect(transition(ownerA, id, 'ship', null)).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('date') })
      expect(await shipment(id)).toMatchObject({ status: 'draft', shipped_on: null })
    })

    it('refuses a date in the future, but not today, nor a site ahead of UTC entering its own today', async () => {
      const { id } = await draft()
      await expect(transition(ownerA, id, 'ship', day(2))).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('future') })
      await expect(transition(ownerA, id, 'ship', day(0))).resolves.toBeTruthy()
    })

    it('accepts a date up to UTC+14 ahead, the latest "today" anywhere, and no further', async () => {
      const ahead = new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10)
      const first = await draft()
      await expect(transition(ownerA, first.id, 'ship', ahead)).resolves.toBeTruthy()
      const second = await draft()
      await expect(transition(ownerA, second.id, 'ship', new Date(Date.parse(ahead) + DAY_MS).toISOString().slice(0, 10)))
        .rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('receive (the signed copy comes back)', () => {
    it('completes a shipped manifest and disposes of its containers, archiving them as a disposed container is', async () => {
      const { id, containers } = await shipmentIn('shipped')
      await transition(ownerA, id, 'receive', day(-2))
      expect(await shipment(id)).toMatchObject({ status: 'completed', completed_on: day(-2), shipped_on: day(-10) })
      expect(await statusesOf(containers)).toEqual(['disposed', 'disposed'])
      expect(await scalar(db, 'select count(*) from public.hazardous_waste_containers where id = any($1::uuid[]) and archived_at is not null', [containers])).toBe(2)
    })

    it('cannot come back before the waste shipped, or in the future, or be skipped from draft', async () => {
      const shipped = await shipmentIn('shipped')
      await expect(transition(ownerA, shipped.id, 'receive', day(-11))).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('before') })
      await expect(transition(ownerA, shipped.id, 'receive', day(3))).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('future') })
      await expect(transition(ownerA, shipped.id, 'receive', null)).rejects.toMatchObject({ code: '23514' })
      const notShipped = await draft()
      await expect(transition(ownerA, notShipped.id, 'receive', day(-1))).rejects.toMatchObject({ code: '23514' })
      expect((await shipment(shipped.id)).status).toBe('shipped')
      expect(await statusesOf(shipped.containers)).toEqual(['in_shipment', 'in_shipment'])
    })

    it('accepts the signed copy on the day of shipping', async () => {
      const { id } = await shipmentIn('shipped')
      await expect(transition(ownerA, id, 'receive', day(-10))).resolves.toBeTruthy()
    })
  })

  describe('file_exception', () => {
    it('records the exception report and leaves the containers in shipment, since the waste has not been confirmed delivered', async () => {
      const { id, containers } = await shipmentIn('shipped')
      await transition(ownerA, id, 'file_exception', day(-1))
      expect(await shipment(id)).toMatchObject({ status: 'exception_reported', exception_reported_on: day(-1), completed_on: null })
      expect(await statusesOf(containers)).toEqual(['in_shipment', 'in_shipment'])
    })

    it('needs a shipped manifest and a date on or after the ship date, not in the future', async () => {
      const shipped = await shipmentIn('shipped')
      await expect(transition(ownerA, shipped.id, 'file_exception', day(-11))).rejects.toMatchObject({ code: '23514' })
      await expect(transition(ownerA, shipped.id, 'file_exception', day(4))).rejects.toMatchObject({ code: '23514' })
      await expect(transition(ownerA, shipped.id, 'file_exception', null)).rejects.toMatchObject({ code: '23514' })
      const notShipped = await draft()
      await expect(transition(ownerA, notShipped.id, 'file_exception', day(-1))).rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('cancel', () => {
    it('puts a draft\'s containers back to closed and releases them from the manifest', async () => {
      const { id, containers } = await draft()
      await transition(ownerA, id, 'cancel')
      expect((await shipment(id)).status).toBe('cancelled')
      expect(await statusesOf(containers)).toEqual(['closed', 'closed'])
      expect(await scalar(db, 'select count(*) from public.hazardous_waste_shipment_containers where shipment_id = $1 and released_at is not null', [id])).toBe(2)
    })

    it('cancels a shipped manifest too, keeping the ship date, and frees its containers for another manifest', async () => {
      const { id, containers } = await shipmentIn('shipped')
      await transition(ownerA, id, 'cancel')
      expect(await shipment(id)).toMatchObject({ status: 'cancelled', shipped_on: day(-10) })
      expect(await statusesOf(containers)).toEqual(['closed', 'closed'])
      await expect(create(ownerA, containers)).resolves.toBeTruthy()
    })

    it('cancels a draft that never had a tracking number', async () => {
      const id = await create(ownerA, await closedContainers(1))
      await transition(ownerA, id, 'cancel')
      expect(await shipment(id)).toMatchObject({ status: 'cancelled' })
    })

    it('refuses once the manifest is completed or an exception has been reported', async () => {
      for (const status of ['completed', 'exception_reported'] as const) {
        const { id, containers } = await shipmentIn(status)
        const containersBefore = await statusesOf(containers)
        await expect(transition(ownerA, id, 'cancel'), status).rejects.toMatchObject({ code: '23514', detail: 'hw_manifest', message: expect.stringContaining('cannot be cancelled') })
        expect((await shipment(id)).status).toBe(status)
        expect(await statusesOf(containers)).toEqual(containersBefore)
      }
    })

    it('leaves a container that someone changed by hand as they set it', async () => {
      const { id, containers } = await draft()
      await db.query(`update public.hazardous_waste_containers set status = 'open' where id = $1`, [containers[0]])
      await transition(ownerA, id, 'cancel')
      expect(await statusesOf(containers)).toEqual(expect.arrayContaining(['open', 'closed']))
    })
  })

  describe('the table of legal moves agrees with the one the screens read', () => {
    // Every status against every action. A same-state repeat of an action that carries a date is
    // refused here because the date differs from the one the manifest has; cancelling a cancelled
    // manifest is the one repeat that needs no date, so it is a no-op and is checked below.
    for (const status of MANIFEST_STATUSES) {
      for (const action of MANIFEST_ACTIONS) {
        const rule = MANIFEST_TRANSITIONS[action]
        const legal = rule.from.includes(status)
        const noOp = !legal && status === rule.to && rule.dateMeaning === null
        it(`${action} on a ${status} manifest is ${legal ? 'allowed' : noOp ? 'a no-op' : 'refused'}`, async () => {
          const { id } = await shipmentIn(status)
          const attempt = transition(ownerA, id, action, rule.dateMeaning === null ? null : day(-1))
          if (legal || noOp) {
            await expect(attempt).resolves.toBeTruthy()
            expect((await shipment(id)).status).toBe(legal ? rule.to : status)
          } else {
            // Said in words for a person, not left to a table constraint's own message.
            await expect(attempt).rejects.toMatchObject({ code: '23514', detail: 'hw_manifest' })
            expect((await shipment(id)).status).toBe(status)
          }
        })
      }
    }
  })

  describe('doing the same thing twice', () => {
    it.each([
      ['ship', 'shipped', day(-4)],
      ['receive', 'completed', day(-2)],
      ['file_exception', 'exception_reported', day(-2)],
    ] as const)('%s with the same date is a no-op that writes nothing', async (action, target, on) => {
      const { id, containers } = await shipmentIn(action === 'ship' ? 'draft' : 'shipped')
      await transition(ownerA, id, action, on)
      const first = await shipment(id)
      const containersAfterFirst = await statusesOf(containers)

      await expect(transition(ownerA, id, action, on)).resolves.toBeTruthy()

      expect(await shipment(id)).toEqual(first)
      expect(first.status).toBe(target)
      expect(await statusesOf(containers)).toEqual(containersAfterFirst)
    })

    it('cancelling twice is a no-op', async () => {
      const { id } = await draft()
      await transition(ownerA, id, 'cancel')
      const first = await shipment(id)
      await expect(transition(ownerA, id, 'cancel')).resolves.toBeTruthy()
      expect(await shipment(id)).toEqual(first)
    })

    it('refuses a repeat with a different date, so a conflicting second entry is not silently kept', async () => {
      const { id } = await draft()
      await transition(ownerA, id, 'ship', day(-4))
      await expect(transition(ownerA, id, 'ship', day(-5))).rejects.toMatchObject({ code: '23514' })
      expect((await shipment(id)).shipped_on).toBe(day(-4))
    })
  })

  describe('notes', () => {
    it('adds a dated line for the note it is given, keeping what was there', async () => {
      const { id } = await draft({ notes: 'Pickup booked' })
      await transition(ownerA, id, 'ship', day(-1), 'Driver signed at the dock')
      expect((await shipment(id)).notes).toBe(`Pickup booked\n${day(-1)} ship: Driver signed at the dock`)
    })

    it('refuses a note that would take the notes past the column\'s limit, changing nothing', async () => {
      const { id } = await draft({ notes: 'x'.repeat(1990) })
      await expect(transition(ownerA, id, 'ship', day(-1), 'a long enough note')).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('2000') })
      expect((await shipment(id)).status).toBe('draft')
    })
  })

  describe('who may', () => {
    it('lets the creator, who is a plain member, and any admin move a draft', async () => {
      const mine = await create(memberA, await closedContainers(1), { manifest_tracking_number: trackingNumber() })
      await expect(transition(memberA, mine, 'ship', day(-1))).resolves.toBeTruthy()
      await expect(transition(ownerA, mine, 'receive', day(0))).resolves.toBeTruthy()
    })

    it('answers "not found" to a member who did not create it, though they can read it', async () => {
      const id = await create(memberA, await closedContainers(1), { manifest_tracking_number: trackingNumber() })
      expect(await visibleTo(memberC)).toContain(id)
      await expect(transition(memberC, id, 'ship', day(-1))).rejects.toMatchObject({ code: 'P0002' })
      await expect(transition(memberC, id, 'cancel')).rejects.toMatchObject({ code: 'P0002' })
      expect((await shipment(id)).status).toBe('draft')
    })

    it('answers "not found" to another account\'s admin, to another site, to a manifest that is not there, and to no one signed in', async () => {
      const { id } = await draft()
      await expect(transition(adminBInA, id, 'cancel')).rejects.toMatchObject({ code: 'P0002' })
      await expect(transition(adminB, id, 'cancel')).rejects.toMatchObject({ code: 'P0002' })
      await expect(transition({ ...ownerA, facilityId: siteB }, id, 'cancel')).rejects.toMatchObject({ code: 'P0002' })
      await expect(transition(ownerA, '99999999-9999-4999-8999-999999999999', 'cancel')).rejects.toMatchObject({ code: 'P0002' })
      await expect(asCaller(db, { userId: '', tenantId: TA }, () => db.query('select public.hw_transition_shipment($1, $2, null)', [id, 'cancel'])))
        .rejects.toMatchObject({ code: '42501' })
      expect((await shipment(id)).status).toBe('draft')
    })

    it('refuses an action that does not exist', async () => {
      const { id } = await draft()
      for (const action of ['complete', 'ship ', '', 'SHIP']) {
        await expect(asCaller(db, ownerA, () => db.query('select public.hw_transition_shipment($1, $2, $3::date)', [id, action, day(-1)])), action)
          .rejects.toMatchObject({ code: '23514' })
      }
    })
  })
})

describe('the database\'s own rules on a manifest, whoever writes it', () => {
  const directInsert = (fields: Record<string, unknown>) => insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteA, generator_category: 'lqg', ...fields })
  const refused = (fields: Record<string, unknown>, constraint: string) =>
    expect(directInsert(fields)).rejects.toMatchObject({ code: '23514', constraint })

  describe('the tracking number', () => {
    it.each(['12345', '123456789elc', '123456789EL', '123456789ELCD', 'ABCDEFGHIJKL', '123456789 ELC'])('refuses %j', async value => {
      await expect(directInsert({ manifest_tracking_number: value })).rejects.toMatchObject({ code: '23514' })
    })

    it('is unique within an account, and a second account may use the same number', async () => {
      const number = trackingNumber()
      await directInsert({ manifest_tracking_number: number })
      await expect(directInsert({ manifest_tracking_number: number })).rejects.toMatchObject({ code: '23505', constraint: 'hw_shipments_tenant_tracking_key' })
      await expect(directInsert({ tenant_id: TB, facility_id: siteOfB, manifest_tracking_number: number })).resolves.toBeTruthy()
    })

    it('may be missing on any number of drafts', async () => {
      await directInsert({})
      await expect(directInsert({})).resolves.toBeTruthy()
    })

    it('is required once the manifest is anything but a draft or a cancelled draft', async () => {
      await refused({ status: 'shipped', shipped_on: day(-1) }, 'hw_shipments_tracking_once_past_draft')
      await refused({ status: 'completed', shipped_on: day(-2), completed_on: day(-1) }, 'hw_shipments_tracking_once_past_draft')
      await refused({ status: 'exception_reported', shipped_on: day(-2), exception_reported_on: day(-1) }, 'hw_shipments_tracking_once_past_draft')
      await expect(directInsert({ status: 'cancelled' })).resolves.toBeTruthy()
      await expect(directInsert({ status: 'shipped', shipped_on: day(-1), manifest_tracking_number: trackingNumber() })).resolves.toBeTruthy()
    })
  })

  describe('dates', () => {
    const number = () => ({ manifest_tracking_number: trackingNumber() })

    it('needs a ship date once shipped', async () => {
      await refused({ ...number(), status: 'shipped' }, 'hw_shipments_shipped_on_required')
    })

    it('has no completed or exception-reported manifest without a ship date to count from', async () => {
      await expect(directInsert({ ...number(), status: 'completed', completed_on: day(-1) })).rejects.toMatchObject({ code: '23514' })
      await expect(directInsert({ ...number(), status: 'exception_reported', exception_reported_on: day(-1) })).rejects.toMatchObject({ code: '23514' })
    })

    it('needs the date of the step the status names', async () => {
      await refused({ ...number(), status: 'completed', shipped_on: day(-3) }, 'hw_shipments_completed_on_required')
      await refused({ ...number(), status: 'exception_reported', shipped_on: day(-3) }, 'hw_shipments_exception_on_required')
    })

    it('does not let a step happen before the waste shipped', async () => {
      await expect(directInsert({ ...number(), status: 'completed', shipped_on: day(-1), completed_on: day(-2) })).rejects.toMatchObject({ code: '23514', constraint: 'hw_shipments_completed_after_shipped' })
      await expect(directInsert({ ...number(), status: 'exception_reported', shipped_on: day(-1), exception_reported_on: day(-2) })).rejects.toMatchObject({ code: '23514', constraint: 'hw_shipments_exception_after_shipped' })
      await expect(directInsert({ ...number(), status: 'completed', shipped_on: day(-1), completed_on: day(-1) })).resolves.toBeTruthy()
    })

    it('does not let a draft carry dates, or a manifest carry the date of a step it did not take', async () => {
      await refused({ shipped_on: day(-1) }, 'hw_shipments_draft_has_no_dates')
      await refused({ ...number(), status: 'shipped', shipped_on: day(-3), completed_on: day(-1) }, 'hw_shipments_completed_on_only_when_completed')
      await refused({ ...number(), status: 'shipped', shipped_on: day(-3), exception_reported_on: day(-1) }, 'hw_shipments_exception_on_only_when_reported')
    })
  })

  describe('the rest of the columns', () => {
    it.each([
      ['jurisdiction', 'state:ca'], ['jurisdiction', 'state:CAL'], ['jurisdiction', 'california'], ['jurisdiction', 'Federal'],
      ['generator_category', 'huge'], ['status', 'shipping'],
      ['generator_epa_id', 'CA0000123456'], ['transporter_epa_id', 'cal000123456'], ['tsdf_epa_id', 'CAL00012345'],
      ['transporter_name', 'x'.repeat(201)], ['tsdf_name', 'x'.repeat(201)], ['dot_description', 'x'.repeat(1001)], ['notes', 'x'.repeat(2001)],
    ])('refuses %s = %j', async (column, value) => {
      await expect(directInsert({ [column]: value })).rejects.toMatchObject({ code: '23514' })
    })

    it.each([
      ['jurisdiction', 'federal'], ['jurisdiction', 'state:TX'], ['generator_category', 'vsqg'],
      ['generator_epa_id', 'CAL000123456'], ['transporter_name', 'x'.repeat(200)], ['notes', 'x'.repeat(2000)],
    ])('accepts %s = %j', async (column, value) => {
      await expect(directInsert({ [column]: value })).resolves.toBeTruthy()
    })

    it('refuses more than 50 waste codes', async () => {
      await expect(directInsert({ waste_codes: Array.from({ length: 51 }, (_, i) => String(100 + i)) })).rejects.toMatchObject({ code: '23514' })
      await expect(directInsert({ waste_codes: Array.from({ length: 50 }, (_, i) => String(100 + i)) })).resolves.toBeTruthy()
    })

    it('refuses a site that is not the account\'s own', async () => {
      await expect(directInsert({ facility_id: siteOfB })).rejects.toMatchObject({ code: '23503' })
    })
  })

  describe('status and dates move only through the functions', () => {
    it('refuses a direct update of the status or a date, even from the creator or an admin', async () => {
      const id = await create(memberA, await closedContainers(1), { manifest_tracking_number: trackingNumber() })
      for (const caller of [memberA, ownerA]) {
        for (const set of [`status = 'cancelled'`, `status = 'shipped', shipped_on = current_date`, `shipped_on = current_date`]) {
          await expect(asCaller(db, caller, () => db.query(`update public.hazardous_waste_shipments set ${set} where id = $1`, [id])), set)
            .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('only by shipping') })
        }
      }
      expect((await shipment(id)).status).toBe('draft')
    })

    it('refuses to complete a shipped manifest by hand, which would strand its containers in shipment', async () => {
      const { id, containers } = await shipmentIn('shipped')
      await expect(asCaller(db, ownerA, () => db.query(`update public.hazardous_waste_shipments set status = 'completed', completed_on = current_date where id = $1`, [id])))
        .rejects.toMatchObject({ code: '23514' })
      expect(await statusesOf(containers)).toEqual(['in_shipment', 'in_shipment'])
    })

    it('does not leave the way open after a transition: the next direct update is refused again', async () => {
      const { id } = await draft()
      await transition(ownerA, id, 'ship', day(-1))
      await expect(asCaller(db, ownerA, () => db.query(`update public.hazardous_waste_shipments set status = 'cancelled' where id = $1`, [id])))
        .rejects.toMatchObject({ code: '23514' })
    })

    it('lets a seed put a manifest in a later status by naming it to the guard in the same transaction, and no other manifest', async () => {
      const first = await insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteA, generator_category: 'lqg', manifest_tracking_number: trackingNumber() })
      const second = await insert(db, 'hazardous_waste_shipments', { tenant_id: TA, facility_id: siteA, generator_category: 'lqg', manifest_tracking_number: trackingNumber() })
      const [one] = await closedContainers(1)
      const ship = (named: string, target: string) => db.transaction(async tx => {
        await tx.query(`select set_config('soteria.hw_shipment_transition', $1, true)`, [named])
        await tx.query(`update public.hazardous_waste_shipments set status = 'shipped', shipped_on = $2 where id = $1`, [target, day(-3)])
      })
      await db.query('insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [first, one, TA])

      await expect(ship(second, first)).rejects.toMatchObject({ code: '23514' })
      expect((await shipment(first)).status).toBe('draft')
      await ship(first, first)
      expect(await shipment(first)).toMatchObject({ status: 'shipped', shipped_on: day(-3) })
      // The name lasted one transaction: the next direct update is refused again.
      await expect(db.query(`update public.hazardous_waste_shipments set status = 'cancelled' where id = $1`, [first])).rejects.toMatchObject({ code: '23514' })
    })

    it('does not let a manifest move to another account or site', async () => {
      const { id } = await draft()
      await expect(db.query('update public.hazardous_waste_shipments set facility_id = $2 where id = $1', [id, siteB])).rejects.toMatchObject({ code: '23514' })
      await expect(db.query('update public.hazardous_waste_shipments set tenant_id = $2, facility_id = $3 where id = $1', [id, TB, siteOfB])).rejects.toMatchObject({ code: '23514' })
    })
  })

  describe('a manifest that has left draft', () => {
    it('can no longer be edited: not its parties, its codes, its tracking number, or its notes', async () => {
      const { id } = await shipmentIn('shipped')
      for (const set of [`transporter_name = 'Other'`, `waste_codes = '{D002}'`, `manifest_tracking_number = '999999999ELC'`, `notes = 'changed'`,
                         `generator_category = 'sqg'`, `electronic = true`, `tsdf_epa_id = 'CAL000000001'`]) {
        await expect(asCaller(db, ownerA, () => db.query(`update public.hazardous_waste_shipments set ${set} where id = $1`, [id])), set)
          .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('can no longer be edited') })
      }
    })

    it('stays editable while it is a draft, and keeps the clock\'s snapshot of the generator category unless changed on purpose', async () => {
      const { id } = await draft()
      await asCaller(db, ownerA, () => db.query(`update public.hazardous_waste_shipments set transporter_name = 'Haul Co', generator_category = 'sqg' where id = $1`, [id]))
      expect(await row('select transporter_name, generator_category from public.hazardous_waste_shipments where id = $1', [id])).toEqual({ transporter_name: 'Haul Co', generator_category: 'sqg' })
    })
  })

  it('records every change to a manifest in the audit log, with who made it', async () => {
    const { id } = await draft()
    await transition(ownerA, id, 'ship', day(-1))
    const operations = (await db.query<{ operation: string; actor_id: string | null }>(
      'select operation, actor_id from public.audit_log where table_name = $1 and row_pk = $2 order by id', ['hazardous_waste_shipments', id])).rows
    expect(operations).toEqual([{ operation: 'INSERT', actor_id: IDS.ownerA }, { operation: 'UPDATE', actor_id: IDS.ownerA }])
  })
})

describe('access', () => {
  describe('reading', () => {
    it('lets any member of the account read every manifest at any site, with no site selected', async () => {
      const { id } = await draft()
      const [atB] = await closedContainers(1, { facility_id: siteB })
      const other = await create(ownerA, [atB!])
      for (const caller of [ownerA, memberA, memberC]) expect(await visibleTo(caller)).toEqual(expect.arrayContaining([id, other]))
    })

    it('shows another account\'s admin nothing, whichever account they say they are working in', async () => {
      const { id } = await draft()
      expect(await visibleTo(adminBInA)).not.toContain(id)
      expect(await visibleTo(adminB)).not.toContain(id)
      expect(await visibleTo({ userId: IDS.adminB })).not.toContain(id)
    })

    it('shows a member working in another site only that site\'s manifests', async () => {
      const [atA] = await closedContainers(1)
      const [atB] = await closedContainers(1, { facility_id: siteB })
      const inA = await create(ownerA, [atA!])
      const inB = await create(ownerA, [atB!])

      const seenFromA = await visibleTo({ ...memberA, facilityId: siteA })
      const seenFromB = await visibleTo({ ...memberA, facilityId: siteB })
      expect(seenFromA).toContain(inA)
      expect(seenFromA).not.toContain(inB)
      expect(seenFromB).toContain(inB)
      expect(seenFromB).not.toContain(inA)
    })

    it('shows a superadmin every account\'s manifests, or one account\'s when they pick it', async () => {
      const mine = (await draft()).id
      const theirs = await insert(db, 'hazardous_waste_shipments', { tenant_id: TB, facility_id: siteOfB, generator_category: 'lqg' })
      expect(await visibleTo({ userId: SUPER })).toEqual(expect.arrayContaining([mine, theirs]))
      const inB = await visibleTo({ userId: SUPER, tenantId: TB })
      expect(inB).toContain(theirs)
      expect(inB).not.toContain(mine)
    })

    it('shows the containers of a manifest only where the manifest is visible', async () => {
      const { id } = await draft()
      const links = (caller: Caller) => asCaller(db, caller, async () => Number((await db.query<{ n: string }>('select count(*) as n from public.hazardous_waste_shipment_containers where shipment_id = $1', [id])).rows[0]!.n))
      expect(await links(memberC)).toBe(2)
      expect(await links({ ...memberC, facilityId: siteA })).toBe(2)
      expect(await links({ ...memberC, facilityId: siteB })).toBe(0)
      expect(await links(adminBInA)).toBe(0)
      expect(await links(adminB)).toBe(0)
    })
  })

  describe('writing directly', () => {
    const insertAs = (caller: Caller, over: { tenant?: string; site?: string; createdBy?: string | null; status?: string } = {}) =>
      asCaller(db, caller, () => db.query(
        `insert into public.hazardous_waste_shipments (tenant_id, facility_id, generator_category, created_by, status) values ($1, $2, 'lqg', $3, $4) returning id`,
        [over.tenant ?? TA, over.site ?? siteA, over.createdBy === undefined ? caller.userId : over.createdBy, over.status ?? 'draft'],
      ))

    it('lets any member insert a draft that names themselves as the creator', async () => {
      await expect(insertAs(memberA)).resolves.toBeTruthy()
      await expect(insertAs(memberC)).resolves.toBeTruthy()
    })

    it('refuses a draft in someone else\'s name, one that is not a draft, one for another account, or one for another site than the one selected', async () => {
      await expect(insertAs(memberA, { createdBy: IDS.ownerA })).rejects.toMatchObject({ code: '42501' })
      await expect(insertAs(memberA, { createdBy: null })).rejects.toMatchObject({ code: '42501' })
      await expect(insertAs(memberA, { status: 'cancelled' })).rejects.toMatchObject({ code: '42501' })
      await expect(insertAs(adminBInA, { tenant: TA })).rejects.toMatchObject({ code: '42501' })
      await expect(insertAs(adminB, { tenant: TA })).rejects.toMatchObject({ code: '42501' })
      await expect(insertAs({ ...memberA, facilityId: siteA }, { site: siteB })).rejects.toMatchObject({ code: '42501' })
    })

    it('lets the creator edit a draft and refuses another plain member, who updates nothing', async () => {
      const id = await create(memberA, await closedContainers(1))
      const edit = (caller: Caller) => asCaller(db, caller, async () =>
        (await db.query(`update public.hazardous_waste_shipments set transporter_name = 'Edited' where id = $1 returning id`, [id])).rows.length)
      expect(await edit(memberC)).toBe(0)
      expect(await edit(adminBInA)).toBe(0)
      expect(await edit({ ...memberA, facilityId: siteB })).toBe(0)
      expect(await edit(memberA)).toBe(1)
      expect(await edit(ownerA)).toBe(1)
    })

    it('lets only an admin delete: not the creator, not another member, not another account\'s admin', async () => {
      const id = await create(memberA, await closedContainers(1))
      const remove = (caller: Caller) => asCaller(db, caller, async () =>
        (await db.query('delete from public.hazardous_waste_shipments where id = $1 returning id', [id])).rows.length)
      expect(await remove(memberA)).toBe(0)
      expect(await remove(memberC)).toBe(0)
      expect(await remove(adminBInA)).toBe(0)
      expect(await remove({ ...ownerA, facilityId: siteB })).toBe(0)
      expect((await shipment(id)).status).toBe('draft')
      expect(await remove(ownerA)).toBe(1)
    })

    it('puts containers back to closed when an admin deletes a draft or shipped manifest, and leaves a completed one\'s disposed', async () => {
      const remove = (id: string) => asCaller(db, ownerA, () => db.query('delete from public.hazardous_waste_shipments where id = $1', [id]))
      for (const [status, expected] of [['draft', 'closed'], ['shipped', 'closed'], ['completed', 'disposed'], ['exception_reported', 'in_shipment']] as const) {
        const { id, containers } = await shipmentIn(status)
        await remove(id)
        expect(await statusesOf(containers), status).toEqual([expected, expected])
        expect(await scalar(db, 'select count(*) from public.hazardous_waste_shipment_containers where shipment_id = $1', [id])).toBe(0)
      }
    })

    it('refuses a member adding a container to a manifest someone else made, but lets the creator and an admin', async () => {
      const { id } = await draft()
      const [extra] = await closedContainers(1)
      const link = (caller: Caller) => asCaller(db, caller, () => db.query(
        'insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [id, extra, TA]))
      await expect(link(memberC)).rejects.toMatchObject({ code: '42501' })
      // Another account's admin cannot even see the container, which the guard reports before the policy gets to speak.
      await expect(link(adminBInA)).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|P0002)$/) })
      await expect(link(ownerA)).resolves.toBeTruthy()
    })

    it('refuses a member deleting a manifest\'s container list', async () => {
      const id = await create(memberA, await closedContainers(1))
      const result = await asCaller(db, memberA, () => db.query('delete from public.hazardous_waste_shipment_containers where shipment_id = $1 returning container_id', [id]))
      expect(result.rows.length).toBe(0)
    })
  })

  it('has no policy that covers every command, and every delete policy is for admins', async () => {
    const policies = (await db.query<{ tablename: string; policyname: string; cmd: string; qual: string | null }>(
      `select tablename, policyname, cmd, qual from pg_policies where tablename like 'hazardous_waste_shipment%'`)).rows
    expect(policies.filter(p => p.cmd === 'ALL')).toEqual([])
    expect(policies.filter(p => p.cmd === 'DELETE').every(p => (p.qual ?? '').includes('current_user_admin_tenant_ids'))).toBe(true)
  })
})

describe('removing an account', () => {
  it('removes its manifests, their container lists and its containers, without a foreign key getting in the way', async () => {
    const tenant = await insert(db, 'tenants', { slug: 'throwaway', name: 'Throwaway' })
    const site = await insert(db, 'facilities', { tenant_id: tenant, name: 'Only site', code: 'ONLY', is_primary: true })
    const stream = await insert(db, 'hazardous_waste_streams', { tenant_id: tenant, name: 'Stream', facility_id: site })
    const containerId = await insert(db, 'hazardous_waste_containers', { tenant_id: tenant, stream_id: stream, facility_id: site, label: 'D', area_type: 'central_accumulation', status: 'closed' })
    const shipmentId = await insert(db, 'hazardous_waste_shipments', { tenant_id: tenant, facility_id: site, generator_category: 'lqg' })
    await db.query('insert into public.hazardous_waste_shipment_containers (shipment_id, container_id, tenant_id) values ($1, $2, $3)', [shipmentId, containerId, tenant])

    await db.query('delete from public.tenants where id = $1', [tenant])

    expect(await scalar(db, 'select count(*) from public.hazardous_waste_shipments where tenant_id = $1', [tenant])).toBe(0)
    expect(await scalar(db, 'select count(*) from public.hazardous_waste_shipment_containers where tenant_id = $1', [tenant])).toBe(0)
    expect(await scalar(db, 'select count(*) from public.hazardous_waste_containers where tenant_id = $1', [tenant])).toBe(0)
  })

  it('refuses to delete a container that is on a manifest', async () => {
    const { containers } = await draft()
    await expect(db.query('delete from public.hazardous_waste_containers where id = $1', [containers[0]])).rejects.toMatchObject({ code: '23503' })
  })
})
