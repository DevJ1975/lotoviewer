import { parseFacilityProfile, type RcraGeneratorCategory } from '@soteria/core/hazardousWaste'
import { fallbackNotice, isSupportedState, resolveJurisdiction, stateName, US_STATES } from '@soteria/core/environmental/jurisdiction'
import { parseSiteProfile, programsInScope, toProfileRow } from '@soteria/core/environmental/siteProfile'
import type { SiteContext } from './siteContext'

// The JSON shapes the environmental screens read about a site. Kept in one place
// so the site list, the profile screen and the post-save response cannot disagree.

/** The states the dropdown offers, flagged by whether the library has their rules. */
export const STATE_OPTIONS = Object.entries(US_STATES)
  .map(([code, name]) => ({ code, name, supported: isSupportedState(code) }))
  .sort((a, b) => a.name.localeCompare(b.name))

/** One row of the site list: enough to show where each site stands, without resolving a library. */
export function siteSummary(facility: Record<string, unknown>, profileRow: Record<string, unknown> | null) {
  const profile = parseSiteProfile(profileRow)
  const jurisdiction = resolveJurisdiction(facility.state as string | null)
  const generatorCategory: RcraGeneratorCategory | null =
    parseFacilityProfile(facility.settings as Record<string, unknown> | null).generator_category
  return {
    id:                 facility.id as string,
    name:               facility.name as string,
    is_primary:         facility.is_primary === true,
    state:              jurisdiction.state,
    state_name:         stateName(jurisdiction.state),
    jurisdiction:       { chain: jurisdiction.chain, status: jurisdiction.status },
    notice:             fallbackNotice(jurisdiction),
    profile_saved:      profileRow !== null,
    confirmed_at:       profile.confirmedAt,
    generator_category: generatorCategory,
    scopes:             programsInScope(profile, generatorCategory),
  }
}

/** The full site view: the summary plus the profile, the library's pack status and the dropdown. */
export function siteDetail(site: SiteContext) {
  const generatorCategory = site.applicability.generatorCategory
  return {
    facility:           site.facility,
    state_name:         stateName(site.facility.state),
    jurisdiction:       { chain: site.jurisdiction.chain, state: site.jurisdiction.state, status: site.jurisdiction.status },
    notice:             fallbackNotice(site.jurisdiction),
    profile:            { ...toProfileRow(site.profile), confirmed_at: site.profile.confirmedAt },
    profile_saved:      site.profileRow !== null,
    generator_category: generatorCategory,
    scopes:             programsInScope(site.profile, generatorCategory),
    packs:              site.library.packs.map(p => ({ jurisdiction: p.jurisdiction, version: p.version, status: p.status, last_verified: p.lastVerified })),
    states:             STATE_OPTIONS,
  }
}
