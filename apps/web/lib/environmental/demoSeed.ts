import type { RcraGeneratorCategory } from '@soteria/core/hazardousWaste'
import { EMPTY_SITE_PROFILE, type SiteProfile } from '@soteria/core/environmental/siteProfile'
import type { PermitProgram } from '@soteria/core/environmental/permits'
import type { ApplyResult } from './applyLibrary'
import type { RunItem } from './checklistRuns'

// The demo story for the environmental suite: three sites in three situations,
// seeded through the real code paths (the same apply-library and checklist
// submit a customer uses) so what a prospect sees is what the product does, and
// the content can never drift from the library.
//
//   Anaheim, CA       the busy one: state rules layered on federal, a permit about
//                     to need renewing, an overdue report, a failed outfall
//                     inspection with a finding.
//   Houston, TX       a clean-ish site on Texas rules, one inspection in progress.
//   Portland, OR      a state the library does not cover yet: shows the federal
//                     baseline fallback and says so.
//
// Names, permit numbers and agencies are placeholders marked DEMO: the demo
// must never be mistaken for a real permit.

export interface DemoPermit {
  key: string
  program: PermitProgram
  permitType: string
  permitNumber: string
  agency: string
  jurisdiction: string
  /** Days from today (negative = in the past). */
  effectiveInDays: number
  expiresInDays: number | null
  renewalLeadDays: number
}

export interface DemoOutfall {
  code: string
  name: string
  receivingWater: string
  sampling: boolean
  /** Code of the outfall this one is substantially identical to. */
  sameAs?: string
  permitKey?: string
  latitude: number
  longitude: number
}

export interface DemoEvaluation {
  libraryKey: string
  applicability: 'applicable' | 'not_applicable' | 'under_review'
  status: 'not_evaluated' | 'compliant' | 'attention' | 'non_compliant'
  note: string
  /** Days since the requirement was last reviewed; omit for never. */
  reviewedDaysAgo?: number
}

export interface DemoRun {
  libraryKey: string
  /** Outfall code for outfall checklists; the site itself otherwise. */
  outfallCode?: string
  outcome: 'pass' | 'fail' | 'in_progress'
  daysAgo: number
  /** The calendar deadline (by library key) this run satisfies. */
  deadlineKey?: string
}

export interface DemoDeadlineTweak {
  libraryKey: string
  /** Days from today the deadline falls due (negative = overdue). */
  dueInDays: number
  /** Index into the account's members; omitted leaves the owner alone. */
  ownerIndex?: number
}

export interface DemoSite {
  code: string
  name: string
  city: string
  state: string
  generatorCategory: RcraGeneratorCategory
  profile: Partial<SiteProfile>
  permits: DemoPermit[]
  outfalls: DemoOutfall[]
  evaluations: DemoEvaluation[]
  runs: DemoRun[]
  deadlines: DemoDeadlineTweak[]
}

export const DEMO_SITES: readonly DemoSite[] = [
  {
    code: 'ENV-CA', name: 'Anaheim Plant (DEMO)', city: 'Anaheim', state: 'CA', generatorCategory: 'sqg',
    profile: {
      stormwaterCoverage: 'general_permit', stormwaterGeneralPermit: 'ca_igp', airPermitType: 'minor_permit',
      wastewaterDischarge: 'potw_indirect', pretreatmentStatus: 'siu', potwName: 'DEMO County Sanitation District',
      localAgencies: { airDistrict: 'South Coast AQMD', cupa: 'DEMO County Environmental Health', regionalBoard: 'Santa Ana Regional Water Quality Control Board', potw: null },
      spccApplicable: true, tier2Applicable: true, sicCodes: ['2096'], naicsCodes: ['311919'],
    },
    permits: [
      { key: 'igp', program: 'stormwater', permitType: 'California Industrial General Permit', permitNumber: 'DEMO WDID 8 30I000001', agency: 'State Water Resources Control Board', jurisdiction: 'CA', effectiveInDays: -700, expiresInDays: 1200, renewalLeadDays: 180 },
      { key: 'pto', program: 'air', permitType: 'Air district permit to operate', permitNumber: 'DEMO-PTO-0001', agency: 'South Coast AQMD', jurisdiction: 'CA', effectiveInDays: -310, expiresInDays: 55, renewalLeadDays: 90 },
      { key: 'iwdp', program: 'wastewater', permitType: 'Industrial wastewater discharge permit', permitNumber: 'DEMO-IWDP-0001', agency: 'DEMO County Sanitation District', jurisdiction: 'CA', effectiveInDays: -200, expiresInDays: 400, renewalLeadDays: 120 },
    ],
    outfalls: [
      { code: '001', name: 'North channel discharge', receivingWater: 'DEMO Creek', sampling: true, permitKey: 'igp', latitude: 33.8353, longitude: -117.9145 },
      { code: '002', name: 'South channel discharge', receivingWater: 'DEMO Creek', sampling: true, permitKey: 'igp', latitude: 33.8341, longitude: -117.9138 },
      { code: '003', name: 'East dock drain', receivingWater: 'DEMO Creek', sampling: false, sameAs: '001', permitKey: 'igp', latitude: 33.8349, longitude: -117.9121 },
    ],
    evaluations: [
      { libraryKey: 'lr-ca-igp', applicability: 'applicable', status: 'attention', reviewedDaysAgo: 400, note: 'The annual report was filed nine days late last year. Reminder now set two weeks ahead.' },
      { libraryKey: 'lr-ca-era', applicability: 'applicable', status: 'non_compliant', reviewedDaysAgo: 30, note: 'A Level 1 exceedance response for oil and grease at outfall 002 is open and the evaluation is overdue.' },
      { libraryKey: 'lr-ca-hmbp', applicability: 'applicable', status: 'compliant', reviewedDaysAgo: 60, note: 'Business plan recertified and submitted this year.' },
      { libraryKey: 'lr-ca-hw-control', applicability: 'applicable', status: 'compliant', reviewedDaysAgo: 45, note: 'Generator status confirmed; manifests reconciled.' },
      { libraryKey: 'lr-ca-air-district', applicability: 'applicable', status: 'attention', reviewedDaysAgo: 20, note: 'The permit to operate renews in under two months and the fee invoice has not arrived.' },
      { libraryKey: 'lr-fed-spcc', applicability: 'applicable', status: 'compliant', reviewedDaysAgo: 90, note: 'Plan current; tank inspections up to date.' },
      { libraryKey: 'lr-fed-epcra-tier2', applicability: 'applicable', status: 'compliant', reviewedDaysAgo: 110, note: 'Inventory filed this year.' },
      { libraryKey: 'lr-fed-neshap-engines', applicability: 'not_applicable', status: 'not_evaluated', reviewedDaysAgo: 120, note: 'There are no stationary emergency engines at this site.' },
      { libraryKey: 'lr-fed-pretreatment', applicability: 'under_review', status: 'not_evaluated', note: 'Confirming significant user status with the sanitation district.' },
    ],
    runs: [
      { libraryKey: 'sw-ca-mvo', outcome: 'pass', daysAgo: 28, deadlineKey: 'sw-ca-mvo' },
      { libraryKey: 'of-inspection', outfallCode: '002', outcome: 'fail', daysAgo: 14 },
    ],
    deadlines: [
      { libraryKey: 'sw-ca-qse', dueInDays: -12, ownerIndex: 0 },
      { libraryKey: 'sw-ca-annual-report', dueInDays: 9, ownerIndex: 1 },
      { libraryKey: 'sw-ca-ace', dueInDays: 70, ownerIndex: 0 },
    ],
  },
  {
    code: 'ENV-TX', name: 'Houston Distribution Center (DEMO)', city: 'Houston', state: 'TX', generatorCategory: 'lqg',
    profile: {
      stormwaterCoverage: 'general_permit', stormwaterGeneralPermit: 'tx_txr05', airPermitType: 'registration_or_pbr',
      wastewaterDischarge: 'none', spccApplicable: true, tier2Applicable: true, sicCodes: ['4225'], naicsCodes: ['493110'],
    },
    permits: [
      { key: 'msgp', program: 'stormwater', permitType: 'TPDES Multi-Sector General Permit authorization', permitNumber: 'DEMO TXR05-0001', agency: 'Texas Commission on Environmental Quality', jurisdiction: 'TX', effectiveInDays: -500, expiresInDays: 900, renewalLeadDays: 180 },
      { key: 'pbr', program: 'air', permitType: 'Permit by rule registration', permitNumber: 'DEMO-PBR-0001', agency: 'Texas Commission on Environmental Quality', jurisdiction: 'TX', effectiveInDays: -400, expiresInDays: null, renewalLeadDays: 180 },
    ],
    outfalls: [
      { code: '001', name: 'Yard drainage', receivingWater: 'DEMO Bayou', sampling: true, permitKey: 'msgp', latitude: 29.7604, longitude: -95.3698 },
      { code: '002', name: 'Dock apron drain', receivingWater: 'DEMO Bayou', sampling: true, permitKey: 'msgp', latitude: 29.7611, longitude: -95.3702 },
    ],
    evaluations: [
      { libraryKey: 'lr-tx-msgp', applicability: 'applicable', status: 'compliant', reviewedDaysAgo: 50, note: 'Authorization current; SWP3 reviewed this quarter.' },
      { libraryKey: 'lr-tx-30tac335', applicability: 'applicable', status: 'attention', reviewedDaysAgo: 80, note: 'Notice of registration details need confirming after the last address change.' },
      { libraryKey: 'lr-tx-pbr', applicability: 'applicable', status: 'compliant', reviewedDaysAgo: 100, note: 'Registration on file; records kept on site.' },
      { libraryKey: 'lr-fed-spcc', applicability: 'applicable', status: 'compliant', reviewedDaysAgo: 120, note: 'Plan current.' },
    ],
    runs: [
      { libraryKey: 'sw-quarterly-visual', outfallCode: '001', outcome: 'pass', daysAgo: 40, deadlineKey: 'sw-fed-quarterly-visual' },
      { libraryKey: 'sw-routine-inspection', outcome: 'in_progress', daysAgo: 0 },
    ],
    deadlines: [{ libraryKey: 'sw-fed-swppp-review', dueInDays: 20, ownerIndex: 1 }],
  },
  {
    code: 'ENV-OR', name: 'Portland Warehouse (DEMO)', city: 'Portland', state: 'OR', generatorCategory: 'vsqg',
    profile: { stormwaterCoverage: 'general_permit', stormwaterGeneralPermit: 'epa_msgp', airPermitType: 'not_required', wastewaterDischarge: 'none', spccApplicable: false, tier2Applicable: false },
    permits: [],
    outfalls: [],
    evaluations: [
      { libraryKey: 'lr-fed-msgp', applicability: 'under_review', status: 'not_evaluated', note: 'Oregon issues its own stormwater permit; confirm which one covers this site.' },
    ],
    runs: [],
    deadlines: [{ libraryKey: 'sw-fed-annual-report', dueInDays: -5, ownerIndex: 0 }],
  },
]

// ── answers ─────────────────────────────────────────────────────────────────

export interface DemoAnswer {
  itemId: string
  result: 'pass' | 'fail' | 'na' | null
  value: string | number | null
  evidenceId: string | null
  note: string | null
}

/** Stand-in for a photo: demo data has no files, so required photos point at a placeholder in the tenant's folder. */
export const demoPlaceholderPath = (tenantId: string) => `${tenantId}/demo/placeholder-photo.jpg`

const midpoint = (item: Pick<RunItem, 'config'>): number => {
  const { min, max } = item.config as { min?: number; max?: number }
  if (typeof min === 'number' && typeof max === 'number') return (min + max) / 2
  if (typeof max === 'number') return max / 2
  if (typeof min === 'number') return min + 1
  return 1
}

/**
 * Plausible answers for a run. A 'fail' fails exactly one pass/fail question (a
 * critical one if there is one), with a note and a photo, so the demo shows one
 * finding with real context rather than a checklist full of red.
 */
export function demoAnswers(items: readonly RunItem[], outcome: 'pass' | 'fail', tenantId: string): DemoAnswer[] {
  const failing = outcome === 'fail'
    ? items.find(i => i.item_type === 'pass_fail_na' && i.fail_creates_action && i.config.critical === true)
      ?? items.find(i => i.item_type === 'pass_fail_na' && i.fail_creates_action)
    : undefined
  const answers: DemoAnswer[] = []
  for (const item of items) {
    const blank = { itemId: item.id, result: null, value: null, evidenceId: null, note: null } as DemoAnswer
    if (item.item_type === 'pass_fail_na') {
      answers.push(item.id === failing?.id
        ? { ...blank, result: 'fail', note: 'Visible oil sheen on the surface near the weir; absorbent boom placed and source being traced.', evidenceId: demoPlaceholderPath(tenantId) }
        : { ...blank, result: 'pass' })
    } else if (item.item_type === 'numeric') {
      answers.push({ ...blank, value: midpoint(item) })
    } else if (item.item_type === 'text') {
      if (item.required) answers.push({ ...blank, value: 'No concerns observed.' })
    } else if (item.item_type === 'photo') {
      if (item.required) answers.push({ ...blank, evidenceId: demoPlaceholderPath(tenantId) })
    } else if (item.item_type === 'signature') {
      answers.push({ ...blank, value: 'Demo Inspector' })
    } else if (item.required) {
      answers.push({ ...blank, value: 'Reviewed' })
    }
  }
  return answers
}

// ── orchestration ───────────────────────────────────────────────────────────

/** Everything the seed does to the database, behind an interface so its order and idempotency can be tested. */
export interface DemoStore {
  /** Up to three people with a login, used as owners and inspectors. Empty if the account has none. */
  memberIds(): Promise<string[]>
  ensureSite(site: Pick<DemoSite, 'code' | 'name' | 'city' | 'state' | 'generatorCategory'>): Promise<string>
  saveProfile(facilityId: string, profile: Partial<SiteProfile>, confirmedBy: string): Promise<void>
  applyLibrary(facilityId: string, actorUserId: string): Promise<ApplyResult>
  /** Create the permit if the site has none with this number; return its id either way. */
  ensurePermit(facilityId: string, permit: DemoPermit, dates: { effective: string; expires: string | null }, actorUserId: string): Promise<string>
  ensureOutfall(facilityId: string, outfall: DemoOutfall, links: { permitId: string | null; sameAsId: string | null }, actorUserId: string): Promise<string>
  evaluateLegal(facilityId: string, evaluation: DemoEvaluation, when: { evaluatedAt: string; reviewedAt: string | null; nextReviewDue: string | null }, actorUserId: string): Promise<boolean>
  setDeadline(facilityId: string, libraryKey: string, change: { dueOn: string; ownerUserId: string | null }): Promise<boolean>
  ensureRun(facilityId: string, run: DemoRun, actorUserId: string, when: Date): Promise<'created' | 'exists' | 'skipped'>
}

const addDays = (now: Date, days: number): Date => new Date(now.getTime() + days * 86_400_000)
const ymd = (d: Date) => d.toISOString().slice(0, 10)

export interface DemoSeedSummary {
  sites: number; permits: number; outfalls: number; evaluations: number; deadlines: number; runs: number; libraryItems: number
}

export async function seedEnvironmentalDemo(store: DemoStore, now: Date, sites: readonly DemoSite[] = DEMO_SITES): Promise<DemoSeedSummary> {
  const members = await store.memberIds()
  if (members.length === 0) throw new Error('The demo account has no members to own the demo records. Add a member and run it again.')
  const actor = members[0]!
  const summary: DemoSeedSummary = { sites: 0, permits: 0, outfalls: 0, evaluations: 0, deadlines: 0, runs: 0, libraryItems: 0 }

  for (const site of sites) {
    const facilityId = await store.ensureSite(site)
    summary.sites += 1
    await store.saveProfile(facilityId, { ...EMPTY_SITE_PROFILE, ...site.profile }, actor)

    const applied = await store.applyLibrary(facilityId, actor)
    summary.libraryItems += applied.legal.created + applied.templates.created + applied.obligations.created

    const permitIds = new Map<string, string>()
    for (const permit of site.permits) {
      permitIds.set(permit.key, await store.ensurePermit(facilityId, permit, {
        effective: ymd(addDays(now, permit.effectiveInDays)),
        expires: permit.expiresInDays === null ? null : ymd(addDays(now, permit.expiresInDays)),
      }, actor))
      summary.permits += 1
    }

    // An outfall that points at another is created after it.
    const outfallIds = new Map<string, string>()
    for (const outfall of [...site.outfalls].sort((a, b) => Number(!!a.sameAs) - Number(!!b.sameAs))) {
      outfallIds.set(outfall.code, await store.ensureOutfall(facilityId, outfall, {
        permitId: outfall.permitKey ? permitIds.get(outfall.permitKey) ?? null : null,
        sameAsId: outfall.sameAs ? outfallIds.get(outfall.sameAs) ?? null : null,
      }, actor))
      summary.outfalls += 1
    }

    for (const evaluation of site.evaluations) {
      const reviewed = evaluation.reviewedDaysAgo === undefined ? null : addDays(now, -evaluation.reviewedDaysAgo)
      const applied = await store.evaluateLegal(facilityId, evaluation, {
        evaluatedAt: now.toISOString(),
        reviewedAt: reviewed ? reviewed.toISOString() : null,
        // Entries are reviewed yearly: a review from 400 days ago is overdue, which the demo wants to show.
        nextReviewDue: reviewed ? ymd(addDays(reviewed, 365)) : null,
      }, actor)
      if (applied) summary.evaluations += 1
    }

    // Runs first: a completed run moves the deadline it satisfies, and the deadlines below are about other ones.
    for (const run of site.runs) {
      const result = await store.ensureRun(facilityId, run, actor, addDays(now, -run.daysAgo))
      if (result === 'created') summary.runs += 1
    }

    for (const tweak of site.deadlines) {
      const moved = await store.setDeadline(facilityId, tweak.libraryKey, {
        dueOn: ymd(addDays(now, tweak.dueInDays)),
        ownerUserId: tweak.ownerIndex === undefined ? null : members[Math.min(tweak.ownerIndex, members.length - 1)] ?? null,
      })
      if (moved) summary.deadlines += 1
    }
  }
  return summary
}

export function describeSummary(s: DemoSeedSummary): string {
  return `environmental demo: ${s.sites} sites, ${s.permits} permits, ${s.outfalls} outfalls, ${s.evaluations} requirements evaluated, ${s.deadlines} deadlines set, ${s.runs} checklist runs`
}
