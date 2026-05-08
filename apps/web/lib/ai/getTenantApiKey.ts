import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sentry from '@sentry/nextjs'

// Per-tenant Anthropic API key override.
//
// A tenant may store their own ANTHROPIC_API_KEY in
// tenants.settings.anthropic_api_key (free-form jsonb edited from
// /superadmin/tenants/<n>'s Settings section). When set, the AI
// routes use that key instead of the deployment's env-var default —
// so the spend lands on the tenant's Anthropic account, not the
// platform's.
//
// Usage in a route handler:
//
//   const apiKey = await getTenantApiKey(gate.tenantId)
//   const client = new Anthropic({ apiKey })
//
// `apiKey` is always a string (env-var fallback) so the Anthropic
// SDK constructor doesn't throw. Falls through silently to env when
// the tenant didn't override; logs to Sentry on lookup failure but
// still returns the env key (never blocks the AI call).

const KEY_NAME = 'anthropic_api_key'

// Anthropic API keys all start with the same prefix and have a
// generous lower bound on length. We validate shape so a truncated
// or whitespace-padded override (e.g. "sk-ant-abc" pasted from a
// half-copied console string, or " sk-ant-... \n" left over from a
// rich-text editor) falls back to the env key instead of silently
// 401-ing for that tenant only. The check is intentionally cheap +
// loose — Anthropic owns the actual format; we just want to catch
// obviously-broken values.
const ANTHROPIC_KEY_PREFIX = 'sk-ant-'
const MIN_KEY_LEN = 30  // real keys are ~100 chars; 30 catches obvious truncation

export function looksLikeAnthropicKey(s: string): boolean {
  return s.startsWith(ANTHROPIC_KEY_PREFIX) && s.length >= MIN_KEY_LEN
}

/** Returns the per-tenant key if set AND well-formed; otherwise the
 *  env-var default; otherwise empty string (Anthropic SDK will error
 *  on the call). A malformed tenant override logs a warning to Sentry
 *  so the operator can fix it instead of seeing inexplicable 401s
 *  scoped to one tenant. */
export async function getTenantApiKey(tenantId: string | null): Promise<string> {
  const envKey = process.env.ANTHROPIC_API_KEY ?? ''
  if (!tenantId) return envKey

  try {
    const admin = supabaseAdmin()
    const { data } = await admin
      .from('tenants')
      .select('settings')
      .eq('id', tenantId)
      .maybeSingle()
    const settings = (data?.settings ?? {}) as Record<string, unknown>
    const raw = settings[KEY_NAME]
    if (typeof raw === 'string' && raw.length > 0) {
      const trimmed = raw.trim()
      if (looksLikeAnthropicKey(trimmed)) {
        return trimmed
      }
      // Fall through to the env key — but tell the operator. Without
      // this warning a bad override looks like "AI is broken just for
      // tenant X" which is the hardest class of bug to diagnose.
      Sentry.captureMessage(
        'Tenant settings.anthropic_api_key is malformed — falling back to env key',
        {
          level: 'warning',
          tags: {
            source: 'getTenantApiKey',
            tenant_id: tenantId,
            reason: trimmed.startsWith(ANTHROPIC_KEY_PREFIX) ? 'too-short' : 'wrong-prefix',
          },
        },
      )
    }
  } catch (e) {
    // Sentry-log but don't fail the AI call. Falling through to env
    // is the correct degraded behaviour.
    Sentry.captureException(e, {
      tags: { source: 'getTenantApiKey', tenant_id: tenantId },
    })
  }

  return envKey
}
