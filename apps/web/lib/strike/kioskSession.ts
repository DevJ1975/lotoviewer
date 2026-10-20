import type { SupabaseClient } from '@supabase/supabase-js'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { latestVersionPerLocale, pickStrikeLocale } from '@soteria/core/strikeLocale'
import { loadPublishedStrikeVersion, type StrikeVersionRow } from '@/lib/strike/moduleAccess'
import type { KioskClaims } from '@/lib/strike/kioskToken'
import type { StrikeLearner, StrikeResult } from '@/lib/strike/attempts'

export interface KioskSession {
  learner: StrikeLearner
  module: { id: string; title: string; description: string | null }
  version: StrikeVersionRow
  memberName: string
  /** Languages the module is published in, for the learner's language switch. */
  locales: string[]
}

/**
 * Resolves a verified kiosk token to the module version the worker will
 * take. Re-checks the member is still active in the token's tenant, so a
 * worker removed after the link was issued cannot use it, and that the
 * tenant still has STRIKE: the token is the kiosk's only credential, so no
 * route gate runs before this to refuse a disabled tenant.
 */
export async function loadKioskSession(
  admin: SupabaseClient,
  claims: KioskClaims,
  preferredLocale: string | null,
): Promise<StrikeResult<KioskSession>> {
  const [{ data: tenant, error: tenantErr }, { data: member, error: memberErr }, { data: moduleRow, error: moduleErr }, { data: published, error: latestErr }] = await Promise.all([
    admin.from('tenants').select('modules,disabled_at').eq('id', claims.tenantId).maybeSingle(),
    admin.from('members').select('id,tenant_id,display_name,preferred_name,status').eq('id', claims.memberId).maybeSingle(),
    admin.from('strike_modules').select('id,title,description').eq('id', claims.moduleId).maybeSingle(),
    admin.from('strike_module_versions')
      .select('id,locale,version_number')
      .eq('module_id', claims.moduleId)
      .eq('status', 'published'),
  ])
  if (tenantErr || memberErr || moduleErr || latestErr) throw new Error((tenantErr ?? memberErr ?? moduleErr ?? latestErr)?.message)

  if (!tenant || tenant.disabled_at || !isModuleVisible('strike', (tenant.modules ?? null) as Record<string, boolean> | null)) {
    return { ok: false, status: 403, message: 'Training is not available for this site.' }
  }

  if (!member || member.tenant_id !== claims.tenantId || member.status !== 'active') {
    return { ok: false, status: 403, message: 'This link is no longer valid for this worker.' }
  }
  const latestByLocale = latestVersionPerLocale((published ?? []) as { id: string; locale: string; version_number: number }[])
  const locale = pickStrikeLocale([...latestByLocale.keys()], preferredLocale)
  const latest = locale ? latestByLocale.get(locale) : undefined
  if (!moduleRow || !latest) return { ok: false, status: 404, message: 'This training is not available.' }

  const lookup = await loadPublishedStrikeVersion(admin, {
    moduleId: claims.moduleId,
    moduleVersionId: latest.id as string,
    tenantId: claims.tenantId,
    role: 'member',
  })
  if (!lookup.ok) return lookup

  return {
    ok: true,
    value: {
      learner: {
        tenantId: claims.tenantId,
        userId: null,
        memberId: claims.memberId,
        role: null,
        channel: 'kiosk',
        kioskIssuedBy: claims.issuedBy,
      },
      module: { id: moduleRow.id as string, title: moduleRow.title as string, description: (moduleRow.description as string | null) ?? null },
      version: lookup.version,
      memberName: (member.preferred_name as string | null) || (member.display_name as string),
      locales: [...latestByLocale.keys()].sort(),
    },
  }
}
