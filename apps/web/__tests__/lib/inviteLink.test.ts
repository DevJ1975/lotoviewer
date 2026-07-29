import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateInviteLink } from '@/lib/auth/inviteLink'

// generateInviteLink wraps admin.auth.admin.generateLink. We feed it a minimal
// fake admin whose generateLink is a vitest mock, and assert the invite →
// magiclink fallback logic plus the returned shape.

function adminWith(generateLink: ReturnType<typeof vi.fn>) {
  return { auth: { admin: { generateLink } } } as unknown as Parameters<typeof generateInviteLink>[0]
}

const ARGS = { email: 'new@example.com', fullName: 'New User', redirectTo: 'https://app.test/welcome' }

describe('generateInviteLink', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('uses an invite link for a brand-new address and reports created=true', async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { user: { id: 'U-NEW' }, properties: { action_link: 'https://supabase.test/verify?type=invite' } },
      error: null,
    })

    const out = await generateInviteLink(adminWith(generateLink), ARGS)

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result).toEqual({ userId: 'U-NEW', actionLink: 'https://supabase.test/verify?type=invite', created: true })
    expect(generateLink).toHaveBeenCalledTimes(1)
    expect(generateLink).toHaveBeenCalledWith({
      type: 'invite',
      email: 'new@example.com',
      options: { data: { full_name: 'New User' }, redirectTo: 'https://app.test/welcome' },
    })
  })

  it('falls back to a magic link when the address is already registered (created=false)', async () => {
    const generateLink = vi.fn()
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'already been registered' } })
      .mockResolvedValueOnce({
        data: { user: { id: 'U-OLD' }, properties: { action_link: 'https://supabase.test/verify?type=magiclink' } },
        error: null,
      })

    const out = await generateInviteLink(adminWith(generateLink), ARGS)

    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result).toEqual({ userId: 'U-OLD', actionLink: 'https://supabase.test/verify?type=magiclink', created: false })
    expect(generateLink).toHaveBeenCalledTimes(2)
    expect(generateLink).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'magiclink', email: 'new@example.com' }))
  })

  it('omits the metadata object when no full name is given', async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { user: { id: 'U' }, properties: { action_link: 'https://supabase.test/verify' } },
      error: null,
    })

    await generateInviteLink(adminWith(generateLink), { email: 'x@y.com', redirectTo: 'https://app.test/welcome' })

    expect(generateLink).toHaveBeenCalledWith(expect.objectContaining({
      options: { data: undefined, redirectTo: 'https://app.test/welcome' },
    }))
  })

  it('returns an error when both invite and magic link fail', async () => {
    const generateLink = vi.fn()
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'already been registered' } })
      .mockResolvedValueOnce({ data: { user: null }, error: { message: 'rate limited' } })

    const out = await generateInviteLink(adminWith(generateLink), ARGS)

    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.error.message).toBe('rate limited')
  })
})
