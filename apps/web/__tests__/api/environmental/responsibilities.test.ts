// Who owns each process on the EMS map (clause 4.4) and each role clause 5.3
// assigns, behind /api/environmental/responsibilities. Members read; admins
// assign, only to members of their own organization; nothing crosses tenants.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ADMIN_A, ADMIN_B, MEMBER_A, TENANT_A, TENANT_B,
  asAdminB, asMemberA, beforeNext, callAs, gateRejects, jsonRequest, resetStore, rowsIn, seed, writes,
} from './_emsHarness'

import * as responsibilities from '@/app/api/environmental/responsibilities/route'
import * as responsibility from '@/app/api/environmental/responsibilities/[key]/route'

const keyContext = (key: string) => ({ params: Promise.resolve({ key }) })
const assign = (key: string, body: Record<string, unknown>) =>
  responsibility.PUT(jsonRequest('/x', 'PUT', body), keyContext(key))
const list = () => responsibilities.GET(jsonRequest('/api/environmental/responsibilities', 'GET'))

beforeEach(() => {
  resetStore()
  seed('tenant_memberships', [
    { tenant_id: TENANT_A, user_id: ADMIN_A, invite_cancelled_at: null },
    { tenant_id: TENANT_A, user_id: MEMBER_A, invite_cancelled_at: null },
    { tenant_id: TENANT_B, user_id: ADMIN_B, invite_cancelled_at: null },
  ])
})

describe('gating', () => {
  it.each([
    ['GET', list],
    ['PUT', () => assign('aspects', { owner_user_id: MEMBER_A })],
  ])('%s passes an authentication failure through, and answers 403 with the module off', async (_name, call) => {
    gateRejects(401, 'Invalid session')
    expect((await call()).status).toBe(401)
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'owner', moduleOn: false })
    expect((await call()).status).toBe(403)
  })

  it('lets a member read the map, but not assign it', async () => {
    asMemberA()
    expect((await list()).status).toBe(200)
    expect((await assign('aspects', { owner_user_id: MEMBER_A })).status).toBe(403)
    expect(writes).toEqual([])
  })
})

describe('PUT /responsibilities/[key]', () => {
  it('assigns a process to a member, recording who assigned it', async () => {
    const res = await assign('aspects', { owner_user_id: MEMBER_A, tenant_id: TENANT_B })
    expect(res.status).toBe(201)
    expect((await res.json()).responsibility).toMatchObject({
      tenant_id: TENANT_A, discipline: 'ems', responsibility_key: 'aspects', owner_user_id: MEMBER_A, assigned_by: ADMIN_A,
    })
  })

  it('reassigns in place, so there is only ever one owner', async () => {
    await assign('system_conformity', { owner_user_id: ADMIN_A })
    const res = await assign('system_conformity', { owner_user_id: MEMBER_A })
    expect(res.status).toBe(200)
    expect(rowsIn('ms_responsibilities')).toHaveLength(1)
    expect(rowsIn('ms_responsibilities')[0]).toMatchObject({ owner_user_id: MEMBER_A })
  })

  it('unassigns with null, keeping the row so the audit log shows who held it', async () => {
    await assign('policy', { owner_user_id: ADMIN_A })
    const res = await assign('policy', { owner_user_id: null })
    expect(res.status).toBe(200)
    expect(rowsIn('ms_responsibilities')[0]).toMatchObject({ owner_user_id: null })
  })

  it('refuses someone who is not a member of this organization', async () => {
    const res = await assign('aspects', { owner_user_id: ADMIN_B })
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([{ field: 'owner_user_id', message: 'is not a member of this organization' }])
    expect(writes).toEqual([])
  })

  it('refuses a member whose invitation was cancelled', async () => {
    seed('tenant_memberships', [
      { tenant_id: TENANT_A, user_id: '00000000-0000-4000-8000-0000000000a9', invite_cancelled_at: '2026-09-01T00:00:00Z' },
    ])
    expect((await assign('aspects', { owner_user_id: '00000000-0000-4000-8000-0000000000a9' })).status).toBe(400)
  })

  it('refuses a missing or malformed owner rather than guessing', async () => {
    for (const body of [{}, { owner_user_id: 'me' }, { owner_user_id: 42 }]) {
      const res = await assign('aspects', body)
      expect(res.status).toBe(400)
    }
    expect(writes).toEqual([])
  })

  it('answers 404 for a responsibility that is not on the map', async () => {
    expect((await assign('coffee_rota', { owner_user_id: MEMBER_A })).status).toBe(404)
  })

  it('refuses a discipline the environmental routes do not write', async () => {
    const res = await assign('aspects', { owner_user_id: MEMBER_A, discipline: 'ohs' })
    expect(res.status).toBe(400)
  })

  it('refuses a discipline that is not text, rather than defaulting it', async () => {
    const res = await assign('aspects', { owner_user_id: MEMBER_A, discipline: 7 })
    expect(res.status).toBe(400)
    expect(writes).toEqual([])
  })

  it('answers 400, not 500, when the membership goes between the check and the write', async () => {
    beforeNext('ms_responsibilities', 'update', () => {
      const memberships = rowsIn('tenant_memberships')
      memberships.splice(memberships.findIndex(m => m.user_id === MEMBER_A && m.tenant_id === TENANT_A), 1)
    })
    const res = await assign('aspects', { owner_user_id: MEMBER_A })
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors).toEqual([{ field: 'owner_user_id', message: 'is not a member of this organization' }])
  })

  it('answers 409 when another admin made the first assignment at the same moment', async () => {
    beforeNext('ms_responsibilities', 'insert', () => seed('ms_responsibilities', [
      { tenant_id: TENANT_A, discipline: 'ems', responsibility_key: 'aspects', owner_user_id: ADMIN_A },
    ]))
    const res = await assign('aspects', { owner_user_id: MEMBER_A })
    expect(res.status).toBe(409)
  })
})

describe('GET /responsibilities', () => {
  it('reports each assignment and how much of the map is held', async () => {
    await assign('system_conformity', { owner_user_id: ADMIN_A })
    await assign('performance_reporting', { owner_user_id: ADMIN_A })
    await assign('aspects', { owner_user_id: MEMBER_A })
    await assign('policy', { owner_user_id: null })
    const body = await (await list()).json()
    expect(body.responsibilities).toHaveLength(4)
    expect(body.coverage).toEqual({ rolesUnassigned: 0, processesUnassigned: 14 })
    expect(body.health).toBe('amber')
  })

  it('is red for a tenant that has assigned no one', async () => {
    const body = await (await list()).json()
    expect(body).toMatchObject({ responsibilities: [], coverage: { rolesUnassigned: 2, processesUnassigned: 15 }, health: 'red' })
  })

  it('shows another tenant nothing, and lets it assign nothing here', async () => {
    await assign('aspects', { owner_user_id: MEMBER_A })
    asAdminB()
    expect((await (await list()).json()).responsibilities).toEqual([])
    await assign('aspects', { owner_user_id: ADMIN_B })
    expect(rowsIn('ms_responsibilities').find(r => r.tenant_id === TENANT_A)).toMatchObject({ owner_user_id: MEMBER_A })
  })
})
