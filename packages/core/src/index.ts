// Barrel for `@soteria/core` — cross-platform business logic.
//
// Use a sub-path for narrow imports (`@soteria/core/types`,
// `@soteria/core/validation/tenants`) when callers want to limit
// surface area. The catch-all re-exports below are convenient when
// you actually want everything (e.g. test utilities).

export * from './types'
export * from './features'
export * from './moduleVisibility'
export * from './orgConfig'
export * from './energyCodes'
export * from './confinedSpaceLabels'
export * from './confinedSpaceThresholds'
export * from './hotWorkChecklist'
export * from './permitStatus'
export * from './photoStatus'
export * from './hotWorkPermitStatus'
export * from './equipmentReconcile'
export * from './supabase'
export * from './supabaseClient'
export * from './scorecardMetrics'
export * from './insightsMetrics'
export * from './homeMetrics'
export * from './storagePaths'
export * from './photoUpload'
export * from './risk'
export * from './riskMetrics'
export * from './nearMiss'
export * from './nearMissMetrics'
// Incident module reuses some helper names from nearMiss
// (compareForTriage, isActive, ageInDays, validateCreateInput) since
// the API surface is intentionally parallel. Callers should pull
// these via the sub-path (`@soteria/core/incident`) when both are
// in scope. The barrel re-exports the unique names only.
export {
  INCIDENT_TYPES,
  INCIDENT_SEVERITY_ACTUAL,
  INCIDENT_SEVERITY_POTENTIAL,
  INCIDENT_PROBABILITY,
  INCIDENT_STATUSES,
  INCIDENT_SHIFTS,
  INCIDENT_PERSON_ROLES,
  INCIDENT_EMPLOYMENT_TYPES,
  INCIDENT_SPILL_UNITS,
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  STATUS_LABEL as INCIDENT_STATUS_LABEL,
  ACTIVE_INCIDENT_STATUSES,
  type IncidentRow,
  type IncidentCreateInput,
  type IncidentPersonRow,
  type IncidentPersonCreateInput,
  type IncidentType,
  type IncidentStatus,
  type IncidentSeverityActual,
  type IncidentSeverityPotential,
  type IncidentProbability,
  type IncidentShift,
  type IncidentPersonRole,
  type IncidentEmploymentType,
  type IncidentSpillUnit,
} from './incident'
export * from './incidentClassification'
export * from './incidentNotificationRules'
export * from './rcaSchemas'
export * from './incidentAction'
export * from './incidentCare'
export * from './oshaForms'
export * from './incidentScorecardMetrics'
export * from './incidentRepeatDetector'
export * from './jha'
export * from './jhaMetrics'
export * from './severityColors'
