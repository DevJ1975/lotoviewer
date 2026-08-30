import { describe, expect, it } from 'vitest'
import { composeAccessMessage } from '@/lib/members/accessMessage'

const BASE = {
  recipientName: 'Jose Ramirez-Delgado',
  email:         'jose@snakking.com',
  appUrl:        'https://soteriafield.app',
  expiresInDays: 7,
  tenantName:    'Snak King',
}

describe('composeAccessMessage', () => {
  it('greets by first name only', () => {
    const msg = composeAccessMessage({ ...BASE, kind: 'invite', inviteUrl: 'https://x/accept-invite?token=t' })
    expect(msg).toMatch(/^Hi Jose,/)
    expect(msg).not.toContain('Ramirez-Delgado')
  })

  it('falls back to a generic greeting when the name is blank', () => {
    const msg = composeAccessMessage({ ...BASE, recipientName: '   ', kind: 'invite', tempPassword: 'Abc123!x' })
    expect(msg).toMatch(/^Hi there,/)
  })

  it('states it is a reset — not a new account — for the reset kind', () => {
    const msg = composeAccessMessage({ ...BASE, kind: 'reset', tempPassword: 'Abc123!x' })
    expect(msg).toContain('password for Snak King has been reset')
    expect(msg).not.toContain("You've been given access")
  })

  it('includes the tenant name only when one is supplied', () => {
    const withTenant = composeAccessMessage({ ...BASE, kind: 'invite', tempPassword: 'Abc123!x' })
    expect(withTenant).toContain('for Snak King')

    const without = composeAccessMessage({ ...BASE, tenantName: null, kind: 'invite', tempPassword: 'Abc123!x' })
    expect(without).toContain('access to Soteria Field.')
    expect(without).not.toContain('for ')
  })

  it('presents the password as a fallback when a link is also present', () => {
    const msg = composeAccessMessage({
      ...BASE, kind: 'invite',
      inviteUrl: 'https://x/accept-invite?token=t',
      tempPassword: 'Abc123!x',
    })
    expect(msg).toContain('If that link stops working')
    expect(msg).toContain('Abc123!x')
  })

  it('presents the password as the primary route when there is no link', () => {
    const msg = composeAccessMessage({ ...BASE, kind: 'reset', tempPassword: 'Abc123!x' })
    expect(msg).toContain('Sign in at https://soteriafield.app with:')
    expect(msg).not.toContain('If that link stops working')
  })

  it('singularises a one-day expiry', () => {
    const msg = composeAccessMessage({
      ...BASE, kind: 'invite', expiresInDays: 1, inviteUrl: 'https://x/a?token=t',
    })
    expect(msg).toContain('(link expires in 1 day):')
    expect(msg).not.toContain('1 days')
  })

  it('omits the expiry sentence when the TTL is missing or non-positive', () => {
    for (const expiresInDays of [undefined, 0, -3]) {
      const msg = composeAccessMessage({
        ...BASE, kind: 'invite', expiresInDays, inviteUrl: 'https://x/a?token=t',
      })
      expect(msg).not.toContain('expires in')
    }
  })

  // The route can legitimately return neither credential (email delivery
  // handled it). The message must still tell the worker what to do.
  it('degrades to self-service instructions when no credential is returned', () => {
    const msg = composeAccessMessage({ ...BASE, kind: 'reset' })
    expect(msg).toContain('jose@snakking.com')
    expect(msg).toContain('Forgot password')
  })

  it('never leaks a password that was not issued', () => {
    const msg = composeAccessMessage({
      ...BASE, kind: 'invite', inviteUrl: 'https://x/a?token=t', tempPassword: null,
    })
    expect(msg).not.toContain('Password:')
  })
})
