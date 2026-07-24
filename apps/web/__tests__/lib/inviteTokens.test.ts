// First-party invite tokens (lib/invites/tokens.ts + migration 247).
// The contract under test: raw tokens never touch the database (only
// sha256 hashes), issuing supersedes prior active tokens, and
// verification classifies every lifecycle state deterministically.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mockState, resetMocks } from '../api/superadmin/_helpers'
import {
  buildInviteUrl,
  consumeInviteToken,
  generateInviteToken,
  hashInviteToken,
  inviteLinkTtlDays,
  issueInviteToken,
  verifyInviteToken,
} from '@/lib/invites/tokens'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const ORIG_ENV = process.env

function tokenRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id:            'TOK-1',
    user_id:       'U1',
    tenant_id:     'T1',
    email:         'jane@x.com',
    expires_at:    new Date(Date.now() + 60_000).toISOString(),
    used_at:       null,
    superseded_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  resetMocks()
  process.env = { ...ORIG_ENV }
})
afterEach(() => { process.env = ORIG_ENV })

describe('generateInviteToken / hashInviteToken', () => {
  it('produces a URL-safe raw token whose stored form is its sha256 hex', () => {
    const { raw, hash } = generateInviteToken()
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/)   // 32 bytes base64url
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashInviteToken(raw))
    expect(hash).not.toContain(raw)
  })

  it('never repeats tokens', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateInviteToken().raw))
    expect(seen.size).toBe(50)
  })
})

describe('inviteLinkTtlDays', () => {
  it('defaults to 14 and honors INVITE_LINK_TTL_DAYS', () => {
    delete process.env.INVITE_LINK_TTL_DAYS
    expect(inviteLinkTtlDays()).toBe(14)
    process.env.INVITE_LINK_TTL_DAYS = '30'
    expect(inviteLinkTtlDays()).toBe(30)
    process.env.INVITE_LINK_TTL_DAYS = 'garbage'
    expect(inviteLinkTtlDays()).toBe(14)
  })
})

describe('buildInviteUrl', () => {
  it('lands on /accept-invite with the raw token in the query', () => {
    expect(buildInviteUrl('https://soteriafield.app', 'abc'))
      .toBe('https://soteriafield.app/accept-invite?token=abc')
  })
})

describe('issueInviteToken', () => {
  it('supersedes prior active tokens and stores only the hash', async () => {
    const admin = supabaseAdmin()
    const result = await issueInviteToken(admin, {
      userId: 'U1', tenantId: 'T1', email: 'jane@x.com', createdBy: 'super-1',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(mockState.updates.find(u => u.table === 'invite_tokens')?.payload)
      .toHaveProperty('superseded_at')
    const insert = mockState.inserts.find(i => i.table === 'invite_tokens')?.payload as Record<string, unknown>
    expect(insert.token_hash).toBe(hashInviteToken(result.raw))
    expect(JSON.stringify(insert)).not.toContain(result.raw)
    expect(new Date(insert.expires_at as string).getTime()).toBeGreaterThan(Date.now())
  })

  it('fails soft when the insert errors', async () => {
    const admin = supabaseAdmin()
    mockState.queue('invite_tokens', { data: null, error: null })                       // supersede ok
    mockState.queue('invite_tokens', { data: null, error: { message: 'no table' } })    // insert fails
    const result = await issueInviteToken(admin, {
      userId: 'U1', tenantId: null, email: 'jane@x.com', createdBy: null,
    })
    expect(result.ok).toBe(false)
  })
})

describe('verifyInviteToken', () => {
  it.each([
    ['valid',      tokenRow()],
    ['used',       tokenRow({ used_at: '2026-01-01T00:00:00Z' })],
    ['superseded', tokenRow({ superseded_at: '2026-01-01T00:00:00Z' })],
    ['expired',    tokenRow({ expires_at: new Date(Date.now() - 1000).toISOString() })],
  ] as const)('classifies a %s token', async (expected, row) => {
    mockState.queue('invite_tokens', { data: row, error: null })
    const { status } = await verifyInviteToken(supabaseAdmin(), 'raw-token')
    expect(status).toBe(expected)
  })

  it('returns not_found for an unknown token', async () => {
    mockState.queue('invite_tokens', { data: null, error: null })
    const { status, row } = await verifyInviteToken(supabaseAdmin(), 'nope')
    expect(status).toBe('not_found')
    expect(row).toBeNull()
  })
})

describe('consumeInviteToken', () => {
  it('reports whether this call actually consumed the token', async () => {
    mockState.queue('invite_tokens', { data: [{ id: 'TOK-1' }], error: null })
    expect(await consumeInviteToken(supabaseAdmin(), 'TOK-1')).toBe(true)
    mockState.queue('invite_tokens', { data: [], error: null })  // already consumed
    expect(await consumeInviteToken(supabaseAdmin(), 'TOK-1')).toBe(false)
  })
})
