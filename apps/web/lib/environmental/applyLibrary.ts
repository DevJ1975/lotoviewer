import { applies } from '@soteria/core/environmental/applicability'
import { buildTemplateRows, type TemplateRows } from '@soteria/core/environmental/checklists'
import { planLibraryObligations, type LibraryObligationPlan, type PlannedObligation } from '@soteria/core/environmental/calendarPlan'
import type { ResolvedLibrary } from '@soteria/core/environmental/content'
import { planLegalEntries, type LegalEntryPlan, type LegalPlan } from '@soteria/core/environmental/legalRegister'
import type { EnvProgram } from '@soteria/core/environmental/siteProfile'
import type { SiteContext } from './siteContext'

// Apply the jurisdiction library to one site: the legal register entries, the
// checklist templates and the calendar deadlines that site should have.
//
// Two phases, so the person sees what will happen before it does:
//   planApply     reads what the site already has and decides (no writes).
//   executeApply  writes it, in dependency order: templates and legal entries
//                 first, because the deadlines link to both.
//
// Idempotent by construction. Anything the site already has is skipped, never
// rewritten (a person may have changed an owner or a date), and the writes
// tolerate a concurrent apply creating the same row. A failure part-way leaves
// a consistent partial result that running it again completes.

/** What the site already has, read before planning. */
export interface ApplyState {
  /** Legal register entries at this site: library key -> row id. */
  legalIds:       ReadonlyMap<string, string>
  /** Library calendar deadlines at this site, by system key. */
  obligationKeys: ReadonlySet<string>
  /** Template instances in the tenant: `${libraryKey}|${instanceKey}` -> template id. */
  templateIds:    ReadonlyMap<string, string>
}

export interface TemplatePlan {
  libraryKey:  string
  name:        string
  program:     EnvProgram
  itemCount:   number
  instanceKey: string
  rows:        TemplateRows
}

export interface ApplyPlan {
  libraryVersion: string
  lastVerified:   string | null
  legal:          LegalPlan
  templates: {
    toCreate:      TemplatePlan[]
    existing:      string[]
    notApplicable: string[]
    /** Library template id -> the instance key this site uses, for linking deadlines. */
    instanceKeys:  Record<string, string>
  }
  obligations: LibraryObligationPlan
}

export const templateStateKey = (libraryKey: string, instanceKey: string) => `${libraryKey}|${instanceKey}`

/** "federal@0.1.0,CA@0.1.0": which pack versions produced the rows. Fits the 40-character column. */
export function libraryVersionLabel(library: ResolvedLibrary): string {
  return library.packs.map(pack => `${pack.jurisdiction}@${pack.version}`).join(',').slice(0, 40)
}

/** The oldest verification date among the packs, or null if any has never been verified. */
export function oldestVerification(library: ResolvedLibrary): string | null {
  const dates = library.packs.map(pack => pack.lastVerified)
  if (dates.some(date => date === null)) return null
  return (dates as string[]).sort()[0] ?? null
}

export function planApply(site: SiteContext, state: ApplyState, now: Date): ApplyPlan {
  const { library, applicability, jurisdiction } = site
  const version = { libraryVersion: libraryVersionLabel(library), lastVerified: oldestVerification(library) }

  const templates: ApplyPlan['templates'] = { toCreate: [], existing: [], notApplicable: [], instanceKeys: {} }
  for (const template of library.checklists) {
    if (!applies(template.appliesWhen, applicability)) { templates.notApplicable.push(template.id); continue }
    const rows = buildTemplateRows(template, applicability, jurisdiction.chain, version)
    if (rows.items.length === 0) { templates.notApplicable.push(template.id); continue }
    const instanceKey = rows.companion.jurisdiction_key
    templates.instanceKeys[template.id] = instanceKey
    if (state.templateIds.has(templateStateKey(template.id, instanceKey))) { templates.existing.push(template.id); continue }
    templates.toCreate.push({
      libraryKey: template.id, name: template.name, program: template.program,
      itemCount: rows.items.length, instanceKey, rows,
    })
  }

  return {
    ...version,
    legal:       planLegalEntries(library, applicability, site.facility.id, new Set(state.legalIds.keys())),
    templates,
    obligations: planLibraryObligations(library, applicability, site.facility.id, state.obligationKeys, now),
  }
}

/** The plan without the row payloads: what the confirmation dialog shows. */
export function summarizePlan(plan: ApplyPlan) {
  return {
    libraryVersion: plan.libraryVersion,
    lastVerified:   plan.lastVerified,
    legal: {
      create: plan.legal.toCreate.map(e => ({ key: e.library_key, title: e.title, citation: e.citation, program: e.program, verify: e.verify })),
      existing: plan.legal.existing.length,
      notApplicable: plan.legal.notApplicable.length,
    },
    templates: {
      create: plan.templates.toCreate.map(t => ({ key: t.libraryKey, name: t.name, program: t.program, items: t.itemCount })),
      existing: plan.templates.existing.length,
      notApplicable: plan.templates.notApplicable.length,
    },
    obligations: {
      create: plan.obligations.toCreate.map(o => ({
        key: o.library_key, title: o.title, program: o.program, cadence: o.cadence, nextDueAt: o.next_due_at, regulatoryRef: o.regulatory_ref,
      })),
      existing: plan.obligations.existing.length,
      notApplicable: plan.obligations.notApplicable.length,
    },
  }
}

/** The writes, behind an interface so the ordering and idempotency are testable without a database. */
export interface LibraryStore {
  createTemplate(rows: TemplateRows): Promise<{ id: string; created: boolean }>
  createLegal(entry: LegalEntryPlan, libraryVersion: string): Promise<{ id: string; created: boolean }>
  createObligation(
    obligation: PlannedObligation, links: { legalId: string | null; templateId: string | null },
  ): Promise<{ created: boolean }>
}

export interface ApplyResult {
  legal:       { created: number; alreadyThere: number }
  templates:   { created: number; alreadyThere: number }
  obligations: { created: number; alreadyThere: number }
}

export async function executeApply(store: LibraryStore, plan: ApplyPlan, state: ApplyState): Promise<ApplyResult> {
  const result: ApplyResult = {
    legal:       { created: 0, alreadyThere: 0 },
    templates:   { created: 0, alreadyThere: 0 },
    obligations: { created: 0, alreadyThere: 0 },
  }
  const templateIds = new Map(state.templateIds)
  const legalIds = new Map(state.legalIds)
  const tally = (bucket: { created: number; alreadyThere: number }, created: boolean) => {
    if (created) bucket.created += 1
    else bucket.alreadyThere += 1
  }

  for (const template of plan.templates.toCreate) {
    const { id, created } = await store.createTemplate(template.rows)
    templateIds.set(templateStateKey(template.libraryKey, template.instanceKey), id)
    tally(result.templates, created)
  }
  for (const entry of plan.legal.toCreate) {
    const { id, created } = await store.createLegal(entry, plan.libraryVersion)
    legalIds.set(entry.library_key, id)
    tally(result.legal, created)
  }
  for (const obligation of plan.obligations.toCreate) {
    const instanceKey = obligation.checklist_library_key ? plan.templates.instanceKeys[obligation.checklist_library_key] : undefined
    const { created } = await store.createObligation(obligation, {
      legalId:    obligation.legal_library_key ? legalIds.get(obligation.legal_library_key) ?? null : null,
      templateId: obligation.checklist_library_key && instanceKey
        ? templateIds.get(templateStateKey(obligation.checklist_library_key, instanceKey)) ?? null
        : null,
    })
    tally(result.obligations, created)
  }
  return result
}
