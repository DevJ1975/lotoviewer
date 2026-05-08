import { describe, it, expect } from 'vitest'
import { looksLikeAnthropicKey } from '@/lib/ai/getTenantApiKey'

// Quick sanity tests for the shape gate. The gate's job is to catch
// truncated or wrong-prefix tenant overrides BEFORE they hit the
// Anthropic SDK and produce inscrutable 401s. We deliberately don't
// model the real key format precisely — that's Anthropic's
// contract; we just block obviously-broken values.

describe('looksLikeAnthropicKey', () => {
  it('accepts a well-formed key', () => {
    expect(looksLikeAnthropicKey('sk-ant-' + 'a'.repeat(40))).toBe(true)
  })

  it('rejects empty + nullish-ish strings', () => {
    expect(looksLikeAnthropicKey('')).toBe(false)
    expect(looksLikeAnthropicKey('null')).toBe(false)
    expect(looksLikeAnthropicKey('undefined')).toBe(false)
  })

  it('rejects values with the wrong prefix', () => {
    expect(looksLikeAnthropicKey('sk-' + 'a'.repeat(40))).toBe(false)
    expect(looksLikeAnthropicKey('OPENAI-' + 'a'.repeat(40))).toBe(false)
    expect(looksLikeAnthropicKey('sk-ant' + 'a'.repeat(40))).toBe(false)
  })

  it('rejects truncated values that share the prefix', () => {
    expect(looksLikeAnthropicKey('sk-ant-')).toBe(false)
    expect(looksLikeAnthropicKey('sk-ant-abc')).toBe(false)
    expect(looksLikeAnthropicKey('sk-ant-' + 'a'.repeat(20))).toBe(false)
  })

  it('accepts the boundary', () => {
    // 7 prefix chars + 23 body chars = 30 total, the documented floor.
    expect(looksLikeAnthropicKey('sk-ant-' + 'a'.repeat(23))).toBe(true)
    expect(looksLikeAnthropicKey('sk-ant-' + 'a'.repeat(22))).toBe(false)
  })

  it('does NOT trim — caller is responsible for trimming first', () => {
    // The caller in getTenantApiKey trims before calling this. Test
    // the no-trim invariant so a refactor can't accidentally bake it
    // in here and silently accept whitespace.
    expect(looksLikeAnthropicKey(' sk-ant-' + 'a'.repeat(40))).toBe(false)
  })
})
