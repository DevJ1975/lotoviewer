import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  device: vi.fn(), member: vi.fn(), build: vi.fn(), loadVersion: vi.fn(), sign: vi.fn(),
  versionRow: { data: { module_id: 'mod-1' } as unknown, error: null as null | { message: string } },
}))
vi.mock('@/lib/strike/deviceAuth', async importOriginal => ({ ...(await importOriginal<typeof import('@/lib/strike/deviceAuth')>()), authenticateDevice: () => h.device() }))
vi.mock('@/lib/strike/gate', () => ({ requireStrikeMember: () => h.member() }))
vi.mock('@/lib/strike/offlineManifest', () => ({ buildOfflineManifest: (...a: unknown[]) => h.build(...a) }))
vi.mock('@/lib/strike/moduleAccess', () => ({ loadPublishedStrikeVersion: (...a: unknown[]) => h.loadVersion(...a) }))
vi.mock('@/lib/strike/assets', () => ({ signStrikeContentAssets: (...a: unknown[]) => h.sign(...a), STRIKE_ASSET_TTL_SECONDS: 3600, STRIKE_MEDIA_BUCKET: 'strike-media' }))
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => h.versionRow
      return chain
    },
  }),
}))

import { authenticateOfflineCaller } from '@/lib/strike/offlineCaller'
import { GET as manifestGet } from '@/app/api/strike/offline/manifest/route'
import { POST as assetsPost } from '@/app/api/strike/offline/assets/route'
import { STRIKE_DEVICE_HEADER } from '@/lib/strike/deviceAuth'

const DEVICE = { id: 'dev-1', tenantId: 't1', name: 'Line 3', department: null, siteLabel: null, enrolledBy: 'admin-1' }
const VERSION_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const withDevice = (init: RequestInit = {}) => ({ ...init, headers: { [STRIKE_DEVICE_HEADER]: 'cred', ...(init.headers ?? {}) } })

beforeEach(() => {
  globalThis.__soteriaMemoryRateLimits = new Map()
  h.device.mockReset().mockResolvedValue({ ok: true, device: DEVICE })
  h.member.mockReset().mockResolvedValue({ ok: true, tenantId: 't1', userId: 'u1', role: 'member' })
  h.build.mockReset().mockResolvedValue({ modules: [] })
  h.loadVersion.mockReset().mockResolvedValue({ ok: true, version: { id: VERSION_ID, content: { blocks: [] } } })
  h.sign.mockReset().mockResolvedValue({ 'a.jpg': 'https://signed/a.jpg' })
  h.versionRow = { data: { module_id: 'mod-1' }, error: null }
})

describe('authenticateOfflineCaller', () => {
  it('treats a request with a device header as that device', async () => {
    const auth = await authenticateOfflineCaller({} as never, new Request('http://x', withDevice()))
    expect(auth).toMatchObject({ ok: true, keyScope: 'dev-1', rateKey: 'device:dev-1', caller: { tenantId: 't1', device: DEVICE, user: null } })
    expect(h.member).not.toHaveBeenCalled()
  })

  it('a bad device credential is refused even when a valid bearer token rides along', async () => {
    h.device.mockResolvedValue({ ok: false, status: 401, message: 'This device was removed.', code: 'device_revoked' })
    const auth = await authenticateOfflineCaller({} as never, new Request('http://x', withDevice({ headers: { authorization: 'Bearer valid' } })))
    expect(auth).toMatchObject({ ok: false, status: 401, code: 'device_revoked' })
    expect(h.member).not.toHaveBeenCalled()
  })

  it('a signed-in tablet is bound to its user, in its tenant', async () => {
    const auth = await authenticateOfflineCaller({} as never, new Request('http://x', { headers: { authorization: 'Bearer t' } }))
    expect(auth).toMatchObject({ ok: true, keyScope: 'user:u1', rateKey: 'user:t1:u1', caller: { device: null, user: { userId: 'u1', role: 'member' } } })
  })

  it('refuses a caller with neither credential', async () => {
    h.member.mockResolvedValue({ ok: false, status: 401, message: 'Missing bearer token' })
    expect(await authenticateOfflineCaller({} as never, new Request('http://x'))).toMatchObject({ ok: false, status: 401 })
  })
})

describe('GET /api/strike/offline/manifest', () => {
  it('is never cached, because it carries the per-device answer key', async () => {
    const res = await manifestGet(new Request('http://x', withDevice()))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(h.build.mock.calls[0][1]).toMatchObject({ tenantId: 't1', device: DEVICE, keyScope: 'dev-1' })
  })

  it('builds nothing for an unauthenticated caller', async () => {
    h.member.mockResolvedValue({ ok: false, status: 401, message: 'Missing bearer token' })
    expect((await manifestGet(new Request('http://x'))).status).toBe(401)
    expect(h.build).not.toHaveBeenCalled()
  })

  it('limits how often one device can rebuild it', async () => {
    for (let i = 0; i < 10; i++) expect((await manifestGet(new Request('http://x', withDevice()))).status).toBe(200)
    expect((await manifestGet(new Request('http://x', withDevice()))).status).toBe(429)
  })
})

describe('POST /api/strike/offline/assets', () => {
  const post = (body: unknown, init: RequestInit = withDevice()) =>
    assetsPost(new Request('http://x', { ...init, method: 'POST', headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }, body: JSON.stringify(body) }))

  it('signs the module’s media for the device’s own tenant, and the URLs are not cacheable', async () => {
    const res = await post({ module_version_id: VERSION_ID })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ urls: { 'a.jpg': 'https://signed/a.jpg' }, expires_in: 3600 })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(h.loadVersion.mock.calls[0][1]).toMatchObject({ moduleId: 'mod-1', moduleVersionId: VERSION_ID, tenantId: 't1' })
  })

  it('answers 404 for a version the tenant cannot see, without signing anything', async () => {
    h.loadVersion.mockResolvedValue({ ok: false, status: 404, message: 'Module not found' })
    expect((await post({ module_version_id: VERSION_ID })).status).toBe(404)
    expect(h.sign).not.toHaveBeenCalled()
  })

  it('answers 404 for a version that does not exist', async () => {
    h.versionRow = { data: null, error: null }
    expect((await post({ module_version_id: VERSION_ID })).status).toBe(404)
  })

  it('refuses a malformed id and an unauthenticated caller', async () => {
    expect((await post({ module_version_id: 'nope' })).status).toBe(400)
    h.member.mockResolvedValue({ ok: false, status: 401, message: 'Missing bearer token' })
    expect((await post({ module_version_id: VERSION_ID }, {})).status).toBe(401)
    expect(h.sign).not.toHaveBeenCalled()
  })
})
