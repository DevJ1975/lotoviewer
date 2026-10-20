import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gateMock } = vi.hoisted(() => ({ gateMock: vi.fn() }))
vi.mock('@/lib/strike/gate', () => ({ requireStrikeMember: () => gateMock() }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'members'
              ? { id: MEMBER_ID, tenant_id: 'tenant-1', status: 'active' }
              : { id: MODULE_ID, tenant_id: 'tenant-1', library_scope: 'tenant', status: 'published' },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))

const MEMBER_ID = '11111111-1111-1111-1111-111111111111'
const MODULE_ID = '22222222-2222-2222-2222-222222222222'

import { POST } from '@/app/api/strike/kiosk/token/route'

function post() {
  return POST(new Request('http://x/api/strike/kiosk/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ member_id: MEMBER_ID, module_id: MODULE_ID }),
  }))
}

describe('POST /api/strike/kiosk/token', () => {
  beforeEach(() => {
    process.env.STRIKE_KIOSK_SECRET ??= 'test-kiosk-secret-at-least-32-characters-long'
    gateMock.mockReset()
  })

  it.each(['member', 'admin', 'owner'])('issues a link for a %s, naming them as issuer', async role => {
    gateMock.mockResolvedValue({ ok: true, tenantId: 'tenant-1', userId: `user-${role}`, role })
    const res = await post()
    expect(res.status).toBe(201)
    expect((await res.json()).url).toMatch(/\/train\//)
  })

  // The issuer is recorded on the completion as evidence; a view-only
  // account can't sign training off, so it can't be named on one either.
  it('refuses a viewer', async () => {
    gateMock.mockResolvedValue({ ok: true, tenantId: 'tenant-1', userId: 'user-viewer', role: 'viewer' })
    expect((await post()).status).toBe(403)
  })
})
