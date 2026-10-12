import type { SupabaseClient } from '@supabase/supabase-js'
import { parseFacilityProfile, type RcraGeneratorCategory } from '@soteria/core/hazardousWaste'
import type { ApplicabilityContext } from '@soteria/core/environmental/applicability'
import type { ResolvedLibrary } from '@soteria/core/environmental/content'
import type { JurisdictionResolution } from '@soteria/core/environmental/jurisdiction'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { parseSiteProfile, type SiteProfile } from '@soteria/core/environmental/siteProfile'

// Everything the environmental routes need to know about one site, loaded once:
// where it is, which profile it has, and therefore which library applies.

export interface SiteContext {
  facility:     { id: string; name: string; state: string | null }
  /** The stored profile row, or null when the site has never been evaluated. */
  profileRow:   Record<string, unknown> | null
  profile:      SiteProfile
  jurisdiction: JurisdictionResolution
  library:      ResolvedLibrary
  applicability: ApplicabilityContext
}

export class SiteLookupError extends Error {}

/**
 * Load a site by id through the caller's own client, so row-level security
 * decides whether they may see it. Returns null when it does not exist or is not
 * theirs; throws SiteLookupError when the database itself failed (a failed read
 * is not "not found").
 */
export async function loadSiteContext(client: SupabaseClient, facilityId: string): Promise<SiteContext | null> {
  const [facilityResult, profileResult] = await Promise.all([
    client.from('facilities').select('id, name, state, settings').eq('id', facilityId).maybeSingle(),
    client.from('environmental_site_profiles').select('*').eq('facility_id', facilityId).maybeSingle(),
  ])
  if (facilityResult.error) throw new SiteLookupError(facilityResult.error.message)
  if (profileResult.error) throw new SiteLookupError(profileResult.error.message)
  const facility = facilityResult.data
  if (!facility) return null

  const profileRow = (profileResult.data ?? null) as Record<string, unknown> | null
  const profile = parseSiteProfile(profileRow)
  const generatorCategory: RcraGeneratorCategory | null =
    parseFacilityProfile(facility.settings as Record<string, unknown> | null).generator_category
  const { jurisdiction, library } = libraryForState(facility.state as string | null)

  return {
    facility:     { id: facility.id as string, name: facility.name as string, state: (facility.state as string | null) ?? null },
    profileRow,
    profile,
    jurisdiction,
    library,
    applicability: { profile, generatorCategory },
  }
}
