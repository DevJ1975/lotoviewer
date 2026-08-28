// End-to-end scenarios for the incident reporter.
//
// "End-to-end" here means each test starts from a real reporter action
// — a supervisor filling /incidents/new, a worker scanning the QR sign
// on Dock B — and drives every layer that action touches: the shared
// validator the form calls before it posts, the route handler, the
// constraints the incidents table would enforce, the command-centre
// alert, the notification rules engine, and the rows written to the
// audit log. No browser is driven; the harness stands in for Postgres
// and enforces the same CHECK constraints migrations 059/067 declare,
// so a route that would be rejected by the database is rejected here.
//
// Each `it()` reads as a story: reporter does X, the system should
// reach state Y. When one breaks, it names the step that broke.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ADMIN_ID,
  ANON_TOKEN,
  MEMBER_ID,
  TENANT_ID,
  anonRequest,
  gateRejects,
  intakeRequest,
  resetHarness,
  rowsIn,
  seed,
  seedAnonToken,
  seedTenantWithEmailRule,
  sendIncidentAlertEmailMock,
  signedUploadPaths,
  statusRequest,
  verifyTurnstileMock,
} from './_incidentReporterHarness'
import {
  formatIncidentGeo,
  validateCreateInput,
  type IncidentCreateInput,
} from '@soteria/core/incident'
import { hashReceipt } from '@/lib/anonReport/receipt'

const importIntake = () => import('@/app/api/incidents/route')
const importAnon   = () => import('@/app/api/anonymous-report/route')
const importStatus = () => import('@/app/api/anonymous-report/status/route')

// An hour ago, in the ISO shape both intake forms build.
function anHourAgo(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  resetHarness()
  seedTenantWithEmailRule()
  seedAnonToken()
})

// ─── Scenario 1: a supervisor files an injury from the shop floor ────────
//
// The highest-consequence path in the module. Everything downstream —
// OSHA classification, the care case, the investigation SLA — hangs off
// this row existing and being correct.

describe('E2E — supervisor files an injury on /incidents/new', () => {
  const injury: Partial<IncidentCreateInput> = {
    incident_type:          'injury_illness',
    occurred_at:            anHourAgo(),
    description:            'Operator caught a hand between the roller and the guard while clearing a jam.',
    location_text:          'Line 3 packaging',
    shift:                  'day',
    immediate_action_taken: 'Line de-energised, first aid applied, EMS called.',
    severity_actual:        'medical',
    severity_potential:     'high',
    probability:            'possible',
  }

  it('the form validator clears the payload the page is about to post', () => {
    // The page runs this before it ever hits the network — if it
    // disagrees with the route, the reporter sees a 400 they could
    // have been warned about locally.
    expect(validateCreateInput(injury)).toBeNull()
  })

  it('files the report and returns 201 with a tenant-scoped report number', async () => {
    const { POST } = await importIntake()
    const res = await POST(intakeRequest(injury))
    expect(res.status).toBe(201)

    const { report } = await res.json()
    expect(report.report_number).toMatch(/^INC-\d{4}-0001$/)
    expect(report.status).toBe('reported')
    expect(report.tenant_id).toBe(TENANT_ID)
  })

  it('attributes the row to the filer and marks it non-anonymous', async () => {
    const { POST } = await importIntake()
    await POST(intakeRequest(injury))

    const [row] = rowsIn('incidents')
    expect(row.reported_by).toBe(MEMBER_ID)
    expect(row.is_anonymous).toBe(false)
    // Migration 067's CHECK pairs these two; the harness would have
    // rejected the insert if the route had set them inconsistently.
  })

  it('trims the narrative and preserves the reporter’s own words', async () => {
    const { POST } = await importIntake()
    await POST(intakeRequest({ ...injury, description: `   ${injury.description}   ` }))
    expect(rowsIn('incidents')[0].description).toBe(injury.description)
  })

  it('raises a command-centre alert the safety desk can triage', async () => {
    const { POST } = await importIntake()
    await POST(intakeRequest(injury))

    const [alert] = rowsIn('command_center_safety_alerts')
    expect(alert.source).toBe('incident_submitted')
    expect(alert.status).toBe('new')
    expect(alert.title).toBe('Injury / illness submitted')
    // 'medical' severity is a warning, not a critical page-out.
    expect(alert.severity_tone).toBe('warning')
    expect(alert.summary).toContain('Line 3 packaging')
  })

  it('emails the tenant admin and logs what was sent', async () => {
    const { POST } = await importIntake()
    await POST(intakeRequest(injury))

    expect(sendIncidentAlertEmailMock).toHaveBeenCalledTimes(1)
    const sent = sendIncidentAlertEmailMock.mock.calls[0][0]
    expect(sent.to).toBe('safety.lead@example.test')
    expect(sent.ruleName).toBe('Notify safety leads')

    const [log] = rowsIn('incident_notifications')
    expect(log).toMatchObject({
      channel:         'email',
      trigger_type:    'initial',
      status:          'sent',
      recipient_email: 'safety.lead@example.test',
      recipient_user_id: ADMIN_ID,
    })
  })

  it('still returns 201 when the mail provider is down', async () => {
    // A flaky provider must never cost us the safety report.
    sendIncidentAlertEmailMock.mockResolvedValue(false)
    const { POST } = await importIntake()
    const res = await POST(intakeRequest(injury))

    expect(res.status).toBe(201)
    expect(rowsIn('incidents')).toHaveLength(1)
    expect(rowsIn('incident_notifications')[0].status).toBe('failed')
  })

  it('turns a signed-out reporter away before touching the database', async () => {
    gateRejects(401, 'Not a member of this tenant')
    const { POST } = await importIntake()
    const res = await POST(intakeRequest(injury))

    expect(res.status).toBe(401)
    expect(rowsIn('incidents')).toHaveLength(0)
  })
})

// ─── Scenario 2: near-miss numbering and the near-miss invariant ─────────

describe('E2E — a second report in the same tenant', () => {
  it('increments the per-tenant counter rather than restarting it', async () => {
    const { POST } = await importIntake()
    await POST(intakeRequest({
      incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Pallet slipped off the forks, nobody underneath.',
    }))
    const second = await POST(intakeRequest({
      incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Unsecured ladder shifted while in use.',
    }))

    const { report } = await second.json()
    expect(report.report_number).toMatch(/^INC-\d{4}-0002$/)
  })

  it('refuses a near-miss that reports an injury', async () => {
    // A hurt worker is not a near miss; accepting it here would
    // silently drop the case out of the OSHA log.
    const { POST } = await importIntake()
    const res = await POST(intakeRequest({
      incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Worker was struck by the load.', severity_actual: 'lost_time',
    }))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/escalate to injury_illness/)
    expect(rowsIn('incidents')).toHaveLength(0)
  })
})

// ─── Scenario 3: the worker who scans the sign on Dock B ─────────────────
//
// The anonymous path is the one a worker uses when they don't want to
// be named — the reason the module exists for a lot of tenants. It has
// to reach the same place as the authenticated path.

describe('E2E — anonymous report from the QR sign', () => {
  const typed = {
    token:         ANON_TOKEN,
    incident_type: 'property_damage',
    occurred_at:   anHourAgo(),
    description:   'Reach truck clipped the racking upright at the end of aisle 7.',
  }

  it('files under the token’s tenant with no reporter attached', async () => {
    const { POST } = await importAnon()
    const res = await POST(anonRequest(typed))
    expect(res.status).toBe(201)

    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.report_number).toMatch(/^INC-\d{4}-0001$/)

    const [row] = rowsIn('incidents')
    expect(row.tenant_id).toBe(TENANT_ID)
    expect(row.is_anonymous).toBe(true)
    expect(row.reported_by).toBeNull()
    expect(row.anon_token_id).toBe('token-1')
  })

  it('falls back to the sign’s label when the worker leaves location blank', async () => {
    const { POST } = await importAnon()
    await POST(anonRequest(typed))
    expect(rowsIn('incidents')[0].location_text).toBe('Dock B entrance')
  })

  it('bumps the sign’s usage counter so admins can see it is being used', async () => {
    const { POST } = await importAnon()
    await POST(anonRequest(typed))

    const [token] = rowsIn('incident_anon_intake_tokens')
    expect(token.total_reports).toBe(1)
    expect(token.last_used_at).toEqual(expect.any(String))
  })

  it('notifies the same admin the authenticated path would have', async () => {
    const { POST } = await importAnon()
    await POST(anonRequest(typed))

    expect(sendIncidentAlertEmailMock).toHaveBeenCalledTimes(1)
    const sent = sendIncidentAlertEmailMock.mock.calls[0][0]
    expect(sent.to).toBe('safety.lead@example.test')
    // No reporter identity may reach the email.
    expect(sent.triggeredBy).toBeNull()
  })

  it('rejects a disabled sign without revealing that the token exists', async () => {
    seedAnonToken({ enabled: false })
    const { POST } = await importAnon()
    const res = await POST(anonRequest(typed))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Token is invalid or disabled')
    expect(rowsIn('incidents')).toHaveLength(0)
  })

  it('turns away a failed captcha when the sign requires one', async () => {
    seedAnonToken({ require_captcha: true })
    verifyTurnstileMock.mockResolvedValue({ ok: false })
    const { POST } = await importAnon()
    const res = await POST(anonRequest({ ...typed, turnstile_token: 'stale' }))

    expect(res.status).toBe(400)
    expect(rowsIn('incidents')).toHaveLength(0)
  })

  it('enforces the sign’s hourly cap once it is reached', async () => {
    seedAnonToken({ rate_limit_per_hour: 1 })
    const { POST } = await importAnon()

    expect((await POST(anonRequest(typed))).status).toBe(201)
    const second = await POST(anonRequest(typed))
    expect(second.status).toBe(429)
    expect(rowsIn('incidents')).toHaveLength(1)
  })
})

// ─── Scenario 4: the severity-only quick tap ─────────────────────────────
//
// A worker in gloves, at a sign, with no keyboard patience: tap a
// coloured chip and walk away. It is the lowest-friction report the
// product offers and the one most likely to be a worker's first ever.

describe('E2E — quick-tap severity report with no narrative', () => {
  const quickTap = {
    token:          ANON_TOKEN,
    occurred_at:    anHourAgo(),
    incident_type:  'near_miss',
    severity_quick: 'red',
    description:    '',
  }

  it('files successfully with no typed description', async () => {
    const { POST } = await importAnon()
    const res = await POST(anonRequest(quickTap))
    expect(res.status).toBe(201)
    expect(rowsIn('incidents')).toHaveLength(1)
  })

  it('records the chip as severity_potential and leaves actual at none', async () => {
    const { POST } = await importAnon()
    await POST(anonRequest(quickTap))

    const [row] = rowsIn('incidents')
    expect(row.severity_potential).toBe('high')   // red
    expect(row.severity_actual).toBe('none')      // set at triage, not by the reporter
  })

  it('stands in a marker narrative so downstream readers are not handed an empty string', async () => {
    const { POST } = await importAnon()
    await POST(anonRequest(quickTap))
    expect(rowsIn('incidents')[0].description).toBe('[severity:red] (no narrative provided)')
  })

  it('keeps a typed narrative when the worker provided one alongside the chip', async () => {
    const { POST } = await importAnon()
    await POST(anonRequest({ ...quickTap, severity_quick: 'amber', description: 'Puddle by the charger.' }))

    const [row] = rowsIn('incidents')
    expect(row.description).toBe('Puddle by the charger.')
    expect(row.severity_potential).toBe('moderate')
  })
})

// ─── Scenario 5: receipt PIN round trip ─────────────────────────────────
//
// An anonymous reporter has no account to log into. The PIN is the
// only way they ever learn whether anyone acted on what they filed —
// if this loop does not close, the anonymity promise is one-way.

describe('E2E — anonymous reporter checks back on their report', () => {
  const withPin = {
    token:         ANON_TOKEN,
    incident_type: 'environmental',
    occurred_at:   anHourAgo(),
    description:   'Hydraulic oil pooling under the compactor.',
    request_pin:   true,
  }

  it('hands back a PIN and stores only its hash', async () => {
    const { POST } = await importAnon()
    const res = await POST(anonRequest(withPin))
    const { receipt_pin, report_number } = await res.json()

    expect(receipt_pin).toMatch(/^[A-Z2-9]{6}$/)
    const [row] = rowsIn('incidents')
    expect(row.anon_receipt_hash).toBe(hashReceipt(report_number, receipt_pin))
    // The PIN itself is never persisted.
    expect(JSON.stringify(row)).not.toContain(receipt_pin)
  })

  it('resolves the report later from (report number, PIN)', async () => {
    const { POST: submit } = await importAnon()
    const filed = await (await submit(anonRequest(withPin))).json()

    const { POST: lookup } = await importStatus()
    const res = await lookup(statusRequest({
      report_number: filed.report_number,
      pin:           filed.receipt_pin,
    }))

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('reported')
  })

  it('resolves it just as well when the worker types the code in lower case', async () => {
    const { POST: submit } = await importAnon()
    const filed = await (await submit(anonRequest(withPin))).json()

    const { POST: lookup } = await importStatus()
    const res = await lookup(statusRequest({
      report_number: String(filed.report_number).toLowerCase(),
      pin:           String(filed.receipt_pin).toLowerCase(),
    }))

    expect(res.status).toBe(200)
  })

  it('refuses a wrong PIN with the same answer it gives an unknown report', async () => {
    const { POST: submit } = await importAnon()
    const filed = await (await submit(anonRequest(withPin))).json()

    const { POST: lookup } = await importStatus()
    const wrongPin = await lookup(statusRequest({ report_number: filed.report_number, pin: 'ZZZZZZ' }))
    const noSuchReport = await lookup(statusRequest({ report_number: 'INC-2026-9999', pin: 'ZZZZZZ' }))

    expect(wrongPin.status).toBe(404)
    expect(await wrongPin.json()).toEqual(await noSuchReport.json())
  })

  it('omits the PIN entirely when the reporter did not ask for one', async () => {
    const { POST } = await importAnon()
    const res = await POST(anonRequest({ ...withPin, request_pin: false }))

    expect((await res.json()).receipt_pin).toBeNull()
    expect(rowsIn('incidents')[0].anon_receipt_hash).toBeUndefined()
  })
})

// ─── Scenario 6: is the reporter actually at the sign? ──────────────────
//
// A QR sign lives at a fixed place, so a report that arrives from ten
// kilometres away is worth a second look. The rule is flag, never
// reject: a worker who denied location permission, or who reports from
// the car park after their shift, still gets their report filed.

describe('E2E — geofence on a sited QR token', () => {
  const DOCK_B = { lat: 40.7128, lng: -74.0060 }

  const sited = () => seedAnonToken({
    site_geo_lat: DOCK_B.lat, site_geo_lng: DOCK_B.lng, geofence_radius_m: 200,
  })

  const report = (locationGeo?: string) => ({
    token: ANON_TOKEN, incident_type: 'near_miss', occurred_at: anHourAgo(),
    description: 'Chock missing from the trailer wheel.',
    ...(locationGeo ? { location_geo: locationGeo } : {}),
  })

  it('clears a report filed from the dock itself', async () => {
    sited()
    const { POST } = await importAnon()
    // ~14 m from the sign.
    await POST(anonRequest(report(formatIncidentGeo({ lat: 40.7129, lng: -74.0061 }))))

    expect(rowsIn('incidents')[0].geo_mismatch).toBe(false)
  })

  it('flags a report filed ten kilometres away', async () => {
    sited()
    const { POST } = await importAnon()
    await POST(anonRequest(report(formatIncidentGeo({ lat: 40.8000, lng: -74.0060 }))))

    const [row] = rowsIn('incidents')
    expect(row.geo_mismatch).toBe(true)
    // Flagged, not blocked — the report is still on file.
    expect(row.description).toBe('Chock missing from the trailer wheel.')
  })

  it('leaves the flag unset when the phone gave no location', async () => {
    sited()
    const { POST } = await importAnon()
    await POST(anonRequest(report()))

    expect(rowsIn('incidents')[0].geo_mismatch).toBeNull()
  })

  it('leaves the flag unset when the sign has no coordinates configured', async () => {
    const { POST } = await importAnon()
    await POST(anonRequest(report(formatIncidentGeo(DOCK_B))))

    expect(rowsIn('incidents')[0].geo_mismatch).toBeNull()
  })

  it('rejects a malformed point instead of letting Postgres choke on it', async () => {
    sited()
    const { POST } = await importAnon()
    const res = await POST(anonRequest(report('40.7128,-74.0060')))

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/location_geo/)
    expect(rowsIn('incidents')).toHaveLength(0)
  })
})

// ─── Scenario 7: photo attachments from a phone ─────────────────────────

describe('E2E — anonymous reporter attaches photos', () => {
  it('mints one scoped upload target per requested attachment', async () => {
    const { POST } = await importAnon()
    const res = await POST(anonRequest({
      token: ANON_TOKEN, incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Guard missing from the bench grinder.', request_uploads: 2,
    }))

    const { uploads, incident_id } = await res.json()
    expect(uploads).toHaveLength(2)
    for (const path of signedUploadPaths) {
      expect(path).toContain(TENANT_ID)
      expect(path).toContain(incident_id)
    }
  })

  it('caps the number of upload targets a caller can request', async () => {
    const { POST } = await importAnon()
    const res = await POST(anonRequest({
      token: ANON_TOKEN, incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Guard missing from the bench grinder.', request_uploads: 99,
    }))

    expect((await res.json()).uploads).toHaveLength(4)
  })
})

// ─── Scenario 8: both doors, one rulebook ───────────────────────────────
//
// Which door a worker walked through must not change who gets paged.

describe('E2E — notification rules apply identically to both intake paths', () => {
  const severeRule = {
    id:                       'rule-severe',
    match_severity_potential: ['extreme'],
    name:                     'Page the duty manager on extreme potential',
  }

  it('a rule scoped to extreme potential stays silent for a moderate report on either path', async () => {
    seedTenantWithEmailRule({ rule: severeRule })

    const { POST: authed } = await importIntake()
    await authed(intakeRequest({
      incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Tripped on a trailing cable.', severity_potential: 'moderate',
    }))
    const authedSends = sendIncidentAlertEmailMock.mock.calls.length

    const { POST: anon } = await importAnon()
    await anon(anonRequest({
      token: ANON_TOKEN, incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Tripped on a trailing cable.', severity_potential: 'moderate',
    }))

    expect(authedSends).toBe(0)
    expect(sendIncidentAlertEmailMock).not.toHaveBeenCalled()
  })

  it('the same rule fires on both paths when the potential is extreme', async () => {
    seedTenantWithEmailRule({ rule: severeRule })

    const { POST: authed } = await importIntake()
    await authed(intakeRequest({
      incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Load swung over the walkway.', severity_potential: 'extreme',
    }))
    expect(sendIncidentAlertEmailMock).toHaveBeenCalledTimes(1)

    const { POST: anon } = await importAnon()
    await anon(anonRequest({
      token: ANON_TOKEN, incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Load swung over the walkway.', severity_potential: 'extreme',
    }))
    expect(sendIncidentAlertEmailMock).toHaveBeenCalledTimes(2)
  })

  it('a recordable-only rule ignores a first-aid case on both paths', async () => {
    seedTenantWithEmailRule({ rule: { id: 'rule-recordable', match_recordable: true, name: 'OSHA recordables' } })

    const { POST: authed } = await importIntake()
    await authed(intakeRequest({
      incident_type: 'injury_illness', occurred_at: anHourAgo(),
      description: 'Small cut, plaster applied.', severity_actual: 'first_aid',
    }))

    const { POST: anon } = await importAnon()
    await anon(anonRequest({
      token: ANON_TOKEN, incident_type: 'injury_illness', occurred_at: anHourAgo(),
      description: 'Small cut, plaster applied.', severity_actual: 'first_aid',
    }))

    expect(sendIncidentAlertEmailMock).not.toHaveBeenCalled()
  })

  it('sends one email when an admin is named by role and by user id', async () => {
    seed('incident_notification_rules', [{
      id: 'rule-double', tenant_id: TENANT_ID, name: 'Safety leads', enabled: true,
      match_incident_type: null, match_severity_actual: null, match_severity_potential: null,
      match_recordable: null,
      notify_roles: ['admin'], notify_user_ids: [ADMIN_ID], notify_emails: null,
      channels: ['email'], escalation_minutes: null,
    }])

    const { POST } = await importIntake()
    await POST(intakeRequest({
      incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Spill by the charger bay.',
    }))

    expect(sendIncidentAlertEmailMock).toHaveBeenCalledTimes(1)
    expect(rowsIn('incident_notifications')).toHaveLength(1)
  })

  it('sends one email when an operator also types that admin’s address into the rule', async () => {
    // The same inbox reached two ways is still one inbox — and one
    // row in the notification log the operator reads afterwards.
    seed('incident_notification_rules', [{
      id: 'rule-double', tenant_id: TENANT_ID, name: 'Safety leads', enabled: true,
      match_incident_type: null, match_severity_actual: null, match_severity_potential: null,
      match_recordable: null,
      notify_roles: ['admin'], notify_user_ids: null,
      notify_emails: ['Safety.Lead@example.test'],   // same address, different case
      channels: ['email'], escalation_minutes: null,
    }])

    const { POST } = await importIntake()
    await POST(intakeRequest({
      incident_type: 'near_miss', occurred_at: anHourAgo(),
      description: 'Spill by the charger bay.',
    }))

    expect(sendIncidentAlertEmailMock).toHaveBeenCalledTimes(1)
    expect(rowsIn('incident_notifications')).toHaveLength(1)
  })
})
