// EM-385 Compliance — types + small pure helpers shared across web and
// mobile. EM 385-1-1 is the U.S. Army Corps of Engineers (USACE) "Safety and
// Occupational Health Requirements Manual"; every USACE construction/operations
// contract must produce and maintain a stack of documents and records (the
// Accident Prevention Plan, Activity Hazard Analyses, site-specific written
// programs, forms, training/certifications, competent-person designations,
// inspections, permits, and exposure/medical records). This module tracks
// *which* of those a contract has, their status, ownership, and currency — it
// does not generate the documents themselves.
//
// Authoritative shapes live in the DB (migrations 225–229). The types here are
// the read-side contract used by API routes and UI code; keep them in sync with
// the schema in the same commit.

// ──────────────────────────────────────────────────────────────────────────
// Enums (text-CHECK columns — no Postgres CREATE TYPE, per repo convention)
// ──────────────────────────────────────────────────────────────────────────

// EM 385-1-1 editions the catalog is seeded against. 2024 is the current
// 37-chapter manual (effective 15 Mar 2024); 2014 is still referenced on some
// legacy contracts. A project selects the edition that governs it.
export const EM385_EDITIONS = ['2024', '2014'] as const
export type Em385Edition = typeof EM385_EDITIONS[number]

// The eight record families a contract must keep. Kept deliberately flat so a
// single register table (em385_register_items) can carry every kind — see the
// module plan. Adding a ninth family is a text-CHECK edit, not a type rebuild.
export const EM385_CATEGORIES = [
  'app_plan',           // Accident Prevention Plan parts + Activity Hazard Analyses
  'site_specific_plan', // Part 11 / Appendix 5 written programs (LOTO, fall protection, …)
  'form_record',        // ENG 3394, OSHA 300/300A, daily reports, meeting minutes
  'training_cert',      // SSHO/OSHA training, CPR, discipline-specific certifications
  'competent_person',   // Competent / Qualified Person designations per discipline
  'inspection',         // Equipment/crane inspections + instrument calibration records
  'permit',             // Confined space, hot work, excavation, energy control permits
  'exposure_medical',   // Exposure monitoring + medical surveillance (long retention)
] as const
export type Em385Category = typeof EM385_CATEGORIES[number]

export const EM385_CATEGORY_LABEL: Record<Em385Category, string> = {
  app_plan:           'APP & AHA',
  site_specific_plan: 'Site-Specific Plans',
  form_record:        'Forms & Records',
  training_cert:      'Training & Certification',
  competent_person:   'Competent / Qualified Persons',
  inspection:         'Inspections & Calibration',
  permit:             'Permits',
  exposure_medical:   'Exposure & Medical',
}

// Lifecycle of a single register item. `not_applicable` is a first-class state
// because EM 385-1-1 requires a documented justification whenever a required
// plan/record does not apply to a contract (see requiresJustification).
export const EM385_STATUSES = [
  'not_started', 'in_progress', 'submitted', 'accepted', 'expired', 'not_applicable',
] as const
export type Em385Status = typeof EM385_STATUSES[number]

export const EM385_STATUS_LABEL: Record<Em385Status, string> = {
  not_started:    'Not started',
  in_progress:    'In progress',
  submitted:      'Submitted',
  accepted:       'Accepted',
  expired:        'Expired',
  not_applicable: 'Not applicable',
}

export const EM385_PROJECT_STATUSES = ['active', 'closed', 'archived'] as const
export type Em385ProjectStatus = typeof EM385_PROJECT_STATUSES[number]

// ──────────────────────────────────────────────────────────────────────────
// Row shapes
// ──────────────────────────────────────────────────────────────────────────

// A row in the GLOBAL requirements catalog (migration 225/226). Not
// tenant-scoped — it is the authoritative "what EM-385 says you must keep,"
// tagged by edition. Read-only to tenants.
export interface Em385RequirementRow {
  id:                       string
  edition:                  Em385Edition
  category:                 Em385Category
  code:                     string                 // stable, unique within an edition (e.g. 'PLAN-LOTO')
  title:                    string
  description:              string | null
  citation:                 string | null          // manual reference, e.g. 'EM 385-1-1 (2024) App A Part 11'
  record_type:             string | null           // free-form grouping hint ('document','designation','recurring',…)
  default_required:         boolean                 // seeded into a new project's register by default
  retention_rule:           string | null           // human rule, e.g. '29 CFR 1910.1020'
  retention_years:          number | null           // drives computeRetainUntil; null = contract-defined
  renewal_interval_months:  number | null           // for certs/inspections that expire
  links_module:             string | null           // a FEATURES id for deep-linking to the system-of-record
  sort_order:               number
  created_at:               string
}

// A USACE contract. Records hang off this (not off a facility) because EM-385
// is fundamentally contract-scoped. facility_id is optional/shared: a contract
// may span facilities, so a NULL facility is visible in every facility view.
export interface Em385ProjectRow {
  id:               string
  tenant_id:        string
  facility_id:      string | null
  project_number:   string | null   // CTR-YYYY-NNNN, set by trigger
  contract_number:  string          // user-entered USACE contract number
  title:            string
  edition:          Em385Edition
  gda:              string | null   // Government Designated Authority / contracting officer
  prime_contractor: string | null
  location:         string | null
  start_date:       string | null
  end_date:         string | null
  status:           Em385ProjectStatus
  ssho_name:        string | null   // Site Safety and Health Officer
  created_at:       string
  updated_at:       string
  updated_by:       string | null
}

// One tracked requirement for one project. `requirement_id` is null for custom
// items an admin adds beyond the seeded catalog. `linked_record_id` +
// `linked_module` point at the host module that is the system-of-record (e.g. a
// confined-space permit), so EM-385 references evidence instead of duplicating it.
export interface Em385RegisterItemRow {
  id:                            string
  tenant_id:                     string
  project_id:                    string
  requirement_id:                string | null
  title:                         string
  category:                      Em385Category
  status:                        Em385Status
  not_applicable_justification:  string | null
  responsible_party:             string | null
  due_date:                      string | null
  submitted_at:                  string | null
  accepted_at:                   string | null
  accepted_by:                   string | null
  effective_date:                string | null
  expires_at:                    string | null
  version:                       string | null
  linked_record_id:              string | null
  linked_module:                 string | null
  notes:                         string | null
  created_at:                    string
  updated_at:                    string
  updated_by:                    string | null
}

// File metadata for an evidence document attached to a register item. The bytes
// live in the `loto-photos` bucket; the SHA-256 is an integrity stamp (mirrors
// loto_signed_pdf_artifacts) so a later download proving a different hash flags
// tampering.
export interface Em385DocumentFileRow {
  id:                string
  tenant_id:         string
  register_item_id:  string
  storage_path:      string
  mime_type:         string | null
  file_size_bytes:   number | null
  file_hash_sha256:  string | null
  version_label:     string | null
  uploaded_by:       string | null
  uploaded_at:       string
}

// ──────────────────────────────────────────────────────────────────────────
// Create-input shapes (the DB sets ids, numbers, timestamps, defaults)
// ──────────────────────────────────────────────────────────────────────────

export interface Em385ProjectCreateInput {
  contract_number:   string
  title:             string
  edition:           Em385Edition
  gda?:              string | null
  prime_contractor?: string | null
  location?:         string | null
  start_date?:       string | null
  end_date?:         string | null
  ssho_name?:        string | null
  facility_id?:      string | null
}

export interface Em385RegisterItemCreateInput {
  title:              string
  category:           Em385Category
  requirement_id?:    string | null
  responsible_party?: string | null
  due_date?:          string | null
  notes?:             string | null
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers (pure; DB CHECK constraints remain the authority)
// ──────────────────────────────────────────────────────────────────────────

import { daysUntilDue } from './complianceCalendar'

// EM 385-1-1 requires a written justification whenever a required plan/record
// is marked not applicable to the contract. The UI enforces this before save;
// the DB has the matching CHECK constraint.
export function requiresJustification(status: Em385Status): boolean {
  return status === 'not_applicable'
}

// A register item is overdue when its due date has passed and it is neither
// accepted nor formally excused (N/A). Items with no due date are never overdue.
export function isOverdue(
  item: Pick<Em385RegisterItemRow, 'due_date' | 'status'>,
  now: Date = new Date(),
): boolean {
  if (!item.due_date) return false
  if (item.status === 'accepted' || item.status === 'not_applicable') return false
  return daysUntilDue(item.due_date, now) < 0
}

// Default look-ahead window for "expiring soon" — matches the Compliance
// Calendar's DUE_SOON_DAYS so the two surfaces speak the same language.
export const EM385_EXPIRING_SOON_DAYS = 30

// An accepted item whose expiry falls within the window (and hasn't already
// passed) is "expiring soon" — the renewal nudge for certs/inspections/plans.
export function isExpiringSoon(
  item: Pick<Em385RegisterItemRow, 'expires_at' | 'status'>,
  now: Date = new Date(),
  windowDays: number = EM385_EXPIRING_SOON_DAYS,
): boolean {
  if (!item.expires_at || item.status !== 'accepted') return false
  const days = daysUntilDue(item.expires_at, now)
  return days >= 0 && days <= windowDays
}

// Retention deadline for a record, given when it became effective and the
// statutory window (e.g. 30 years for exposure/medical per 29 CFR 1910.1020).
// Returns YYYY-MM-DD, or null when either input is missing.
export function computeRetainUntil(
  effectiveDate: string | null | undefined,
  retentionYears: number | null | undefined,
): string | null {
  if (!effectiveDate || retentionYears == null) return null
  const [y, m, d] = effectiveDate.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return null
  const due = new Date(Date.UTC(y + retentionYears, m - 1, d))
  return due.toISOString().slice(0, 10)
}

// Validate the project create input. Returns null if valid, an error string
// otherwise — early feedback for the form; the DB constraints are the authority.
export function validateCreateProjectInput(input: Partial<Em385ProjectCreateInput>): string | null {
  if (!input.contract_number || !input.contract_number.trim()) return 'Contract number is required'
  if (!input.title || !input.title.trim()) return 'Project title is required'
  if (!input.edition) return 'EM-385 edition is required'
  if (!(EM385_EDITIONS as readonly string[]).includes(input.edition)) {
    return `Invalid edition: ${input.edition}`
  }
  if (input.start_date && input.end_date && input.end_date < input.start_date) {
    return 'End date cannot be before start date'
  }
  return null
}

// Validate a custom register-item create input.
export function validateCreateRegisterItemInput(input: Partial<Em385RegisterItemCreateInput>): string | null {
  if (!input.title || !input.title.trim()) return 'Title is required'
  if (!input.category) return 'Category is required'
  if (!(EM385_CATEGORIES as readonly string[]).includes(input.category)) {
    return `Invalid category: ${input.category}`
  }
  return null
}
