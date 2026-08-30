import type { SupabaseClient } from '@supabase/supabase-js'

// Shared published-module lookup for the learner-facing STRIKE API routes
// (quiz submit, media URL issuance). Both must agree on what "visible"
// means: the module and version are published, and tenant-scoped content
// is only reachable from inside that tenant (superadmin excepted).

export interface StrikeVersionRow {
  id: string
  module_id: string
  tenant_id: string | null
  library_scope: 'global' | 'tenant'
  status: string
  passing_score: number
  retake_limit: number | null
  video_external_id: string | null
  video_meta: Record<string, unknown> | null
}

export type StrikeVersionLookup =
  | { ok: true; version: StrikeVersionRow }
  | { ok: false; status: number; message: string }

export async function loadPublishedStrikeVersion(
  admin: SupabaseClient,
  opts: {
    moduleId: string
    moduleVersionId: string
    tenantId: string
    role: string
  },
): Promise<StrikeVersionLookup> {
  const { data: moduleRow, error: moduleErr } = await admin
    .from('strike_modules')
    .select('id,tenant_id,library_scope,status')
    .eq('id', opts.moduleId)
    .maybeSingle()
  if (moduleErr) throw new Error(moduleErr.message)
  if (!moduleRow || moduleRow.status !== 'published') {
    return { ok: false, status: 404, message: 'Module not found' }
  }
  if (
    moduleRow.library_scope === 'tenant'
    && moduleRow.tenant_id !== opts.tenantId
    && opts.role !== 'superadmin'
  ) {
    return { ok: false, status: 404, message: 'Module not found' }
  }

  const { data: version, error: versionErr } = await admin
    .from('strike_module_versions')
    .select('id,module_id,tenant_id,library_scope,status,passing_score,retake_limit,video_external_id,video_meta')
    .eq('id', opts.moduleVersionId)
    .eq('module_id', opts.moduleId)
    .maybeSingle()
  if (versionErr) throw new Error(versionErr.message)
  if (!version || version.status !== 'published') {
    return { ok: false, status: 404, message: 'Published version not found' }
  }

  return { ok: true, version: version as StrikeVersionRow }
}
