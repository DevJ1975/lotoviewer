export const TOOLBOX_TALK_DAYS_AHEAD = 14
export const TOOLBOX_TALK_ARCHIVE_DAYS = 365

export const TOOLBOX_TALK_INDUSTRIES = ['general', 'construction'] as const
export type ToolboxTalkIndustry = typeof TOOLBOX_TALK_INDUSTRIES[number]

export const TOOLBOX_TALK_INDUSTRY_OPTIONS: ReadonlyArray<{
  value: ToolboxTalkIndustry
  label: string
  description: string
}> = [
  {
    value: 'general',
    label: 'General Industry',
    description: 'Daily OSHA 1910-style workplace safety talks for manufacturing, warehousing, maintenance, food, and office-support teams.',
  },
  {
    value: 'construction',
    label: 'Construction',
    description: 'Daily OSHA 1926-style jobsite talks for crews, foremen, trades, site logistics, weather, equipment, and changing field conditions.',
  },
]

const VALID_INDUSTRIES: ReadonlySet<string> = new Set(TOOLBOX_TALK_INDUSTRIES)

export function normalizeToolboxTalkIndustry(value: unknown): ToolboxTalkIndustry {
  return typeof value === 'string' && VALID_INDUSTRIES.has(value)
    ? value as ToolboxTalkIndustry
    : 'general'
}

export function isToolboxTalkIndustry(value: unknown): value is ToolboxTalkIndustry {
  return typeof value === 'string' && VALID_INDUSTRIES.has(value)
}

export function toolboxTalkIndustryPrompt(industry: ToolboxTalkIndustry): string {
  if (industry === 'construction') {
    return `Construction pack guidance:
- Write for an active construction jobsite: foremen, subcontractors, apprentices, operators, laborers, deliveries, visitors, and changing work fronts.
- Use OSHA 1926 construction hazards as the mental model: falls, ladders, scaffolds, trenching, struck-by, caught-between, cranes, silica, temporary power, hot work, traffic control, weather, and housekeeping.
- Make the scenario feel like a real morning huddle before work starts. Name the trade, the task, the changing condition, and the decision point.
- Ask the crew to point at site-specific controls: exclusion zones, competent person, trench access, tie-off point, spotter, barricade, extinguisher, eyewash, lift plan, or SDS station.
- Keep it practical for mixed crews. Avoid office/manufacturing-only language unless the topic truly applies.`
  }

  return `General Industry pack guidance:
- Write for a broad workplace: manufacturing, warehouse, maintenance, food processing, sanitation, laboratory, office-support, loading dock, and facilities crews.
- Use OSHA 1910 general-industry hazards as the mental model: walking-working surfaces, PPE, HazCom, lockout, machine guarding, powered industrial trucks, ergonomics, electrical, fire prevention, emergency action, and materials handling.
- Make the scenario feel like a real pre-shift huddle in a plant, shop, warehouse, lab, or service area.
- Ask the crew to point at site-specific controls: SDS station, eyewash, spill kit, guard, lockout point, forklift lane, extinguisher, emergency exit, first-aid kit, or reporting path.
- Keep it useful for tenants that do not have construction jobsites.`
}
