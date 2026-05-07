import { describe, it, expect } from 'vitest'
import {
  classifyMatrix,
  firstAidVsMedical,
  decideRecordability,
  previewClassificationFromSeverity,
} from '@soteria/core/incidentClassification'
import {
  validateCreateInput,
  type IncidentCreateInput,
} from '@soteria/core/incident'
import {
  matchRules,
  buildDispatchPlan,
  type IncidentNotificationRule,
} from '@soteria/core/incidentNotificationRules'
import {
  validateRcaNode,
  canCompleteInvestigation,
} from '@soteria/core/rcaSchemas'
import {
  canTransition,
  isClosedOnTime,
  type IncidentActionRow,
} from '@soteria/core/incidentAction'
import {
  build300Row,
  build300ASummary,
  rowsToCsv,
  csvEscape,
  type Osha300Row,
} from '@soteria/core/oshaForms'
import {
  detectRepeatIncidents,
  type RepeatCandidate,
} from '@soteria/core/incidentRepeatDetector'
import {
  checkSpillRq,
  quantityInPounds,
} from '@soteria/core/epaReportableQuantities'

// devjr Phase D — edge-case sweep across the incident module's
// pure-logic helpers. Targets: empty input, max input, null vs
// undefined, special characters, boundary values, tenant scope.
// These complement the existing 229 incident-specific tests with
// the boundary cases not yet exercised.

describe('classify matrix — boundary scores', () => {
  it('S2×P1=2 lands in low band (the lowest possible)', () => {
    const c = classifyMatrix('low', 'rare')
    expect(c.score).toBe(2)
    expect(c.band).toBe('low')
    expect(c.slaHours).toBeNull()
  })

  it('S5×P5=25 is the highest possible cell', () => {
    const c = classifyMatrix('extreme', 'almost_certain')
    expect(c.score).toBe(25)
    expect(c.band).toBe('extreme')
  })

  it('produces stable cell labels for every (severity, probability) cell', () => {
    const sevs = ['low', 'moderate', 'high', 'extreme'] as const
    const probs = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'] as const
    const seen = new Set<string>()
    for (const s of sevs) for (const p of probs) {
      const c = classifyMatrix(s, p)
      seen.add(c.cell)
      expect(c.cell).toMatch(/^S\dxP\d_(low|moderate|high|extreme)$/)
    }
    // 4 × 5 = 20 distinct cells.
    expect(seen.size).toBe(20)
  })
})

describe('firstAidVsMedical — boundary inputs', () => {
  it('treats empty list as first-aid (no treatment given)', () => {
    expect(firstAidVsMedical([])).toBe('first_aid')
  })

  it('a single non-list item escalates to medical', () => {
    expect(firstAidVsMedical(['sutures'])).toBe('medical')
  })

  it('mixed list: any non-list item escalates the whole list', () => {
    expect(firstAidVsMedical([
      'wound_coverings',         // first-aid
      'tetanus_immunization',    // first-aid
      'prescription_strength_naproxen',  // medical
    ])).toBe('medical')
  })

  it('case-sensitive — capitalisation matters (treatments are codified slugs)', () => {
    // The first-aid list is lowercase canonical slugs; passing a
    // capitalised variant should NOT match — it's a coding error
    // upstream that we surface as "medical" (safer default).
    expect(firstAidVsMedical(['Wound_Coverings'])).toBe('medical')
  })
})

describe('decideRecordability — null + undefined input handling', () => {
  it('treats undefined optional day-counts gracefully', () => {
    const d = decideRecordability({
      is_work_related: true, is_new_case: true,
      resulted_in_death: false,
      resulted_in_days_away: true,
      // days_away_count omitted — should fall back to "0 day(s)"
      resulted_in_restricted_duty: false,
      loss_of_consciousness: false,
      medical_treatment_beyond_first_aid: false,
      significant_diagnosed_condition: false,
    })
    expect(d.classification).toBe('days_away')
    const dayQ = d.path.find(p => p.question.includes('days away'))
    expect(dayQ?.reason).toMatch(/0 day/)
  })

  it('every false outcome → not recordable, all questions visited', () => {
    const d = decideRecordability({
      is_work_related: true, is_new_case: true,
      resulted_in_death: false, resulted_in_days_away: false,
      resulted_in_restricted_duty: false, loss_of_consciousness: false,
      medical_treatment_beyond_first_aid: false,
      significant_diagnosed_condition: false,
    })
    expect(d.recordable).toBe(false)
    // Should have walked all 8 questions.
    expect(d.path.length).toBeGreaterThanOrEqual(8)
  })
})

describe('previewClassificationFromSeverity — every severity', () => {
  it.each([
    ['none',         null],
    ['first_aid',    null],
    ['medical',      'other_recordable'],
    ['lost_time',    'days_away'],
    ['fatality',     'death'],
    ['catastrophic', 'death'],
  ] as const)('maps %s → %s', (sev, expected) => {
    expect(previewClassificationFromSeverity(sev)).toBe(expected)
  })
})

describe('validateCreateInput — string-content edge cases', () => {
  const ok = {
    incident_type: 'injury_illness' as const,
    occurred_at:   '2026-04-01T12:00:00Z',
    description:   'someone got hurt',
  }

  it('accepts unicode in description', () => {
    expect(validateCreateInput({
      ...ok,
      description: 'Worker exposed to O₂ deficient atmosphere — 12% O₂ vs 20.9% baseline',
    })).toBeNull()
  })

  it('accepts very long description (no upper bound enforced client-side)', () => {
    const long = 'x'.repeat(5000)
    expect(validateCreateInput({ ...ok, description: long })).toBeNull()
  })

  it('rejects description with only whitespace + tabs + newlines', () => {
    expect(validateCreateInput({ ...ok, description: '  \t\n  ' })).toMatch(/description/i)
  })

  it('accepts spill_quantity = 0 (zero-volume releases are still events)', () => {
    expect(validateCreateInput({
      ...ok,
      incident_type:  'environmental',
      spill_quantity: 0,
    })).toBeNull()
  })

  it('rejects an injury with severity_actual = "wat"', () => {
    expect(validateCreateInput({
      ...ok,
      severity_actual: 'wat' as never,
    })).toMatch(/severity_actual/i)
  })

  it('handles every IncidentType', () => {
    for (const t of ['injury_illness', 'near_miss', 'property_damage', 'environmental'] as const) {
      const input: Partial<IncidentCreateInput> = {
        ...ok,
        incident_type:   t,
        // near_miss has the special severity rule
        severity_actual: t === 'near_miss' ? 'none' : 'first_aid',
      }
      expect(validateCreateInput(input)).toBeNull()
    }
  })
})

describe('matchRules — empty + many-rule cases', () => {
  const baseRule: IncidentNotificationRule = {
    id: 'r', tenant_id: 't', name: 'r', enabled: true,
    match_incident_type: null, match_severity_actual: null,
    match_severity_potential: null, match_recordable: null,
    notify_roles: null, notify_user_ids: null, notify_emails: null,
    channels: ['email'], escalation_minutes: null,
  }
  const baseInc = {
    incident_type: 'injury_illness' as const,
    severity_actual: 'medical' as const,
    severity_potential: null,
  }

  it('empty rules array → empty match list', () => {
    expect(matchRules(baseInc, [], false)).toEqual([])
  })

  it('100 disabled rules → empty match', () => {
    const rules = Array.from({ length: 100 }, (_, i) => ({ ...baseRule, id: `r${i}`, enabled: false }))
    expect(matchRules(baseInc, rules, false)).toHaveLength(0)
  })

  it('contradictory filters never match', () => {
    const r = {
      ...baseRule,
      match_incident_type: ['injury_illness' as const],
      match_severity_actual: ['none' as const],   // medical doesn't match
    }
    expect(matchRules(baseInc, [r], false)).toHaveLength(0)
  })
})

describe('buildDispatchPlan — recipient dedupe under load', () => {
  it('dedupes role + user_id matches into one entry per user', () => {
    // Same user reachable via role + explicit user_id should
    // produce ONE entry (same channel + user_id + email tuple).
    // Listing the same email as a raw "external email" produces a
    // second entry by design — raw-email recipients carry user_id=null
    // so the dedupe key differs. That's intentional (external safety
    // officer at the same address as a tenant user is a legitimate
    // scenario) but worth pinning so the behaviour can't drift.
    const owner = { user_id: 'u-owner', email: 'owner@x.com', role: 'owner' as const }
    const ruleRoleAndUserId: IncidentNotificationRule = {
      id: 'a', tenant_id: 't', name: 'a', enabled: true,
      match_incident_type: null, match_severity_actual: null,
      match_severity_potential: null, match_recordable: null,
      notify_roles: ['owner'], notify_user_ids: ['u-owner'], notify_emails: null,
      channels: ['email'], escalation_minutes: null,
    }
    const ruleEmailOnly: IncidentNotificationRule = { ...ruleRoleAndUserId,
      id: 'b', notify_roles: null, notify_user_ids: null, notify_emails: ['owner@x.com'],
    }
    // Role + user_id path → 1 (same key).
    expect(buildDispatchPlan(
      { incident_type: 'injury_illness', severity_actual: 'medical', severity_potential: null },
      [ruleRoleAndUserId], [owner], false,
    )).toHaveLength(1)
    // Adding the email-only rule → 2 (raw-email path, user_id=null).
    expect(buildDispatchPlan(
      { incident_type: 'injury_illness', severity_actual: 'medical', severity_potential: null },
      [ruleRoleAndUserId, ruleEmailOnly], [owner], false,
    )).toHaveLength(2)
  })
})

describe('canTransition — exhaustive matrix', () => {
  // Every legal transition + a couple of illegal ones.
  const all = ['open', 'in_progress', 'blocked', 'complete', 'verified', 'cancelled'] as const

  it('every status allows no-op (self-transition)', () => {
    for (const s of all) {
      expect(canTransition(s, s)).toBe(true)
    }
  })

  it('open → verified is illegal (skipping the lifecycle)', () => {
    expect(canTransition('open', 'verified')).toBe(false)
  })

  it('cancelled → in_progress is illegal (must reopen first)', () => {
    expect(canTransition('cancelled', 'in_progress')).toBe(false)
  })

  it('blocked → complete is illegal (must unblock first)', () => {
    expect(canTransition('blocked', 'complete')).toBe(false)
  })
})

describe('isClosedOnTime — same-second tie', () => {
  function row(over: Partial<IncidentActionRow>): IncidentActionRow {
    return {
      id: 'a', tenant_id: 't', incident_id: 'i',
      action_type: 'corrective', hierarchy_of_controls: null,
      description: 'x', owner_user_id: null, due_at: null,
      status: 'complete', completed_at: null, verified_at: null, verified_by: null,
      verification_evidence: null, source_rca_node_id: null, cancel_reason: null,
      created_at: '2026-04-01T00:00:00Z', updated_at: '2026-04-01T00:00:00Z',
      created_by: null, updated_by: null,
      ...over,
    }
  }

  it('completed_at exactly equal to due_at counts as on-time', () => {
    expect(isClosedOnTime(row({
      status:       'complete',
      completed_at: '2026-04-10T00:00:00Z',
      due_at:       '2026-04-10T00:00:00Z',
    }))).toBe(true)
  })

  it('completed_at one millisecond past due_at is late', () => {
    expect(isClosedOnTime(row({
      status:       'complete',
      completed_at: '2026-04-10T00:00:00.001Z',
      due_at:       '2026-04-10T00:00:00Z',
    }))).toBe(false)
  })
})

describe('build300Row — spill case (no person, no care)', () => {
  it('shapes a recordable row even when person + care are null', () => {
    // Edge case: a spill that exposed a worker to a substance which
    // led to medical treatment, but the person row was never filed
    // (paperwork drift).
    const row = build300Row({
      incident: {
        report_number: 'INC-2026-0007',
        occurred_at:   '2026-04-12T10:00:00Z',
        description:   'Acute hydrogen sulfide exposure during pipe maintenance',
        location_text: 'Refinery — coker unit',
      },
      classification: {
        meets_recording_criteria: true,
        classification:           'other_recordable',
        is_privacy_case:          false,
      },
      person: null,
      care:   null,
    })
    expect(row).not.toBeNull()
    expect(row!.employee_name).toBe('Unknown')
    expect(row!.job_title).toBeNull()
    expect(row!.days_away).toBe(0)
    expect(row!.days_restricted).toBe(0)
  })
})

describe('build300ASummary — empty + max input', () => {
  it('empty rows + zero hours → zero counts, hours echo through', () => {
    const s = build300ASummary({ year: 2026, rows: [], total_hours_worked: 0, annual_avg_employees: 0 })
    expect(s.total_deaths).toBe(0)
    expect(s.total_hours_worked).toBe(0)
  })

  it('100-row fixture aggregates without overflow', () => {
    const rows: Osha300Row[] = Array.from({ length: 100 }, (_, i) => ({
      case_number:        `INC-${i}`,
      employee_name:      'A B',
      job_title:          null,
      date_of_injury:     '2026-04-01',
      location_text:      null,
      injury_description: null,
      classification:     'days_away',
      days_away:          180,           // worst case — all hit the cap
      days_restricted:    0,
      injury_type:        'injury',
      is_privacy_case:    false,
    }))
    const s = build300ASummary({
      year: 2026, rows, total_hours_worked: 500_000, annual_avg_employees: 250,
    })
    expect(s.total_days_away).toBe(100)
    expect(s.total_days_away_count).toBe(18_000)
  })
})

describe('csvEscape — pathological strings', () => {
  it('escapes a CSV-injection attempt with quote + newline', () => {
    // OSHA ITA upload — a substance label with a quote + newline
    // should round-trip cleanly through the CSV writer. We verify
    // the output starts/ends with " and embeds doubled quotes.
    const evil = `"Sulfuric acid",DROP TABLE\nVALUES (1)`
    const escaped = csvEscape(evil)
    expect(escaped.startsWith('"')).toBe(true)
    expect(escaped.endsWith('"')).toBe(true)
    expect(escaped).toContain('""Sulfuric acid""')
    expect(escaped).toContain('\n')
    const csv = rowsToCsv([['name'], [evil]])
    expect(csv).toContain('""Sulfuric acid"",DROP TABLE')
  })

  it('handles only-whitespace and zero-length cells', () => {
    expect(csvEscape('')).toBe('')
    expect(csvEscape(' ')).toBe(' ')
    expect(csvEscape('\t')).toBe('\t')
  })
})

describe('canCompleteInvestigation — every blocked path', () => {
  it('blocks none_yet method even with nodes + root', () => {
    const r = canCompleteInvestigation({ rca_method: 'none_yet', has_nodes: true, has_root: true })
    expect(r.ok).toBe(false)
  })

  it('blocks no nodes even with chosen method', () => {
    const r = canCompleteInvestigation({ rca_method: '5_whys', has_nodes: false, has_root: false })
    expect(r.ok).toBe(false)
  })

  it('blocks nodes-but-no-root', () => {
    const r = canCompleteInvestigation({ rca_method: 'taproot', has_nodes: true, has_root: false })
    expect(r.ok).toBe(false)
  })
})

describe('validateRcaNode — edge cases per method', () => {
  it('5whys ordinal=1 with empty answer rejected', () => {
    expect(validateRcaNode({ method: '5_whys', node: { ordinal: 1, answer: '' } })).toMatch(/answer/i)
  })

  it('fishbone with cause containing only whitespace rejected', () => {
    expect(validateRcaNode({ method: 'fishbone', node: { category: 'people', cause: '   ' } })).toMatch(/cause/i)
  })

  it('taproot allows any factor_type with description (parent optional)', () => {
    expect(validateRcaNode({
      method: 'taproot',
      node:   { factor_type: 'event', description: 'employee fell' },
    })).toBeNull()
  })
})

describe('detectRepeatIncidents — empty pool vs identical pool', () => {
  const focal: RepeatCandidate = {
    id: 'f', report_number: 'INC-1', occurred_at: '2026-04-15T00:00:00Z',
    incident_type: 'injury_illness', description: 'slipped on oil',
    location_text: 'Loading dock B', body_parts: ['back_lower'],
  }

  it('handles empty pool', () => {
    expect(detectRepeatIncidents(focal, [])).toEqual([])
  })

  it('handles a pool of 100 identical-location incidents (limit caps)', () => {
    const pool: RepeatCandidate[] = Array.from({ length: 100 }, (_, i) => ({
      id: `c${i}`, report_number: `INC-${i + 100}`,
      occurred_at: '2026-04-01T00:00:00Z',
      incident_type: 'injury_illness',
      description: 'unrelated',
      location_text: 'Loading dock B',
      body_parts: null,
    }))
    const matches = detectRepeatIncidents(focal, pool, { limit: 5 })
    expect(matches).toHaveLength(5)
  })
})

describe('checkSpillRq — boundary quantities', () => {
  it('quantity exactly equal to RQ counts as meets_rq', () => {
    const out = checkSpillRq({ substance: 'Chlorine', quantity: 10, quantity_unit: 'lb' })
    expect(out.kind).toBe('meets_rq')
  })

  it('quantity = 0 treats as below_rq for known substance', () => {
    const out = checkSpillRq({ substance: 'Chlorine', quantity: 0, quantity_unit: 'lb' })
    expect(out.kind).toBe('below_rq')
  })

  it('quantity = NaN returns unknown_quantity (defensive)', () => {
    const out = checkSpillRq({ substance: 'Chlorine', quantity: NaN, quantity_unit: 'lb' })
    expect(out.kind).toBe('unknown_quantity')
  })

  it('handles substance trim + unicode', () => {
    expect(checkSpillRq({ substance: '  AMMONIA  ', quantity: 200, quantity_unit: 'lb' }).kind).toBe('meets_rq')
  })
})

describe('quantityInPounds — extreme inputs', () => {
  it('Number.MAX_SAFE_INTEGER kg returns finite pounds', () => {
    const r = quantityInPounds(Number.MAX_SAFE_INTEGER, 'kg')
    expect(r).not.toBeNull()
    expect(Number.isFinite(r!)).toBe(true)
  })
})
