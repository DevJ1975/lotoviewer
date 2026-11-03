import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { looksLikeAnthropicKey } from '@/lib/ai/getTenantApiKey'

// Superadmin-side access to a tenant's own Anthropic key (tenant_secrets,
// migration 306). Kept apart from getTenantApiKey, which is the hot read path
// the AI routes use. The key itself never leaves the server: the superadmin UI
// is only ever told whether one is set and its last four characters.

const HINT_LENGTH = 4

export interface TenantApiKeyHint {
  configured: boolean
  last4:      string | null
}

export type ParsedKeyChange =
  | { ok: true;  change: { kind: 'set'; key: string } | { kind: 'clear' } }
  | { ok: false; error: string }

// `null` clears the override; a string sets it. An empty string is rejected
// rather than treated as a clear, so a form that forgot to send the field can
// never wipe a working key.
export function parseKeyChange(raw: unknown): ParsedKeyChange {
  if (raw === null) return { ok: true, change: { kind: 'clear' } }
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'anthropic_api_key must be a key string, or null to remove the override' }
  }
  const key = raw.trim()
  if (!looksLikeAnthropicKey(key)) {
    return { ok: false, error: 'anthropic_api_key must start with "sk-ant-" and be a complete key' }
  }
  return { ok: true, change: { kind: 'set', key } }
}

export async function readTenantApiKeyHint(tenantId: string): Promise<TenantApiKeyHint> {
  const { data, error } = await supabaseAdmin()
    .from('tenant_secrets')
    .select('anthropic_api_key')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)

  const key = typeof data?.anthropic_api_key === 'string' ? data.anthropic_api_key.trim() : ''
  return key.length > 0
    ? { configured: true,  last4: key.slice(-HINT_LENGTH) }
    : { configured: false, last4: null }
}

export async function applyTenantApiKeyChange(
  tenantId:  string,
  change:    { kind: 'set'; key: string } | { kind: 'clear' },
  updatedBy: string,
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('tenant_secrets')
    .upsert(
      {
        tenant_id:         tenantId,
        anthropic_api_key: change.kind === 'set' ? change.key : null,
        updated_at:        new Date().toISOString(),
        updated_by:        updatedBy,
      },
      { onConflict: 'tenant_id' },
    )
  if (error) throw new Error(error.message)
}
