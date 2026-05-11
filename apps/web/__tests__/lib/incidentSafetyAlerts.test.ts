import { describe, expect, it } from 'vitest'
import {
  alertToneForIncident,
  buildIncidentSafetyAlertInsert,
} from '@soteria/core/incidentSafetyAlerts'
import type { IncidentRow } from '@soteria/core/incident'

function incident(partial: Partial<IncidentRow> = {}): IncidentRow {
  return {
    id:                               'incident-1',
    tenant_id:                        'tenant-1',
    report_number:                    'INC-2026-0001',
    incident_type:                    'near_miss',
    occurred_at:                      '2026-05-10T10:00:00.000Z',
    reported_at:                      '2026-05-10T10:05:00.000Z',
    reported_by:                      'user-1',
    is_anonymous:                     false,
    location_text:                    'Loading dock',
    location_geo:                     null,
    shift:                            null,
    description:                      'Pallet slipped from the jack while turning near dock door 4.',
    immediate_action_taken:           null,
    severity_actual:                  'none',
    severity_potential:               'low',
    probability:                      null,
    classification_matrix_cell:       null,
    status:                           'reported',
    assigned_investigator:            null,
    related_loto_permit_id:           null,
    related_hot_work_permit_id:       null,
    related_confined_space_permit_id: null,
    related_jha_id:                   null,
    workers_comp_claim_number:        null,
    spill_substance:                  null,
    spill_quantity:                   null,
    spill_quantity_unit:              null,
    legacy_near_miss_id:              null,
    closed_at:                        null,
    closed_by:                        null,
    created_at:                       '2026-05-10T10:05:00.000Z',
    updated_at:                       '2026-05-10T10:05:00.000Z',
    updated_by:                       null,
    ...partial,
  }
}

describe('incident safety alerts', () => {
  it('marks severe actual outcomes as critical', () => {
    expect(alertToneForIncident(incident({ severity_actual: 'fatality' }))).toBe('critical')
    expect(alertToneForIncident(incident({ severity_actual: 'lost_time' }))).toBe('critical')
  })

  it('raises high-potential and environmental incidents above attention', () => {
    expect(alertToneForIncident(incident({ severity_potential: 'high' }))).toBe('warning')
    expect(alertToneForIncident(incident({ incident_type: 'environmental' }))).toBe('warning')
    expect(alertToneForIncident(incident({ severity_potential: 'extreme' }))).toBe('critical')
  })

  it('builds a durable Command Center alert insert from an incident', () => {
    const row = buildIncidentSafetyAlertInsert(incident({
      incident_type:      'injury_illness',
      severity_actual:    'medical',
      location_text:      'Packaging line',
      description:        'Employee received treatment after a cut from a sharp edge.',
    }), 'user-1')

    expect(row).toMatchObject({
      tenant_id:     'tenant-1',
      incident_id:   'incident-1',
      report_number: 'INC-2026-0001',
      title:         'Injury / illness submitted',
      summary:       'Packaging line: Employee received treatment after a cut from a sharp edge.',
      severity_tone: 'warning',
      priority:      60,
      status:        'new',
      source:        'incident_submitted',
      created_by:    'user-1',
    })
  })
})
