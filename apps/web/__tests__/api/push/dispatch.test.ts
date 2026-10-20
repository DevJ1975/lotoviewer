import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  gateOk,
  gateRejects,
  mockState,
  requireSuperadminMock,
  resetMocks,
} from '../superadmin/_helpers'

// Who may fan out a Web Push by hand. The route used to gate on the legacy
// profiles.is_admin flag, which nothing writes any more — so the self-test
// button failed for every newer user, while a pre-multi-tenant admin could
// broadcast to every device in every tenant. Now: your own devices need only
// a session; anything wider is superadmin-only; the internal secret still
// covers the database trigger.

const { getUserMock, sendNotificationMock } = vi.hoisted(() => ({
  getUserMock:          vi.fn(),
  sendNotificationMock: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: getUserMock } })),
}))

vi.mock('web-push', () => ({
  default: {
    setVapidDetails:  vi.fn(),
    sendNotification: sendNotificationMock,
  },
}))

import { POST } from '@/app/api/push/dispatch/route'

const ORIG_ENV = process.env
const SELF = 'user-self'
const OTHER = 'user-other'

function request(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer t' }) {
  return new Request('http://x/api/push/dispatch', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body:    JSON.stringify(body),
  })
}

function signedInAs(userId: string | null) {
  getUserMock.mockResolvedValue(
    userId
      ? { data: { user: { id: userId } }, error: null }
      : { data: { user: null }, error: { message: 'bad jwt' } },
  )
}

function queueSubscriptions(...profileIds: string[]) {
  mockState.queue('loto_push_subscriptions', {
    data: profileIds.map((profile_id, i) => ({
      id: `sub-${i}`, endpoint: `https://push.example/${i}`, p256dh: 'k', auth: 'a', profile_id,
    })),
    error: null,
  })
}

describe('POST /api/push/dispatch', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY  = 'pub'
    process.env.VAPID_PRIVATE_KEY             = 'priv'
    process.env.VAPID_SUBJECT                 = 'mailto:ops@example.com'
    process.env.INTERNAL_PUSH_SECRET          = 'internal-secret'
    resetMocks()
    getUserMock.mockReset()
    sendNotificationMock.mockReset()
    sendNotificationMock.mockResolvedValue({ statusCode: 201 })
  })

  afterEach(() => {
    process.env = ORIG_ENV
  })

  it('lets a signed-in user push to their own devices without any admin flag', async () => {
    signedInAs(SELF)
    queueSubscriptions(SELF, SELF)

    const res = await POST(request({ title: 'T', body: 'B', profile_ids: [SELF] }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 2, failed: 0 })
    expect(requireSuperadminMock).not.toHaveBeenCalled()
  })

  it('refuses a non-superadmin who targets someone else, and sends nothing', async () => {
    signedInAs(SELF)
    gateRejects(403, 'Superadmin only')
    queueSubscriptions(OTHER)

    const res = await POST(request({ title: 'T', body: 'B', profile_ids: [OTHER] }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/own devices/)
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('treats an omitted profile_ids as a broadcast and refuses it to a non-superadmin', async () => {
    signedInAs(SELF)
    gateRejects(403, 'Superadmin only')
    queueSubscriptions(SELF, OTHER)

    const res = await POST(request({ title: 'T', body: 'B' }))

    expect(res.status).toBe(403)
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('lets a superadmin broadcast to every subscriber', async () => {
    signedInAs(SELF)
    gateOk()
    queueSubscriptions(SELF, OTHER)

    const res = await POST(request({ title: 'T', body: 'B' }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 2, failed: 0 })
  })

  it('returns 401 for a missing bearer token', async () => {
    gateRejects(401, 'Missing bearer token')

    const res = await POST(request({ title: 'T', body: 'B', profile_ids: [SELF] }, {}))

    expect(res.status).toBe(401)
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('still accepts the internal secret from the database trigger with no session', async () => {
    queueSubscriptions(SELF, OTHER)

    const res = await POST(request(
      { title: 'T', body: 'B' },
      { 'x-internal-secret': 'internal-secret' },
    ))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sent: 2, failed: 0 })
    expect(getUserMock).not.toHaveBeenCalled()
    expect(requireSuperadminMock).not.toHaveBeenCalled()
  })

  it('ignores non-string ids so a malformed target cannot widen the self rule', async () => {
    signedInAs(SELF)
    gateRejects(403, 'Superadmin only')

    // [null] serialises from an unloaded profile on the client; it must not
    // fall through to a broadcast for a non-superadmin.
    const res = await POST(request({ title: 'T', body: 'B', profile_ids: [null] }))

    expect(res.status).toBe(403)
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('rejects a body with no title or body before touching auth', async () => {
    const res = await POST(request({ title: 'T' }))

    expect(res.status).toBe(400)
    expect(getUserMock).not.toHaveBeenCalled()
    expect(requireSuperadminMock).not.toHaveBeenCalled()
  })
})
