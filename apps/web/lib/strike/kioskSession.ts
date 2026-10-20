import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPublishedStrikeVersion, type StrikeVersionRow } from '@/lib/strike/moduleAccess'
import type { KioskClaims } from '@/lib/strike/kioskToken'
import type { StrikeLearner, StrikeResult } from '@/lib/strike/attempts'

export interface KioskSession {
  learner: StrikeLearner
  module: { id: string; title: string; description: string | null }
  version: StrikeVersionRow
  memberName: string
}

/**
 * Resolves a verified kiosk token to the module version the worker will
 * take. Re-checks the member is still active in the token's tenant, so a
 * worker removed after the link was issued cannot use it.
 */
export async function loadKioskSession(admin: SupabaseClient, claims: KioskClaims): Promise<StrikeResult<KioskSession>> {
  const [{ data: member, error: memberErr }, { data: moduleRow, error: moduleErr }, { data: latest, error: latestErr }] = await Promise.all([
    admin.from('members').select('id,tenant_id,display_name,preferred_name,status').eq('id', claims.memberId).maybeSingle(),
    admin.from('strike_modules').select('id,title,description').eq('id', claims.moduleId).maybeSingle(),
    admin.from('strike_module_versions')
      .select('id')
      .eq('module_id', claims.moduleId)
      .eq('status', 'published')
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (memberErr || moduleErr || latestErr) throw new Error((memberErr ?? moduleErr ?? latestErr)?.message)

  if (!member || member.tenant_id !== claims.tenantId || member.status !== 'active') {
    return { ok: false, status: 403, message: 'This link is no longer valid for this worker.' }
  }
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
    },
  }
}
