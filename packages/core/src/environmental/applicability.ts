// Does a piece of library content apply to this site?

import type { RcraGeneratorCategory } from '../hazardousWaste'
import type { Applicability } from './content'
import type { SiteProfile } from './siteProfile'

export interface ApplicabilityContext {
  profile:           SiteProfile
  /** From the hazardous waste module; null when it has not been set. */
  generatorCategory: RcraGeneratorCategory | null
}

/**
 * True when every condition present in `rule` matches the site. No rule means
 * "applies everywhere". An axis the site has not evaluated matches nothing: the
 * library does not guess that an unevaluated site is subject to a program (the
 * UI asks the person to evaluate it instead).
 */
export function applies(rule: Applicability | undefined, context: ApplicabilityContext): boolean {
  if (!rule) return true
  const { profile, generatorCategory } = context

  if (rule.stormwaterCoverage && !rule.stormwaterCoverage.includes(profile.stormwaterCoverage)) return false
  if (rule.stormwaterPermit) {
    if (profile.stormwaterGeneralPermit === null || !rule.stormwaterPermit.includes(profile.stormwaterGeneralPermit)) return false
  }
  if (rule.airPermitType && !rule.airPermitType.includes(profile.airPermitType)) return false
  if (rule.wastewaterDischarge && !rule.wastewaterDischarge.includes(profile.wastewaterDischarge)) return false
  if (rule.pretreatment && !rule.pretreatment.includes(profile.pretreatmentStatus)) return false
  if (rule.generatorCategory) {
    if (generatorCategory === null || !rule.generatorCategory.includes(generatorCategory)) return false
  }
  if (rule.spcc !== undefined && profile.spccApplicable !== rule.spcc) return false
  if (rule.tier2 !== undefined && profile.tier2Applicable !== rule.tier2) return false
  return true
}

/** Keep only the items whose rule matches. */
export function applicableFor<T extends { appliesWhen?: Applicability }>(
  items: readonly T[], context: ApplicabilityContext,
): T[] {
  return items.filter(item => applies(item.appliesWhen, context))
}
