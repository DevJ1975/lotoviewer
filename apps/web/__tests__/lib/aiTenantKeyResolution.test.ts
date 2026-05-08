import { describe, it, expect, vi, beforeEach } from 'vitest'

// Unit tests for getTenantApiKey's posture change in PR1: a malformed
// override now THROWS (MalformedTenantKeyError) instead of silently
// falling back to env. The shape-only validation in looksLikeAnthropicKey
// is covered by aiKeyShape.test.ts; this file pins the throw contract +
// the env-fallback paths that should still degrade gracefully.

const maybeSingleMock = vi.fn()

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: maybeSingleMock,
        }),
      }),
    }),
  }),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage:   vi.fn(),
}))

import { getTenantApiKey, MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'

const ORIGINAL_ENV = process.env.ANTHROPIC_API_KEY

beforeEach(() => {
  maybeSingleMock.mockReset()
  process.env.ANTHROPIC_API_KEY = ORIGINAL_ENV
})

describe('getTenantApiKey', () => {
  it('returns env key when tenantId is null', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-' + 'a'.repeat(40)
    expect(await getTenantApiKey(null)).toBe('sk-ant-env-' + 'a'.repeat(40))
    expect(maybeSingleMock).not.toHaveBeenCalled()
  })

  it('returns env key when tenant has NO override (settings.anthropic_api_key absent)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-' + 'a'.repeat(40)
    maybeSingleMock.mockResolvedValue({ data: { settings: { other: 'value' } } })
    expect(await getTenantApiKey('tenant-1')).toBe('sk-ant-env-' + 'a'.repeat(40))
  })

  it('returns env key when override is empty string', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-' + 'a'.repeat(40)
    maybeSingleMock.mockResolvedValue({ data: { settings: { anthropic_api_key: '' } } })
    expect(await getTenantApiKey('tenant-1')).toBe('sk-ant-env-' + 'a'.repeat(40))
  })

  it('returns env key when override is whitespace-only', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-' + 'a'.repeat(40)
    maybeSingleMock.mockResolvedValue({ data: { settings: { anthropic_api_key: '   \n\t' } } })
    expect(await getTenantApiKey('tenant-1')).toBe('sk-ant-env-' + 'a'.repeat(40))
  })

  it('returns the well-formed override when set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-' + 'a'.repeat(40)
    const override = 'sk-ant-tenant-' + 'b'.repeat(40)
    maybeSingleMock.mockResolvedValue({ data: { settings: { anthropic_api_key: override } } })
    expect(await getTenantApiKey('tenant-1')).toBe(override)
  })

  it('trims whitespace before validating + returning', async () => {
    const override = 'sk-ant-tenant-' + 'b'.repeat(40)
    maybeSingleMock.mockResolvedValue({ data: { settings: { anthropic_api_key: ` ${override}\n` } } })
    expect(await getTenantApiKey('tenant-1')).toBe(override)
  })

  it('THROWS MalformedTenantKeyError on a wrong-prefix override (PR1 fail-fast)', async () => {
    maybeSingleMock.mockResolvedValue({ data: { settings: { anthropic_api_key: 'OPENAI-' + 'x'.repeat(40) } } })
    await expect(getTenantApiKey('tenant-1')).rejects.toBeInstanceOf(MalformedTenantKeyError)
    await expect(getTenantApiKey('tenant-1')).rejects.toMatchObject({ tenantId: 'tenant-1', reason: 'wrong-prefix' })
  })

  it('THROWS MalformedTenantKeyError on a too-short override that has the right prefix', async () => {
    maybeSingleMock.mockResolvedValue({ data: { settings: { anthropic_api_key: 'sk-ant-tooShort' } } })
    await expect(getTenantApiKey('tenant-1')).rejects.toMatchObject({ reason: 'too-short' })
  })

  it('falls back to env (does NOT throw) when the supabase lookup itself fails', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-env-' + 'a'.repeat(40)
    maybeSingleMock.mockRejectedValue(new Error('connection refused'))
    expect(await getTenantApiKey('tenant-1')).toBe('sk-ant-env-' + 'a'.repeat(40))
  })

  it('returns empty string when env is missing AND no override (caller responsible for surface)', async () => {
    delete process.env.ANTHROPIC_API_KEY
    maybeSingleMock.mockResolvedValue({ data: { settings: {} } })
    expect(await getTenantApiKey('tenant-1')).toBe('')
  })
})
