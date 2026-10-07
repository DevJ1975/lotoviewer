import { describe, it, expect } from 'vitest'
import type { Permit } from '@/lib/environmental/client'
import {
  blankConditionRow, blankPermitForm, buildPermitRequest, jurisdictionLabel, jurisdictionOptions, permitHealthText,
  permitLabel, permitToForm, renewalDeadline, sortPermitsByUrgency, type PermitFormState,
} from '@/lib/environmental/permitView'

// "Now" is always an input, so every date below is read against this one instant.
const NOW = Date.parse('2026-10-07T12:00:00Z')

const permit = (over: Partial<Permit> = {}): Permit => ({
  id: 'p-1', facility_id: 'site-1', program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: 'CAS000001',
  issuing_agency: 'State Water Board', jurisdiction: 'CA', status: 'active', effective_date: '2024-01-01',
  expiration_date: '2027-01-09', renewal_lead_days: 180, identifiers: {}, conditions: [], document_path: null, notes: null,
  health: 'expiring', ...over,
})

describe('permitHealthText', () => {
  it('counts the days to expiration while the renewal window is open', () => {
    expect(permitHealthText(permit({ health: 'expiring', expiration_date: '2027-01-09' }), NOW)).toBe('Expires in 94 days; renewal window open')
  })

  it('says "today" and "1 day" rather than "0 days" and "1 days"', () => {
    expect(permitHealthText(permit({ health: 'expiring', expiration_date: '2026-10-07' }), NOW)).toBe('Expires today; renewal window open')
    expect(permitHealthText(permit({ health: 'expiring', expiration_date: '2026-10-08' }), NOW)).toBe('Expires in 1 day; renewal window open')
  })

  it('counts how long ago an expired permit lapsed', () => {
    expect(permitHealthText(permit({ health: 'expired', expiration_date: '2026-09-25' }), NOW)).toBe('Expired 12 days ago')
    expect(permitHealthText(permit({ health: 'expired', expiration_date: '2026-10-06' }), NOW)).toBe('Expired 1 day ago')
  })

  it('does not invent a lapse date for a permit marked expired by hand', () => {
    expect(permitHealthText(permit({ health: 'expired', status: 'expired', expiration_date: null }), NOW)).toBe('Marked as expired')
    expect(permitHealthText(permit({ health: 'expired', status: 'expired', expiration_date: '2028-01-01' }), NOW)).toBe('Marked as expired')
  })

  it('says when the renewal window will open for a permit that is comfortably in force', () => {
    expect(permitHealthText(permit({ health: 'active', expiration_date: '2027-10-07' }), NOW)).toBe('Expires in 365 days; renewal window opens in 185 days')
  })

  it('says so, and not "0 days", for a permit that does not expire', () => {
    expect(permitHealthText(permit({ health: 'active', expiration_date: null }), NOW)).toBe('No expiration date')
  })

  it('explains why a permit that is not in force is not tracked', () => {
    expect(permitHealthText(permit({ health: 'not_tracked', status: 'draft' }), NOW)).toBe('Not tracked: status is draft')
    expect(permitHealthText(permit({ health: 'not_tracked', status: 'application_pending' }), NOW)).toBe('Not tracked: status is application pending')
  })

  it('reads the same for the same instant, and moves with it', () => {
    const p = permit({ health: 'expiring', expiration_date: '2027-01-09' })
    expect(permitHealthText(p, NOW)).toBe(permitHealthText(p, NOW))
    expect(permitHealthText(p, NOW + 24 * 60 * 60 * 1000)).toBe('Expires in 93 days; renewal window open')
  })
})

describe('renewalDeadline', () => {
  it('is the expiration date less the renewal lead time', () => {
    expect(renewalDeadline(permit({ expiration_date: '2027-01-09', renewal_lead_days: 180 }))).toBe('2026-07-13')
    expect(renewalDeadline(permit({ expiration_date: '2027-01-09', renewal_lead_days: 0 }))).toBe('2027-01-09')
  })

  it('is null when the permit has no expiration date', () => {
    expect(renewalDeadline(permit({ expiration_date: null }))).toBeNull()
  })

  it('is null for a permit that is not in force, as the calendar has no deadline for it', () => {
    expect(renewalDeadline(permit({ status: 'draft' }))).toBeNull()
    expect(renewalDeadline(permit({ status: 'terminated' }))).toBeNull()
  })
})

describe('sortPermitsByUrgency', () => {
  const expired = permit({ id: 'a', permit_number: 'A', health: 'expired', expiration_date: '2026-09-25' })
  const expiring = permit({ id: 'b', permit_number: 'B', health: 'expiring', expiration_date: '2027-01-09' })
  const activeSoon = permit({ id: 'c', permit_number: 'C', health: 'active', expiration_date: '2027-10-07' })
  const activeLater = permit({ id: 'd', permit_number: 'D', health: 'active', expiration_date: '2029-01-01' })
  const activeNever = permit({ id: 'e', permit_number: 'E', health: 'active', expiration_date: null })
  const notTracked = permit({ id: 'f', permit_number: 'F', health: 'not_tracked', status: 'draft', expiration_date: '2026-01-01' })

  it('puts expired first, then expiring, then active, then not tracked', () => {
    const sorted = sortPermitsByUrgency([notTracked, activeSoon, expiring, expired])
    expect(sorted.map(p => p.id)).toEqual(['a', 'b', 'c', 'f'])
  })

  it('orders within a state by the soonest expiration, and a permit that never expires last', () => {
    expect(sortPermitsByUrgency([activeNever, activeLater, activeSoon]).map(p => p.id)).toEqual(['c', 'd', 'e'])
  })

  it('puts the longest-lapsed first among expired permits', () => {
    const longAgo = permit({ id: 'x', permit_number: 'X', health: 'expired', expiration_date: '2025-01-01' })
    expect(sortPermitsByUrgency([expired, longAgo]).map(p => p.id)).toEqual(['x', 'a'])
  })

  it('breaks a tie by name, the same way every time, without changing the input', () => {
    const input = [permit({ id: '2', permit_number: 'ZZ' }), permit({ id: '1', permit_number: 'AA' })]
    expect(sortPermitsByUrgency(input).map(p => p.id)).toEqual(['1', '2'])
    expect(input.map(p => p.id)).toEqual(['2', '1'])
  })
})

describe('labels', () => {
  it('names a permit by its type and number, or its type alone', () => {
    expect(permitLabel(permit())).toBe('Industrial General Permit CAS000001')
    expect(permitLabel(permit({ permit_number: null }))).toBe('Industrial General Permit')
  })

  it('names the jurisdiction, and has nothing to say when there is none', () => {
    expect(jurisdictionLabel('federal')).toBe('Federal')
    expect(jurisdictionLabel('TX')).toBe('State (TX)')
    expect(jurisdictionLabel(null)).toBeNull()
  })
})

describe('jurisdictionOptions', () => {
  it('offers federal and the site\'s state', () => {
    expect(jurisdictionOptions('TX', '')).toEqual([
      { value: '', label: 'Not specified' }, { value: 'federal', label: 'Federal' }, { value: 'TX', label: 'State (TX)' },
    ])
  })

  it('offers only federal when the site has no state', () => {
    expect(jurisdictionOptions(null, '').map(o => o.value)).toEqual(['', 'federal'])
  })

  it('keeps the value a permit already has, so editing it does not change it', () => {
    expect(jurisdictionOptions('TX', 'CA').map(o => o.value)).toEqual(['', 'federal', 'TX', 'CA'])
    expect(jurisdictionOptions('TX', 'TX').map(o => o.value)).toEqual(['', 'federal', 'TX'])
  })
})

describe('the form', () => {
  const filled = (over: Partial<PermitFormState> = {}): PermitFormState => ({
    ...blankPermitForm(), program: 'stormwater', permitType: 'Industrial General Permit', ...over,
  })

  it('starts as an active permit with the standard 180-day lead time and no program chosen', () => {
    expect(blankPermitForm()).toMatchObject({ program: '', status: 'active', renewalLeadDays: '180', identifiers: [], conditions: [], documentPath: null })
  })

  it('builds the request: trimmed text, blanks as null, the lead time as a number', () => {
    const result = buildPermitRequest(filled({
      permitType: '  Industrial General Permit ', permitNumber: ' CAS000001 ', issuingAgency: '  ', jurisdiction: 'CA',
      effectiveDate: '2024-01-01', expirationDate: '2027-01-09', renewalLeadDays: ' 120 ', notes: '  see binder  ', documentPath: 'tenant/permits/a.pdf',
    }))
    expect(result).toEqual({
      ok: true,
      body: {
        program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: 'CAS000001', issuing_agency: null,
        jurisdiction: 'CA', status: 'active', effective_date: '2024-01-01', expiration_date: '2027-01-09', renewal_lead_days: 120,
        identifiers: {}, conditions: [], document_path: 'tenant/permits/a.pdf', notes: 'see binder',
      },
    })
  })

  it('clears a date or a field that was emptied, so an edit can remove what was there', () => {
    const result = buildPermitRequest(filled({ permitNumber: '', expirationDate: '', jurisdiction: '', notes: '' }))
    expect(result).toMatchObject({ ok: true, body: { permit_number: null, expiration_date: null, jurisdiction: null, notes: null } })
  })

  it('trims identifiers and conditions, drops blank rows and keeps the ids it was given', () => {
    const result = buildPermitRequest(filled({
      identifiers: [{ name: ' WDID ', value: ' 2 15I012345 ' }, { name: '', value: '' }, { name: '  ', value: ' ' }],
      conditions: [
        { id: 'c-1', text: ' Sample quarterly ', frequency: ' Quarterly ', reference: ' Part III.A ' },
        { id: 'c-2', text: '', frequency: '', reference: '' },
        { id: 'c-3', text: 'Keep the SWPPP current', frequency: '', reference: '' },
      ],
    }))
    expect(result).toMatchObject({
      ok: true,
      body: {
        identifiers: { WDID: '2 15I012345' },
        conditions: [
          { id: 'c-1', text: 'Sample quarterly', frequency: 'Quarterly', ref: 'Part III.A' },
          { id: 'c-3', text: 'Keep the SWPPP current' },
        ],
      },
    })
    // A condition with no frequency or reference sends neither key, not empty strings.
    expect(result.ok && Object.keys(result.body.conditions[1]!)).toEqual(['id', 'text'])
  })

  it('refuses a request with no program, saying so', () => {
    expect(buildPermitRequest(filled({ program: '' }))).toEqual({ ok: false, errors: ['Choose a program.'] })
  })

  it.each(['', '  ', 'abc', '12.5', '-3'])('refuses a renewal lead time of "%s" that is not a whole number of days', lead => {
    expect(buildPermitRequest(filled({ renewalLeadDays: lead }))).toEqual({ ok: false, errors: ['Renewal lead time must be a whole number of days.'] })
  })

  it('leaves the range of the lead time to the API', () => {
    expect(buildPermitRequest(filled({ renewalLeadDays: '5000' }))).toMatchObject({ ok: true, body: { renewal_lead_days: 5000 } })
  })

  it('points at the identifier row that has only half an entry, by its position', () => {
    const half = buildPermitRequest(filled({ identifiers: [{ name: 'WDID', value: '1' }, { name: 'NPDES ID', value: '' }, { name: '', value: 'x' }] }))
    expect(half).toEqual({ ok: false, errors: ['Identifier 2 needs both a name and a value.', 'Identifier 3 needs both a name and a value.'] })
  })

  it('refuses an identifier name used twice, once, rather than silently keeping the last', () => {
    const rows = [{ name: 'WDID', value: '1' }, { name: ' WDID', value: '2' }, { name: 'WDID', value: '3' }]
    expect(buildPermitRequest(filled({ identifiers: rows }))).toEqual({ ok: false, errors: ['The identifier name "WDID" is used more than once.'] })
  })

  it('points at a condition that has a frequency or reference but no text, and lets a wholly blank one go', () => {
    const result = buildPermitRequest(filled({
      conditions: [blankConditionRow('c-1'), { id: 'c-2', text: '', frequency: 'Monthly', reference: '' }, { id: 'c-3', text: ' ', frequency: '', reference: 'Part IV' }],
    }))
    expect(result).toEqual({ ok: false, errors: ['Condition 2 needs text.', 'Condition 3 needs text.'] })
    expect(buildPermitRequest(filled({ conditions: [blankConditionRow('c-1')] }))).toMatchObject({ ok: true, body: { conditions: [] } })
  })

  it('reports every problem at once, so the form is fixed in one pass', () => {
    const result = buildPermitRequest(filled({ program: '', renewalLeadDays: 'x', identifiers: [{ name: 'a', value: '' }] }))
    expect(result.ok === false && result.errors).toHaveLength(3)
  })

  it('shows a stored permit in the form and sends back what it was, ids and all', () => {
    const stored = permit({
      permit_number: null, issuing_agency: null, jurisdiction: 'federal', expiration_date: '2027-01-09', document_path: 'tenant/permits/a.pdf',
      identifiers: { WDID: '2 15I012345' },
      conditions: [{ id: 'c-1', text: 'Sample quarterly', frequency: 'Quarterly', ref: 'Part III.A' }, { id: 'c-2', text: 'Keep the SWPPP current' }],
      notes: 'see binder',
    })
    const form = permitToForm(stored)
    expect(form).toMatchObject({ permitNumber: '', issuingAgency: '', jurisdiction: 'federal', renewalLeadDays: '180' })
    expect(form.conditions[1]).toEqual({ id: 'c-2', text: 'Keep the SWPPP current', frequency: '', reference: '' })
    expect(buildPermitRequest(form)).toEqual({
      ok: true,
      body: {
        program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: null, issuing_agency: null, jurisdiction: 'federal',
        status: 'active', effective_date: '2024-01-01', expiration_date: '2027-01-09', renewal_lead_days: 180,
        identifiers: { WDID: '2 15I012345' }, conditions: stored.conditions, document_path: 'tenant/permits/a.pdf', notes: 'see binder',
      },
    })
  })

  it('gives a new condition the id it is handed, and no text', () => {
    expect(blankConditionRow('c-9')).toEqual({ id: 'c-9', text: '', frequency: '', reference: '' })
  })
})
