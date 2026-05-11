import {
  INCIDENT_TYPE_LABEL,
  type IncidentRow,
} from './incident'

export type CommandCenterAlertTone = 'critical' | 'warning' | 'attention'
export type CommandCenterAlertStatus = 'new' | 'acknowledged' | 'in_review' | 'escalated' | 'resolved' | 'dismissed'
export type CommandCenterAlertSource = 'incident_submitted'

export interface CommandCenterSafetyAlert {
  id:              string
  tenant_id:       string
  incident_id:     string
  report_number:   string
  title:           string
  summary:         string
  severity_tone:   CommandCenterAlertTone
  priority:        number
  status:          CommandCenterAlertStatus
  source:          CommandCenterAlertSource
  created_at:      string
  acknowledged_at: string | null
  resolved_at:     string | null
}

export interface CommandCenterSafetyAlertDetail extends CommandCenterSafetyAlert {
  created_by:      string | null
  acknowledged_by: string | null
  resolved_by:     string | null
  resolution_note: string | null
  updated_at:      string
}

export interface CommandCenterSafetyAlertInsert {
  tenant_id:       string
  incident_id:     string
  report_number:   string
  title:           string
  summary:         string
  severity_tone:   CommandCenterAlertTone
  priority:        number
  status:          Extract<CommandCenterAlertStatus, 'new'>
  source:          CommandCenterAlertSource
  created_by:      string | null
}

export function alertToneForIncident(
  incident: Pick<IncidentRow, 'incident_type' | 'severity_actual' | 'severity_potential'>,
): CommandCenterAlertTone {
  if (incident.severity_actual === 'fatality' || incident.severity_actual === 'catastrophic') return 'critical'
  if (incident.severity_actual === 'lost_time') return 'critical'
  if (incident.severity_actual === 'medical') return 'warning'
  if (incident.severity_potential === 'extreme') return 'critical'
  if (incident.severity_potential === 'high') return 'warning'
  if (incident.incident_type === 'environmental') return 'warning'
  return 'attention'
}

export function alertPriorityForTone(tone: CommandCenterAlertTone): number {
  if (tone === 'critical') return 90
  if (tone === 'warning') return 60
  return 30
}

export function buildIncidentSafetyAlertInsert(
  incident: Pick<
    IncidentRow,
    'id' | 'tenant_id' | 'report_number' | 'incident_type' | 'description' | 'location_text' | 'severity_actual' | 'severity_potential'
  >,
  createdBy: string | null,
): CommandCenterSafetyAlertInsert {
  const tone = alertToneForIncident(incident)
  const typeLabel = INCIDENT_TYPE_LABEL[incident.incident_type]
  const location = incident.location_text?.trim() || null
  const summary = summarizeIncidentAlert(incident.description, location)

  return {
    tenant_id:     incident.tenant_id,
    incident_id:   incident.id,
    report_number: incident.report_number,
    title:         `${typeLabel} submitted`,
    summary,
    severity_tone: tone,
    priority:      alertPriorityForTone(tone),
    status:        'new',
    source:        'incident_submitted',
    created_by:    createdBy,
  }
}

function summarizeIncidentAlert(description: string, location: string | null): string {
  const clean = description.trim().replace(/\s+/g, ' ')
  const withLocation = location ? `${location}: ${clean}` : clean
  return withLocation.length > 160 ? `${withLocation.slice(0, 157).trimEnd()}...` : withLocation
}
