// The shape of environmental compliance content: checklists, deadlines, legal
// requirements and how-to guides, authored as DATA in per-jurisdiction packs.
//
// Two rules shape every type here.
//
// 1. Regulatory facts are not ground truth in code. Every pack carries a
//    status ('draft' until a Certified Safety Professional signs it off), and
//    every item carries citations, with a `verify` note on anything specific
//    that has not been confirmed against current text. The product treats the
//    library as an editable starting point, never as legal advice.
// 2. A state is a delta, not a copy. A state pack adds, replaces, patches or
//    removes federal items by stable id (see Overlay), so a federal change
//    reaches every state without re-authoring and a new state is one file.

import type { InspectionItemType } from '../inspectionScoring'
import type { ObligationCadence } from '../complianceCalendar'
import type { RcraGeneratorCategory } from '../hazardousWaste'
import type { JurisdictionCode } from './jurisdiction'
import type {
  AirPermitType, EnvProgram, PretreatmentStatus, StormwaterCoverage, WastewaterDischarge,
} from './siteProfile'

export interface Citation {
  /** "40 CFR 262.15(a)(6)", "IGP Order 2014-0057-DWQ §XI.A.1". */
  ref:     string
  title?:  string
  url?:    string
  /**
   * Present = this specific has NOT been confirmed against current text. The
   * note says what to check ("2021 MSGP expired 2026-02-28; confirm which permit
   * is in effect"). It is shown to the reader and counted for the reviewer.
   */
  verify?: string
}

export type PackStatus = 'draft' | 'csp_approved'

export interface PackReviewer {
  name:        string
  credential:  string
  signedOffAt: string
}

export interface PackMeta {
  jurisdiction: JurisdictionCode
  version:      string
  /** When this pack was written (YYYY-MM-DD). */
  draftedOn:    string
  /** When a person last confirmed it against current regulatory text; null = never. */
  lastVerified: string | null
  status:       PackStatus
  reviewer:     PackReviewer | null
  notes?:       string
}

/**
 * When an item applies, declaratively (so it can be stored and shown, not just
 * run). Every key present must match; an array means "any of these".
 */
export interface Applicability {
  stormwaterCoverage?: StormwaterCoverage[]
  stormwaterPermit?:   string[]
  airPermitType?:      AirPermitType[]
  wastewaterDischarge?: WastewaterDischarge[]
  pretreatment?:       PretreatmentStatus[]
  generatorCategory?:  RcraGeneratorCategory[]
  spcc?:               boolean
  tier2?:              boolean
}

export interface ChecklistItemDef {
  id:                string
  section:           string
  prompt:            string
  itemType:          InspectionItemType
  weight:            number
  required:          boolean
  failCreatesAction: boolean
  /** A failure here is a finding someone must look at, not a data point. */
  critical:          boolean
  /** ISO 14001 clause this evidences. */
  clauseRef?:        '6.1.3' | '8.1' | '9.1.1' | '9.1.2'
  numeric?:          { min?: number; max?: number; unit: string }
  /** Why the question is asked and what a good answer looks like. */
  guidance?:         string
  citations:         Citation[]
  appliesWhen?:      Applicability
}

export type ChecklistSubjectType = 'facility' | 'outfall' | 'permit' | 'hw_area'

export interface ChecklistTemplateDef {
  id:          string
  program:     EnvProgram
  name:        string
  description: string
  subjectType: ChecklistSubjectType
  cadence:     ObligationCadence
  cadenceDays?: number
  items:       ChecklistItemDef[]
  citations:   Citation[]
  appliesWhen?: Applicability
}

/**
 * When an obligation falls due.
 *  annual     - a fixed month and day each year.
 *  period_end - the last day of the current month, quarter, half-year or year.
 *               Calendar-year periods: a half ends Jun 30 / Dec 31, which is
 *               also California's industrial stormwater reporting half-year.
 *  rolling    - one cadence from "now" (no fixed calendar anchor).
 */
export type DueAnchor =
  | { kind: 'annual'; month: number; day: number }
  | { kind: 'period_end'; period: 'month' | 'quarter' | 'half' | 'year' }
  | { kind: 'rolling' }

export interface ObligationDef {
  id:          string
  program:     EnvProgram
  title:       string
  description: string
  cadence:     ObligationCadence
  cadenceDays?: number
  anchor:      DueAnchor
  /** Days of warning before it is due. */
  leadDays:    number
  citations:   Citation[]
  appliesWhen?: Applicability
  /** A checklist that completes this obligation, by template id. */
  checklistTemplateId?: string
  /** The legal-register entry this obligation comes from, by id. */
  legalId?:    string
}

export interface LegalRequirementDef {
  id:                string
  program:           EnvProgram
  title:             string
  citation:          string
  authority:         string
  summary:           string
  applicabilityNote: string
  sourceUrl?:        string
  reviewFrequency:   'annual' | 'biennial'
  appliesWhen?:      Applicability
  verify?:           string
}

export interface GuideSection {
  id:         string
  title:      string
  paragraphs: string[]
  bullets?:   string[]
  citations?: Citation[]
}

export interface GuideDef {
  id:         string
  program:    EnvProgram | 'overview'
  title:      string
  /** Which screens show this guide in their how-to panel. */
  pageKeys:   string[]
  /** The short version: a few steps a person can follow without opening the wiki. */
  quickSteps: string[]
  sections:   GuideSection[]
}

/** A jurisdiction's changes to the layer below it, by stable id. */
export interface Overlay<T extends { id: string }> {
  add?:     T[]
  replace?: T[]
  patch?:   Array<{ id: string; fields: Partial<Omit<T, 'id'>> }>
  remove?:  Array<{ id: string; reason: string }>
}

export interface JurisdictionPack {
  meta:            PackMeta
  checklists?:     Overlay<ChecklistTemplateDef>
  /** Item-level changes, keyed by the template id they apply to. */
  checklistItems?: Record<string, Overlay<ChecklistItemDef>>
  obligations?:    Overlay<ObligationDef>
  legal?:          Overlay<LegalRequirementDef>
  guides?:         Overlay<GuideDef>
}

/** An item after resolution, with the layer that defined it. */
export type Resolved<T> = T & {
  /** The jurisdiction whose pack last defined this item. */
  source:     JurisdictionCode
  /** The jurisdiction whose item this one replaced, if any. */
  overrides?: JurisdictionCode
}

export type ResolvedChecklistTemplate =
  Resolved<Omit<ChecklistTemplateDef, 'items'> & { items: Resolved<ChecklistItemDef>[] }>

export interface ResolvedLibrary {
  chain:       JurisdictionCode[]
  packs:       PackMeta[]
  checklists:  ResolvedChecklistTemplate[]
  obligations: Resolved<ObligationDef>[]
  legal:       Resolved<LegalRequirementDef>[]
  guides:      Resolved<GuideDef>[]
}
