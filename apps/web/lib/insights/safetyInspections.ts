import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Failed SAFETY inspections since `sinceIso`. Environmental checklists are stored as
 * inspections too (domain = 'environmental'); their failures are findings to follow
 * up, not injury leading indicators, so they are excluded here.
 */
export const failedSafetyInspections = (admin: SupabaseClient, tenantId: string, sinceIso: string) =>
  admin.from('inspections').select('created_at')
    .eq('tenant_id', tenantId).eq('domain', 'safety').eq('result', 'fail').gte('created_at', sinceIso)
