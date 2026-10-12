import type { SupabaseClient } from '@supabase/supabase-js'

export const OUTFALL_AT_SITE = 'outfall_id must be an outfall at this site.'
export const PERMIT_AT_SITE = 'permit_id must be a permit at this site.'

// RLS keeps a read inside the tenant (and the active site), not inside the record's own
// site, so an id copied from another site's outfall or permit reads fine. A limit or a result
// stays on its own site. The database holds the same rule (a composite foreign key), but it
// refuses with a constraint name; asking first lets the caller hear the reason.
//
// A retired permit is still a row at its site, so a limit that already names one passes: the
// vault retires permits, it never deletes them.
export async function offSiteMonitoringReferences(
  client: SupabaseClient,
  tenantId: string,
  site: { facilityId: string; outfallId: string | null; permitId?: string | null },
): Promise<string[]> {
  const isOnSite = async (table: string, id: string | null | undefined): Promise<boolean> => {
    if (!id) return true
    const { data, error } = await client.from(table).select('id')
      .eq('tenant_id', tenantId).eq('facility_id', site.facilityId).eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data !== null
  }
  const [outfallOnSite, permitOnSite] = await Promise.all([
    isOnSite('stormwater_outfalls', site.outfallId),
    isOnSite('environmental_permits', site.permitId),
  ])
  return [...(outfallOnSite ? [] : [OUTFALL_AT_SITE]), ...(permitOnSite ? [] : [PERMIT_AT_SITE])]
}
