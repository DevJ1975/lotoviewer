import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sentry from '@sentry/nextjs'

// Per-tenant Anthropic API key override.
//
// A tenant may store their own ANTHROPIC_API_KEY in
// tenants.settings.anthropic_api_key (edited from the dedicated
// "Anthropic API key" input on /superadmin/tenants/<n>). When set, the
// AI routes use that key instead of the deployment's env-var default —
// so the spend lands on the tenant's Anthropic account, not the
// platform's.
//
// Posture change (PR1): a present-but-malformed override no longer
// silently falls back to the env key. It throws MalformedTenantKeyError
// which the shared client wrapper turns into a 502 + clear operator
// message. This makes "AI works for tenant A but not tenant B" — the
// hardest class of bug from the legacy behaviour — impossible. An
// empty/whitespace override still falls through to env (no override
// configured = use the platform default).
//
// Usage in a route handler:
//
//   try {
//     const client = await getAnthropic(gate.tenantId)
//     const response = await client.messages.create({ ... })
//   } catch (err) {
//     if (err instanceof MalformedTenantKeyError) ...
//   }

const KEY_NAME = 'anthropic_api_key'

// Anthropic API keys all start with the same prefix and have a
// generous lower bound on length. We validate shape so a truncated
// or whitespace-padded override falls fast instead of silently
// 401-ing for that tenant only.
const ANTHROPIC_KEY_PREFIX = 'sk-ant-'
const MIN_KEY_LEN = 30  // real keys are ~100 chars; 30 catches obvious truncation

export class MalformedTenantKeyError extends Error {
  constructor(public tenantId: string, public reason: 'too-short' | 'wrong-prefix') {
    super(`Tenant ${tenantId} has a malformed Anthropic API key (${reason})`)
    this.name = 'MalformedTenantKeyError'
  }
}

export function looksLikeAnthropicKey(s: string): boolean {
  return s.startsWith(ANTHROPIC_KEY_PREFIX) && s.length >= MIN_KEY_LEN
}

/**
 * Returns the API key for `tenantId` (override → env fallback).
 *
 * Behaviour:
 *   - tenant has a well-formed override → return it
 *   - tenant has NO override (null/empty/whitespace) → return env key
 *   - tenant has a malformed override → throw MalformedTenantKeyError
 *   - admin lookup fails → log Sentry, return env (degraded but not blocked)
 *   - env key missing AND no tenant override → return '' (caller throws
 *     AnthropicNotConfiguredError; matches old behaviour for tests).
 */
export async function getTenantApiKey(tenantId: string | null): Promise<string> {
  const envKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!tenantId) return envKey

  let raw: unknown
  try {
    const admin = supabaseAdmin()
    const { data } = await admin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle()
    const settings = (data?.settings ?? {}) as Record<string, unknown>
    raw = settings[KEY_NAME]
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'getTenantApiKey', tenant_id: tenantId },
    })
    return envKey
  }

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    // No override configured — env fallback is the right answer.
    return envKey
  }

  const trimmed = raw.trim()
  if (looksLikeAnthropicKey(trimmed)) return trimmed

  // Malformed override — fail fast. Logged at warning level so the
  // operator gets a Sentry alert tied to the specific tenant.
  const reason: 'too-short' | 'wrong-prefix' =
    trimmed.startsWith(ANTHROPIC_KEY_PREFIX) ? 'too-short' : 'wrong-prefix'
  Sentry.captureMessage(
    'Tenant settings.anthropic_api_key is malformed — refusing to use it',
    {
      level: 'warning',
      tags:  { source: 'getTenantApiKey', tenant_id: tenantId, reason },
    },
  )
  throw new MalformedTenantKeyError(tenantId, reason)
}
