import type { SupabaseClient } from '@supabase/supabase-js'
import type { OutfallInput } from '@soteria/core/environmental/outfalls'

export const PERMIT_AT_SITE = 'permit_id must be a permit at this site.'
export const PARTNER_AT_SITE = 'substantially_identical_to must be another outfall at this site.'

// RLS keeps a read inside the tenant, not inside the site, so an id copied from
// another site's permit or outfall would read fine. A reference stays on the
// outfall's own site, which only this check enforces.
export async function offSiteReferenceErrors(client: SupabaseClient, tenantId: string, outfall: OutfallInput): Promise<string[]> {
  const isOnSite = async (table: string, id: string | null): Promise<boolean> => {
    if (id === null) return true
    const { data, error } = await client.from(table).select('id')
      .eq('tenant_id', tenantId).eq('facility_id', outfall.facilityId).eq('id', id).maybeSingle()
    if (error) throw new Error(error.message)
    return data !== null
  }
  const [permitOnSite, partnerOnSite] = await Promise.all([
    isOnSite('environmental_permits', outfall.permitId),
    isOnSite('stormwater_outfalls', outfall.substantiallyIdenticalTo),
  ])
  return [...(permitOnSite ? [] : [PERMIT_AT_SITE]), ...(partnerOnSite ? [] : [PARTNER_AT_SITE])]
}
