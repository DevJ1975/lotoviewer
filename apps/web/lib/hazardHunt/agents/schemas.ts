// Structured-output contracts for the two Hazard Hunt agents: the Certified
// Safety Professional (CSP) write-up and the Data Scientist (DS) trends analysis.
//
// The JSON schemas feed Anthropic's structured-output path
// (output_config.format.json_schema). Per that path's rules, EVERY object sets
// additionalProperties:false and lists all its properties as required — the same
// proven pattern the LOTO audit schemas use.

import type Anthropic from '@anthropic-ai/sdk'
import { HAZARD_HUNT_HAZARD_CATEGORIES } from '@soteria/core/hazardHunt'

// Citation severity — same vocabulary the LOTO audit agents emit, so the
// write-up renders with the existing severity tokens.
export type WriteUpSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical'

export interface Citation {
  code:     string
  text:     string
  severity: WriteUpSeverity
}

export type ControlHierarchyLevel =
  | 'elimination' | 'substitution' | 'engineering' | 'administrative' | 'ppe'

export interface CspRecommendation {
  item:            string
  hierarchy_level: ControlHierarchyLevel
  finding_ref:     string
}

export interface CspWriteUpResult {
  summary:         string
  citations:       Citation[]
  recommendations: CspRecommendation[]
}

export const CSP_WRITEUP_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Executive summary of the hazard hunt: scope, overall result, and the most consequential findings.' },
    citations: {
      type: 'array',
      description: 'Regulatory citations grounding each material finding.',
      items: {
        type: 'object',
        properties: {
          code:     { type: 'string', description: 'Citation, e.g. "29 CFR 1910.22" or "Cal/OSHA T8 §3273".' },
          text:     { type: 'string', description: 'What the citation requires and how the finding relates.' },
          severity: { type: 'string', enum: ['info', 'low', 'medium', 'high', 'critical'] },
        },
        required: ['code', 'text', 'severity'],
        additionalProperties: false,
      },
    },
    recommendations: {
      type: 'array',
      description: 'Corrective actions ranked by the hierarchy of controls; one per open finding at minimum.',
      items: {
        type: 'object',
        properties: {
          item:            { type: 'string', description: 'The concrete corrective action.' },
          hierarchy_level: { type: 'string', enum: ['elimination', 'substitution', 'engineering', 'administrative', 'ppe'] },
          finding_ref:     { type: 'string', description: 'The finding number or title this action addresses.' },
        },
        required: ['item', 'hierarchy_level', 'finding_ref'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'citations', 'recommendations'],
  additionalProperties: false,
} as const

// ── Data Scientist: hazard-finding trends ────────────────────────────────────

export type TrendDirection = 'rising' | 'flat' | 'falling'

export interface DsTopCategory {
  category: typeof HAZARD_HUNT_HAZARD_CATEGORIES[number]
  count:    number
  trend:    TrendDirection
}

export interface DsTrendsResult {
  top_categories: DsTopCategory[]
  narrative:      string
  watch_items:    string[]
}

export const DS_TRENDS_SCHEMA = {
  type: 'object',
  properties: {
    top_categories: {
      type: 'array',
      description: 'The hazard categories driving findings, with their direction over the window.',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: [...HAZARD_HUNT_HAZARD_CATEGORIES] },
          count:    { type: 'integer', description: 'Finding count for this category in the window.' },
          trend:    { type: 'string', enum: ['rising', 'flat', 'falling'] },
        },
        required: ['category', 'count', 'trend'],
        additionalProperties: false,
      },
    },
    narrative:   { type: 'string', description: 'A short trend narrative over the deterministic metrics provided.' },
    watch_items: { type: 'array', items: { type: 'string' }, description: 'Emerging hazards or categories to watch next cycle.' },
  },
  required: ['top_categories', 'narrative', 'watch_items'],
  additionalProperties: false,
} as const

// Common return shape for an agent call: parsed result + token usage + model id.
export interface AgentOutput<T> {
  result: T
  usage:  Anthropic.Usage | null
  model:  string
}
