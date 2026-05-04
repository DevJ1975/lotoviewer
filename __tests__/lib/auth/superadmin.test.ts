import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

// Mocks must be declared before the import. We control:
//   - createClient (anon) → exposes auth.getUser to flip token validity
//   - supabaseAdmin (service role) → exposes from('profiles').select.eq.maybeSingle
//                                    to flip the is_superadmin DB flag

const getUserMock         = vi.fn()
const profileMaybeSingle  = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: getUserMock },
  })),
}))

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: profileMaybeSingle })),
      })),
    })),
  })),
}))

import { requireSuperadmin } from '@/lib/auth/superadmin'

const ORIG_ENV = process.env

describe('requireSuperadmin', () => {
  beforeEach(() => {
    process.env = { ...ORIG_ENV }
    process.env.NEXT_PUBLIC_SUPABASE_URL      = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    process.env.SUPERADMIN_EMAILS             = 'jamil@trainovations.com'
    getUserMock.mockReset()
    profileMaybeSingle.mockReset()
  })

  afterEach(() => {
    process.env = ORIG_ENV
  })

  it('rejects with 401 when the bearer token is missing', async () => {
    const result = await requireSuperadmin(null)
    expect(result).toEqual({ ok: false, status: 401, message: 'Missing bearer token' })
  })

  it('rejects with 401 when the header has no Bearer prefix', async () => {
    const result = await requireSuperadmin('Basic abc')
    expect(result).toEqual({ ok: false, status: 401, message: 'Missing bearer token' })
  })

  it('rejects with 500 when Supabase env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    const result = await requireSuperadmin('Bearer t')
    expect(result).toEqual({ ok: false, status: 500, message: 'Supabase env not configured' })
  })

  it('rejects with 401 when the token doesn\'t resolve to a user', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } })
    const result = await requireSuperadmin('Bearer t')
    expect(result).toEqual({ ok: false, status: 401, message: 'Invalid session' })
  })

  it('rejects with 401 when the user has no email', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: null } }, error: null })
    const result = await requireSuperadmin('Bearer t')
    expect(result).toEqual({ ok: false, status: 401, message: 'Invalid session' })
  })

  it('rejects with 403 when the email is not in SUPERADMIN_EMAILS (gate 1)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'attacker@evil.com' } },
      error: null,
    })
    const result = await requireSuperadmin('Bearer t')
    expect(result).toEqual({ ok: false, status: 403, message: 'Superadmin only' })
    // DB flag should NOT have been read since gate 1 already failed.
    expect(profileMaybeSingle).not.toHaveBeenCalled()
  })

  it('matches SUPERADMIN_EMAILS case-insensitively', async () => {
    process.env.SUPERADMIN_EMAILS = 'Jamil@TRAINOVATIONS.com'
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'jamil@trainovations.com' } },
      error: null,
    })
    profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: true } })
    const result = await requireSuperadmin('Bearer t')
    expect(result.ok).toBe(true)
  })

  it('honors a comma-separated SUPERADMIN_EMAILS list', async () => {
    process.env.SUPERADMIN_EMAILS = 'one@x.com, two@x.com ,three@x.com'
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'two@x.com' } },
      error: null,
    })
    profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: true } })
    const result = await requireSuperadmin('Bearer t')
    expect(result.ok).toBe(true)
  })

  it('rejects with 403 when the DB flag is false (gate 2)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'jamil@trainovations.com' } },
      error: null,
    })
    profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: false } })
    const result = await requireSuperadmin('Bearer t')
    expect(result).toEqual({ ok: false, status: 403, message: 'Superadmin only' })
  })

  it('rejects with 403 when no profile row exists (gate 2)', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'jamil@trainovations.com' } },
      error: null,
    })
    profileMaybeSingle.mockResolvedValue({ data: null })
    const result = await requireSuperadmin('Bearer t')
    expect(result).toEqual({ ok: false, status: 403, message: 'Superadmin only' })
  })

  it('returns ok with userId + email when both gates pass', async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'jamil@trainovations.com' } },
      error: null,
    })
    profileMaybeSingle.mockResolvedValue({ data: { is_superadmin: true } })
    const result = await requireSuperadmin('Bearer t')
    expect(result).toEqual({ ok: true, userId: 'u1', email: 'jamil@trainovations.com' })
  })
})
