// Edge cases for the incident reporter.
//
// The happy paths live in __tests__/e2e/incidentReporter*.e2e.test.*.
// This file is the adversarial half: boundary values, hostile payloads,
// and the states a real intake reaches on a bad day — a phone with a
// wrong clock, a worker who pastes an emoji, a caller who posts a
// number where a string belongs.
//
// Every assertion here describes a contract, not an implementation. If
// one fails, the behaviour changed; decide whether that was intended
// before you change the test.

import { describe, it, expect } from 'vitest'
import {
  ageInDays,
  coerceCreateInput,
  compareForTriage,
  formatIncidentGeo,
  isActive,
  parseIncidentGeo,
  validateCreateInput,
  type IncidentRow,
} from '@soteria/core/incident'
import {
  buildDispatchPlan,
  buildRecipientList,
  matchRules,
  type IncidentNotificationRule,
  type IncidentRuleMember,
} from '@soteria/core/incidentNotificationRules'
import {
  alertToneForIncident,
  buildIncidentSafetyAlertInsert,
} from '@soteria/core/incidentSafetyAlerts'
import {
  classifyMatrix,
  decideRecordability,
  firstAidVsMedical,
  previewClassificationFromSeverity,
} from '@soteria/core/incidentClassification'
import { hashReceipt, isValidPinFormat, normalizePin } from '@/lib/anonReport/receipt'

const VALID = {
  incident_type: 'near_miss' as const,
  occurred_at:   '2026-08-20T10:00:00.000Z',
  description:   'Pallet slipped off the forks.',
}

// ═══ Wire-shape coercion ═══════════════════════════════════════════════
//
// Both intake routes hand an untrusted JSON body straight to
// coerceCreateInput. Anything it lets through as the wrong type reaches
// a .trim() and becomes a 500 the reporter cannot act on.

describe('coerceCreateInput — hostile payloads', () => {
  it('drops a numeric description rather than passing it to .trim()', () => {
    const input = coerceCreateInput({ ...VALID, description: 42 })
    expect(input.description).toBeUndefined()
    expect(validateCreateInput(input)).toBe('Description is required')
  })

  it.each([
    ['null',    null],
    ['array',   ['a', 'b']],
    ['object',  { toString: 'nope' }],
    ['boolean', true],
  ])('drops a %s description', (_label, value) => {
    expect(coerceCreateInput({ ...VALID, description: value }).description).toBeUndefined()
  })

  it('drops a non-string incident_type so the enum check reports it plainly', () => {
    const input = coerceCreateInput({ ...VALID, incident_type: 7 })
    expect(validateCreateInput(input)).toBe('Incident type is required')
  })

  it('drops a stringified spill quantity — "12" is not a number', () => {
    expect(coerceCreateInput({ ...VALID, spill_quantity: '12' }).spill_quantity).toBeNull()
  })

  it('survives a body that is not an object at all', () => {
    for (const body of [null, undefined, 'a string', 42, []]) {
      expect(() => coerceCreateInput(body)).not.toThrow()
      expect(validateCreateInput(coerceCreateInput(body))).toBe('Incident type is required')
    }
  })

  it('ignores fields outside the create contract', () => {
    const input = coerceCreateInput({
      ...VALID,
      tenant_id:     'attacker-supplied',
      reported_by:   'someone-else',
      is_anonymous:  true,
      status:        'closed',
      report_number: 'INC-2026-0001',
    }) as Record<string, unknown>

    // Server-controlled columns must not be reachable from the wire.
    for (const forbidden of ['tenant_id', 'reported_by', 'is_anonymous', 'status', 'report_number']) {
      expect(input[forbidden]).toBeUndefined()
    }
  })

  it('does not let a __proto__ key in the body reach Object.prototype', () => {
    const body = JSON.parse('{"incident_type":"near_miss","__proto__":{"polluted":true}}')
    coerceCreateInput(body)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

// ═══ Validation boundaries ═════════════════════════════════════════════

describe('validateCreateInput — time boundaries', () => {
  it('accepts an event exactly at the 5-minute clock-skew limit', () => {
    const at = new Date(Date.now() + 5 * 60_000 - 1_000).toISOString()
    expect(validateCreateInput({ ...VALID, occurred_at: at })).toBeNull()
  })

  it('rejects an event a minute past the skew limit', () => {
    const at = new Date(Date.now() + 6 * 60_000).toISOString()
    expect(validateCreateInput({ ...VALID, occurred_at: at })).toBe('occurred_at cannot be in the future')
  })

  it('accepts a decades-old event — backfilled records are legitimate', () => {
    expect(validateCreateInput({ ...VALID, occurred_at: '1998-04-02T06:30:00.000Z' })).toBeNull()
  })

  it.each(['', '   ', 'yesterday', '2026-13-45T00:00:00Z', '2026-02-30T99:99:99Z'])(
    'rejects the unparseable timestamp %j', (at) => {
      expect(validateCreateInput({ ...VALID, occurred_at: at })).not.toBeNull()
    })

  it('accepts a date-only string — a worker reporting "last Tuesday" has no clock time', () => {
    expect(validateCreateInput({ ...VALID, occurred_at: '2026-08-20' })).toBeNull()
  })
})

describe('validateCreateInput — narrative boundaries', () => {
  it.each([
    ['empty',           ''],
    ['spaces',          '     '],
    ['tabs + newlines', '\t\n  \n'],
  ])('rejects a %s description', (_label, description) => {
    expect(validateCreateInput({ ...VALID, description })).toBe('Description is required')
  })

  it('accepts a single meaningful character', () => {
    expect(validateCreateInput({ ...VALID, description: 'x' })).toBeNull()
  })

  it('accepts emoji and non-Latin scripts — the shop floor is multilingual', () => {
    expect(validateCreateInput({ ...VALID, description: '⚠️ Se resbaló · 滑倒了' })).toBeNull()
  })

  it('accepts a very long narrative rather than truncating a witness account', () => {
    expect(validateCreateInput({ ...VALID, description: 'a'.repeat(20_000) })).toBeNull()
  })
})

describe('validateCreateInput — enum and type-specific fields', () => {
  it.each(['first_aid', 'medical', 'lost_time', 'fatality', 'catastrophic'])(
    'refuses a near-miss carrying severity_actual=%s', (severity) => {
      const err = validateCreateInput({ ...VALID, severity_actual: severity as never })
      expect(err).toMatch(/escalate to injury_illness/)
    })

  it('allows every severity on an injury report', () => {
    for (const severity of ['none', 'first_aid', 'medical', 'lost_time', 'fatality', 'catastrophic'] as const) {
      expect(validateCreateInput({
        ...VALID, incident_type: 'injury_illness', severity_actual: severity,
      })).toBeNull()
    }
  })

  it.each([
    ['negative',  -1],
    ['infinite',  Number.POSITIVE_INFINITY],
    ['NaN',       Number.NaN],
  ])('rejects a %s spill quantity', (_label, spill_quantity) => {
    expect(validateCreateInput({ ...VALID, spill_quantity })).toBe('spill_quantity must be a non-negative number')
  })

  it('accepts a zero spill quantity — "we saw it, we contained it all"', () => {
    expect(validateCreateInput({ ...VALID, spill_quantity: 0 })).toBeNull()
  })

  it('rejects a unit outside the accepted set', () => {
    expect(validateCreateInput({ ...VALID, spill_quantity_unit: 'barrels' as never }))
      .toMatch(/Invalid spill_quantity_unit/)
  })

  it('rejects an unknown shift', () => {
    expect(validateCreateInput({ ...VALID, shift: 'graveyard' as never })).toMatch(/Invalid shift/)
  })
})

// ═══ GPS codec ═════════════════════════════════════════════════════════
//
// One codec, one axis order. The reader and the writer disagreeing here
// silently plants every incident on the wrong side of the planet.

describe('incident GPS codec', () => {
  it('round-trips a real coordinate', () => {
    const point = { lat: 40.712776, lng: -74.005974 }
    expect(parseIncidentGeo(formatIncidentGeo(point))).toEqual(point)
  })

  it('writes longitude first, matching the point(lon,lat) column', () => {
    expect(formatIncidentGeo({ lat: 40.5, lng: -74.25 })).toBe('(-74.250000,40.500000)')
  })

  it('reads longitude first, so a round trip cannot swap the axes', () => {
    expect(parseIncidentGeo('(-74.250000,40.500000)')).toEqual({ lat: 40.5, lng: -74.25 })
  })

  it('accepts the poles and the antimeridian exactly', () => {
    expect(parseIncidentGeo('(180,90)')).toEqual({ lat: 90, lng: 180 })
    expect(parseIncidentGeo('(-180,-90)')).toEqual({ lat: -90, lng: -180 })
  })

  it('rejects coordinates past the poles or the antimeridian', () => {
    expect(parseIncidentGeo('(0,90.1)')).toBeNull()
    expect(parseIncidentGeo('(180.1,0)')).toBeNull()
  })

  it('accepts null island — 0,0 is a coordinate, not a missing value', () => {
    expect(parseIncidentGeo('(0,0)')).toEqual({ lat: 0, lng: 0 })
  })

  it('tolerates the whitespace Postgres may pad a point with', () => {
    expect(parseIncidentGeo(' ( -74.0 , 40.7 ) ')).toEqual({ lat: 40.7, lng: -74.0 })
  })

  it.each([
    ['missing parens',   '-74.0,40.7'],
    ['one ordinate',     '(40.7)'],
    ['three ordinates',  '(1,2,3)'],
    ['exponent form',    '(1e2,3)'],
    ['prose',            'somewhere near the dock'],
    ['SQL-ish',          "(0,0); drop table incidents--"],
    ['empty',            ''],
  ])('returns null for %s', (_label, raw) => {
    expect(parseIncidentGeo(raw)).toBeNull()
  })

  it.each([null, undefined, 42, { lat: 1, lng: 2 }, ['1', '2']])(
    'returns null for the non-string %j', (raw) => {
      expect(parseIncidentGeo(raw)).toBeNull()
    })

  it('is enforced by the create validator, so a bad point never reaches Postgres', () => {
    expect(validateCreateInput({ ...VALID, location_geo: '(999,999)' }))
      .toMatch(/location_geo must be a/)
    expect(validateCreateInput({ ...VALID, location_geo: formatIncidentGeo({ lat: 1, lng: 2 }) }))
      .toBeNull()
  })

  it('treats an absent point as absent, not as invalid', () => {
    expect(validateCreateInput({ ...VALID, location_geo: null })).toBeNull()
    expect(validateCreateInput({ ...VALID })).toBeNull()
  })
})

// ═══ Row helpers ═══════════════════════════════════════════════════════

function row(overrides: Partial<IncidentRow>): IncidentRow {
  return {
    reported_at: '2026-08-01T00:00:00.000Z', closed_at: null,
    severity_actual: 'none', severity_potential: null, status: 'reported',
    ...overrides,
  } as IncidentRow
}

describe('ageInDays — clock edge cases', () => {
  const now = new Date('2026-08-11T00:00:00.000Z')

  it('counts whole days only', () => {
    expect(ageInDays(row({ reported_at: '2026-08-01T23:59:59.999Z' }), now)).toBe(9)
  })

  it('is zero for a report filed a moment ago', () => {
    expect(ageInDays(row({ reported_at: now.toISOString() }), now)).toBe(0)
  })

  it('clamps a closed_at that precedes reported_at instead of going negative', () => {
    expect(ageInDays(row({ reported_at: '2026-08-05T00:00:00Z', closed_at: '2026-08-01T00:00:00Z' }), now)).toBe(0)
  })

  it('returns zero rather than NaN for an unparseable timestamp', () => {
    // A NaN here propagates into every average and SLA sum downstream.
    expect(ageInDays(row({ reported_at: 'not-a-date' }), now)).toBe(0)
    expect(ageInDays(row({ closed_at: 'not-a-date' }), now)).toBe(0)
  })
})

describe('triage ordering', () => {
  it('puts the most severe first and breaks ties by who waited longest', () => {
    const rows = [
      row({ severity_actual: 'first_aid', reported_at: '2026-08-01T00:00:00Z' }),
      row({ severity_actual: 'fatality',  reported_at: '2026-08-03T00:00:00Z' }),
      row({ severity_actual: 'first_aid', reported_at: '2026-07-01T00:00:00Z' }),
    ]
    const order = [...rows].sort(compareForTriage).map(r => `${r.severity_actual}@${r.reported_at.slice(0, 10)}`)
    expect(order).toEqual(['fatality@2026-08-03', 'first_aid@2026-07-01', 'first_aid@2026-08-01'])
  })

  it('sorts near-misses with no potential set behind those that have one', () => {
    const withPotential = row({ severity_potential: 'low' })
    const without       = row({ severity_potential: null })
    expect(compareForTriage(withPotential, without)).toBeLessThan(0)
  })

  it('treats reopened as active and closed as not', () => {
    expect(isActive(row({ status: 'reopened' }))).toBe(true)
    expect(isActive(row({ status: 'closed' }))).toBe(false)
  })
})

// ═══ Notification rules ════════════════════════════════════════════════

const RULE: IncidentNotificationRule = {
  id: 'r1', tenant_id: 't1', name: 'Rule', enabled: true,
  match_incident_type: null, match_severity_actual: null, match_severity_potential: null,
  match_recordable: null,
  notify_roles: null, notify_user_ids: null, notify_emails: null,
  channels: ['email'], escalation_minutes: null,
}

const MEMBERS: IncidentRuleMember[] = [
  { user_id: 'u-admin',   role: 'admin',  email: 'Lead@Example.test' },
  { user_id: 'u-member',  role: 'member', email: 'worker@example.test' },
  { user_id: 'u-noemail', role: 'admin',  email: null },
]

const INCIDENT = { incident_type: 'near_miss', severity_actual: 'none', severity_potential: 'high' } as IncidentRow

describe('notification matching', () => {
  it('skips a disabled rule even when every filter matches', () => {
    expect(matchRules(INCIDENT, [{ ...RULE, enabled: false }], false)).toHaveLength(0)
  })

  it('treats an empty match array as "match nothing", not "match everything"', () => {
    // An operator who clears the type list has narrowed the rule to
    // nothing; firing on all types would be the opposite of their intent.
    expect(matchRules(INCIDENT, [{ ...RULE, match_incident_type: [] }], false)).toHaveLength(0)
  })

  it('never matches a potential filter when the report has no potential set', () => {
    const noPotential = { ...INCIDENT, severity_potential: null } as IncidentRow
    expect(matchRules(noPotential, [{ ...RULE, match_severity_potential: ['high'] }], false)).toHaveLength(0)
  })

  it('honours match_recordable in both directions', () => {
    const recordableOnly    = { ...RULE, match_recordable: true }
    const nonRecordableOnly = { ...RULE, match_recordable: false }
    expect(matchRules(INCIDENT, [recordableOnly],    true)).toHaveLength(1)
    expect(matchRules(INCIDENT, [recordableOnly],    false)).toHaveLength(0)
    expect(matchRules(INCIDENT, [nonRecordableOnly], false)).toHaveLength(1)
  })
})

describe('recipient resolution', () => {
  it('mails a member once when they match by role and by user id', () => {
    const rule = { ...RULE, notify_roles: ['admin' as const], notify_user_ids: ['u-admin'] }
    expect(buildRecipientList(rule, MEMBERS).filter(r => r.user_id === 'u-admin')).toHaveLength(1)
  })

  it('collapses a typed outside address onto the member who owns it', () => {
    const rule = { ...RULE, notify_roles: ['admin' as const], notify_emails: ['lead@example.test'] }
    const toLead = buildRecipientList(rule, MEMBERS)
      .filter(r => r.email?.toLowerCase() === 'lead@example.test')

    expect(toLead).toHaveLength(1)
    // The membership match wins, so the log still names a user.
    expect(toLead[0].source).toBe('role')
    expect(toLead[0].user_id).toBe('u-admin')
  })

  it('still reaches an outside address that belongs to no member', () => {
    const rule = { ...RULE, notify_emails: ['regulator@agency.example'] }
    const [only] = buildRecipientList(rule, MEMBERS)
    expect(only).toMatchObject({ channel: 'email', user_id: null, source: 'email' })
  })

  it('treats addresses case-insensitively when deduping', () => {
    const rule = { ...RULE, notify_emails: ['Ops@Example.test', 'ops@example.test', ' OPS@EXAMPLE.TEST '] }
    expect(buildRecipientList(rule, MEMBERS)).toHaveLength(1)
  })

  it('keeps two different members apart even when neither has an address', () => {
    const rule = { ...RULE, notify_user_ids: ['u-noemail', 'u-unknown'] }
    expect(buildRecipientList(rule, [...MEMBERS])).toHaveLength(2)
  })

  it('drops blank entries in the address list', () => {
    const rule = { ...RULE, notify_emails: ['', '   ', 'real@example.test'] }
    expect(buildRecipientList(rule, MEMBERS).map(r => r.email)).toEqual(['real@example.test'])
  })

  it('does not mail an outside address from a push-only rule', () => {
    const rule = { ...RULE, channels: ['push' as const], notify_emails: ['outside@example.test'] }
    expect(buildRecipientList(rule, MEMBERS)).toHaveLength(0)
  })

  it('fans a member out across every channel the rule enables', () => {
    const rule = { ...RULE, channels: ['email' as const, 'push' as const], notify_user_ids: ['u-admin'] }
    expect(buildRecipientList(rule, MEMBERS).map(r => r.channel).sort()).toEqual(['email', 'push'])
  })

  it('produces nothing for a rule that names no recipients', () => {
    expect(buildRecipientList(RULE, MEMBERS)).toHaveLength(0)
  })
})

describe('dispatch planning across rules', () => {
  it('mails a recipient once when two rules reach them by different paths', () => {
    const a = { ...RULE, id: 'a', notify_roles: ['admin' as const] }
    const b = { ...RULE, id: 'b', notify_emails: ['lead@example.test'] }
    const plans = buildDispatchPlan(INCIDENT, [a, b], MEMBERS, false)

    const forLead = plans.filter(p => p.recipient.user_id === 'u-admin')
    expect(forLead).toHaveLength(1)
    expect(forLead[0].rule_id).toBe('a')   // first matching rule owns the audit entry
  })

  it('returns nothing when a tenant has no rules configured', () => {
    expect(buildDispatchPlan(INCIDENT, [], MEMBERS, false)).toHaveLength(0)
  })

  it('returns nothing when the tenant has rules but no members to notify', () => {
    expect(buildDispatchPlan(INCIDENT, [{ ...RULE, notify_roles: ['admin'] }], [], false)).toHaveLength(0)
  })
})

// ═══ Command-centre alert ══════════════════════════════════════════════

describe('safety-alert summary', () => {
  const base = {
    id: 'i1', tenant_id: 't1', report_number: 'INC-2026-0001',
    incident_type: 'near_miss', severity_actual: 'none', severity_potential: null,
    description: 'Short note.', location_text: null,
  } as IncidentRow

  it('collapses the whitespace a phone keyboard leaves behind', () => {
    const alert = buildIncidentSafetyAlertInsert({ ...base, description: 'Spill\n\n  by   the\tdock' }, null)
    expect(alert.summary).toBe('Spill by the dock')
  })

  it('prefixes the location when one was given', () => {
    const alert = buildIncidentSafetyAlertInsert({ ...base, location_text: '  Dock B  ' }, null)
    expect(alert.summary).toBe('Dock B: Short note.')
  })

  it('truncates a long narrative to a scannable line', () => {
    const alert = buildIncidentSafetyAlertInsert({ ...base, description: 'x'.repeat(500) }, null)
    expect(alert.summary).toHaveLength(160)
    expect(alert.summary.endsWith('...')).toBe(true)
  })

  it('leaves a narrative that exactly fits alone', () => {
    const alert = buildIncidentSafetyAlertInsert({ ...base, description: 'y'.repeat(160) }, null)
    expect(alert.summary).toBe('y'.repeat(160))
  })

  it('ranks a fatality critical and a quiet near-miss as attention', () => {
    expect(alertToneForIncident({ ...base, severity_actual: 'fatality' })).toBe('critical')
    expect(alertToneForIncident(base)).toBe('attention')
  })

  it('escalates on potential when nobody was actually hurt', () => {
    expect(alertToneForIncident({ ...base, severity_potential: 'extreme' })).toBe('critical')
    expect(alertToneForIncident({ ...base, severity_potential: 'high' })).toBe('warning')
  })

  it('treats any spill as at least a warning', () => {
    expect(alertToneForIncident({ ...base, incident_type: 'environmental' })).toBe('warning')
  })
})

// ═══ Classification ════════════════════════════════════════════════════

describe('risk matrix bands', () => {
  it.each([
    ['low',      'low',      'rare',           2,  'low'],
    ['low',      'low',      'almost_certain', 10, 'high'],
    ['moderate', 'moderate', 'rare',           3,  'low'],
    ['high',     'high',     'possible',       12, 'high'],
    ['extreme',  'extreme',  'almost_certain', 25, 'extreme'],
  ])('%s severity × %s probability scores %i and bands as %s',
    (_label, severity, probability, score, band) => {
      const cell = classifyMatrix(severity as never, probability as never)
      expect(cell.score).toBe(score)
      expect(cell.band).toBe(band)
    })

  it('assigns a tighter SLA to a worse band, and none at all to low', () => {
    expect(classifyMatrix('low', 'rare').slaHours).toBeNull()
    expect(classifyMatrix('moderate', 'possible').slaHours).toBe(120)
    expect(classifyMatrix('extreme', 'almost_certain').slaHours).toBe(1)
  })

  it('labels the cell so the stored value survives a band-threshold change', () => {
    expect(classifyMatrix('high', 'likely').cell).toBe('S4xP4_extreme')
  })
})

describe('OSHA recordability — 1904.7 ordering', () => {
  const NO: Parameters<typeof decideRecordability>[0] = {
    is_work_related: true, is_new_case: true,
    resulted_in_death: false, resulted_in_days_away: false,
    resulted_in_restricted_duty: false, loss_of_consciousness: false,
    medical_treatment_beyond_first_aid: false, significant_diagnosed_condition: false,
  }

  it('stops at work-relatedness without walking the rest of the tree', () => {
    const d = decideRecordability({ ...NO, is_work_related: false, resulted_in_death: true })
    expect(d.recordable).toBe(false)
    expect(d.path).toHaveLength(1)
  })

  it('records only the most serious outcome when several apply', () => {
    const d = decideRecordability({
      ...NO, resulted_in_death: true, resulted_in_days_away: true, resulted_in_restricted_duty: true,
    })
    expect(d.classification).toBe('death')
  })

  it('prefers days-away over restricted duty', () => {
    expect(decideRecordability({ ...NO, resulted_in_days_away: true, resulted_in_restricted_duty: true })
      .classification).toBe('days_away')
  })

  it('is not recordable when every outcome question answers no', () => {
    const d = decideRecordability(NO)
    expect(d.recordable).toBe(false)
    expect(d.classification).toBeNull()
    expect(d.path.length).toBeGreaterThan(5)   // the full walk is retained for audit
  })

  it('elevates a mixed treatment list to medical the moment one item is not first aid', () => {
    expect(firstAidVsMedical(['wound_coverings', 'eye_patches'])).toBe('first_aid')
    expect(firstAidVsMedical(['wound_coverings', 'sutures'])).toBe('medical')
    expect(firstAidVsMedical([])).toBe('first_aid')
  })

  it('previews recordability from severity for the intake-time rule filter', () => {
    expect(previewClassificationFromSeverity('none')).toBeNull()
    expect(previewClassificationFromSeverity('first_aid')).toBeNull()
    expect(previewClassificationFromSeverity('medical')).toBe('other_recordable')
    expect(previewClassificationFromSeverity('lost_time')).toBe('days_away')
    expect(previewClassificationFromSeverity('fatality')).toBe('death')
  })
})

// ═══ Receipt PIN ═══════════════════════════════════════════════════════

describe('receipt PIN handling', () => {
  it('matches the code however the worker wrote it down', () => {
    const canonical = hashReceipt('INC-2026-0001', 'AB23CD')
    expect(hashReceipt('INC-2026-0001', ' ab 23 cd ')).toBe(canonical)
  })

  it('binds the PIN to one report — the same code elsewhere resolves nothing', () => {
    expect(hashReceipt('INC-2026-0001', 'AB23CD')).not.toBe(hashReceipt('INC-2026-0002', 'AB23CD'))
  })

  it('rejects the characters excluded to survive handwriting', () => {
    for (const bad of ['ABCDE0', 'ABCDEO', 'ABCDEI', 'ABCDE1', 'ABCDEL']) {
      expect(isValidPinFormat(bad)).toBe(false)
    }
  })

  it('rejects codes of the wrong length', () => {
    expect(isValidPinFormat('AB23C')).toBe(false)
    expect(isValidPinFormat('AB23CDE')).toBe(false)
  })

  it('normalises without mangling an already-clean code', () => {
    expect(normalizePin('AB23CD')).toBe('AB23CD')
  })
})
