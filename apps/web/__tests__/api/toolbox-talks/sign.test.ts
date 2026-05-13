import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { requireTenantModuleMemberMock, insertMock } = vi.hoisted(() => ({
  requireTenantModuleMemberMock: vi.fn(),
  insertMock: vi.fn(),
}))

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantModuleMember: (req: Request, moduleId: string) => requireTenantModuleMemberMock(req, moduleId),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: insertMock,
    }),
  }),
}))

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { POST } from '@/app/api/toolbox-talks/[id]/sign/route'

const TALK_ID = '11111111-1111-1111-1111-111111111111'
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

function request() {
  return new Request(`http://x/api/toolbox-talks/${TALK_ID}/sign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({
      signer_name: 'Alex Rivera',
      signature_data: PNG_DATA_URL,
      is_self: true,
    }),
  })
}

function ctxFor(id = TALK_ID) {
  return { params: Promise.resolve({ id }) }
}

function authedClientForTalk(talk: unknown) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: talk, error: null }),
  }
  return { from: () => chain }
}

describe('POST /api/toolbox-talks/[id]/sign', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-13T16:00:00.000Z'))
    requireTenantModuleMemberMock.mockReset()
    insertMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('enforces the toolbox-talks module gate before accepting signatures', async () => {
    requireTenantModuleMemberMock.mockResolvedValue({
      ok: false,
      status: 403,
      message: 'Module is not enabled for this tenant',
    })

    const response = await POST(request(), ctxFor())

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Module is not enabled for this tenant' })
    expect(requireTenantModuleMemberMock).toHaveBeenCalledWith(expect.any(Request), 'toolbox-talks')
    expect(insertMock).not.toHaveBeenCalled()
  })

  it('blocks signatures before the tenant-local scheduled date', async () => {
    requireTenantModuleMemberMock.mockResolvedValue({
      ok: true,
      tenantId: 'tenant-1',
      userId: 'user-1',
      userEmail: 'worker@example.com',
      role: 'member',
      tenantName: 'Fixture Manufacturing',
      tenantModules: { 'toolbox-talks': true },
      tenantSettings: { toolbox_time_zone: 'America/Los_Angeles' },
      authedClient: authedClientForTalk({ id: TALK_ID, talk_date: '2026-05-14' }),
    })

    const response = await POST(request(), ctxFor())

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'This talk is scheduled for 2026-05-14 and cannot be signed before that date.',
    })
    expect(insertMock).not.toHaveBeenCalled()
  })
})
