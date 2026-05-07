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

/** Returns the per-tenant key if set; otherwise the env-var default;
 *  otherwise empty string (Anthropic SDK will error on the call). */
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
    const tenantKey = settings[KEY_NAME]
    if (typeof tenantKey === 'string' && tenantKey.length > 0) {
      return tenantKey
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
