import { describe, it, expect } from 'vitest'
import {
  MANIFEST_ACTIONS, MANIFEST_STATUSES, manifestReturnClock, type ManifestDraftFields, type ManifestJurisdiction, type ManifestStatus,
} from '@soteria/core/hazardousWasteManifest'
import {
  CONTAINER_STATUS_LABEL, EMPTY_MANIFEST_FORM, MANIFEST_ACTION_CONFIRM_LABEL, MANIFEST_ACTION_DATE_LABEL, MANIFEST_ACTION_LABEL,
  MANIFEST_FORM_API_FIELD, MANIFEST_STAGE_LABEL, MANIFEST_STAGE_TONE, MANIFEST_STATUS_LABEL, canModifyManifest, clockChipText,
  containerEffectText, formatDay, jurisdictionLabel, manifestFormDefaults, manifestFormFromRow, manifestFormToBody, splitWasteCodes,
  timelineEntries, todayLocal,
} from '@/lib/hazardousWasteManifestView'

const chipFor = (over: { status?: ManifestStatus; generator_category?: 'lqg' | 'sqg' | 'vsqg'; jurisdiction?: ManifestJurisdiction; days?: number }) => {
  const generator_category = over.generator_category ?? 'lqg'
  const jurisdiction = over.jurisdiction ?? 'federal'
  const now = new Date(Date.parse('2026-03-01T12:00:00Z') + (over.days ?? 0) * 86_400_000)
  const clock = manifestReturnClock({
    generatorCategory: generator_category, jurisdiction, status: over.status ?? 'shipped', shippedOn: '2026-03-01',
    completedOn: null, exceptionReportedOn: null, now,
  })
  return clockChipText({ clock, generator_category, jurisdiction })
}

describe('clockChipText', () => {
  it('reads "Day N of 45" for an LQG while the clock runs, with the stage in words', () => {
    expect(chipFor({ days: 10 })).toBe('Day 10 of 45 · On track')
    expect(chipFor({ days: 36 })).toBe('Day 36 of 45 · Follow up now')
    expect(chipFor({ days: 45 })).toBe('Day 45 of 45 · Exception report due')
    expect(chipFor({ days: 52 })).toBe('Day 52 of 45 · Exception report due')
  })

  it('counts toward 60 for a small quantity generator, and for a California VSQG', () => {
    expect(chipFor({ generator_category: 'sqg', days: 20 })).toBe('Day 20 of 60 · On track')
    expect(chipFor({ generator_category: 'vsqg', jurisdiction: 'state:CA', days: 61 })).toBe('Day 61 of 60 · Exception report due')
  })

  it('names the stage alone once the clock has stopped or never applied', () => {
    expect(chipFor({ status: 'draft' })).toBe('Draft')
    expect(chipFor({ status: 'completed', days: 30 })).toBe('Signed copy received')
    expect(chipFor({ status: 'exception_reported', days: 50 })).toBe('Exception report filed')
    expect(chipFor({ status: 'cancelled' })).toBe('Cancelled')
    expect(chipFor({ generator_category: 'vsqg', days: 50 })).toBe('No return clock')
  })
})

describe('containerEffectText', () => {
  it('says exactly what each action does to the containers', () => {
    expect(containerEffectText('ship', 3)).toBe('The 3 containers stay In shipment.')
    expect(containerEffectText('file_exception', 2)).toBe('The 2 containers stay In shipment.')
    expect(containerEffectText('receive', 2)).toBe('The 2 containers become Disposed and leave the active container list.')
    expect(containerEffectText('cancel', 4)).toBe('The 4 containers go back to Closed and can go on another manifest.')
  })

  it('agrees with one container', () => {
    expect(containerEffectText('ship', 1)).toBe('The 1 container stays In shipment.')
    expect(containerEffectText('receive', 1)).toBe('The 1 container becomes Disposed and leaves the active container list.')
    expect(containerEffectText('cancel', 1)).toBe('The 1 container goes back to Closed and can go on another manifest.')
  })
})

describe('labels are complete', () => {
  it('has a label and a tone for every status, stage and action, so a new one cannot ship unlabelled', () => {
    expect(Object.keys(MANIFEST_STATUS_LABEL).sort()).toEqual([...MANIFEST_STATUSES].sort())
    for (const action of MANIFEST_ACTIONS) {
      expect(MANIFEST_ACTION_LABEL[action], action).toBeTruthy()
      expect(MANIFEST_ACTION_CONFIRM_LABEL[action], action).toBeTruthy()
      expect(MANIFEST_ACTION_CONFIRM_LABEL[action]).not.toBe(MANIFEST_ACTION_LABEL[action])
    }
    expect(Object.keys(MANIFEST_STAGE_LABEL).sort()).toEqual(Object.keys(MANIFEST_STAGE_TONE).sort())
    expect(Object.keys(CONTAINER_STATUS_LABEL).sort()).toEqual(['closed', 'disposed', 'in_shipment', 'open'])
  })

  it('asks for a date on exactly the actions that fill one', () => {
    expect(MANIFEST_ACTIONS.filter(a => MANIFEST_ACTION_DATE_LABEL[a] !== null)).toEqual(['ship', 'receive', 'file_exception'])
  })
})

describe('canModifyManifest', () => {
  it.each([
    ['owner', 'u2', 'u1', true], ['admin', 'u2', 'u1', true], ['superadmin', 'u2', 'u1', true],
    ['member', 'u1', 'u1', true], ['member', 'u2', 'u1', false], ['viewer', 'u2', 'u1', false], ['viewer', 'u1', 'u1', true],
    ['member', 'u1', null, false],
  ] as const)('%s %s on a manifest created by %s: %s', (role, userId, createdBy, expected) => {
    expect(canModifyManifest(role, userId, createdBy)).toBe(expected)
  })
})

describe('timelineEntries', () => {
  const row = (status: ManifestStatus, over: Record<string, string | null> = {}) => ({
    status, created_at: '2026-03-01T09:30:00Z', updated_at: '2026-03-20T09:30:00Z', shipped_on: null, completed_on: null, exception_reported_on: null, ...over,
  })

  it('shows what is still owed as a step with no date', () => {
    expect(timelineEntries(row('draft'))).toEqual([
      { key: 'drafted', label: 'Drafted', date: '2026-03-01' },
      { key: 'shipped', label: 'Shipped: transporter accepted the waste', date: null },
      { key: 'completed', label: 'Signed copy received', date: null },
    ])
  })

  it('fills the steps taken', () => {
    expect(timelineEntries(row('completed', { shipped_on: '2026-03-02', completed_on: '2026-03-15' })).map(e => e.date)).toEqual(['2026-03-01', '2026-03-02', '2026-03-15'])
  })

  it('ends in the exception report rather than the signed copy when one was filed', () => {
    const entries = timelineEntries(row('exception_reported', { shipped_on: '2026-03-02', exception_reported_on: '2026-04-20' }))
    expect(entries.map(e => e.key)).toEqual(['drafted', 'shipped', 'exception'])
    expect(entries[2]!.date).toBe('2026-04-20')
  })

  it('ends in the cancellation, dated by the last update, for a cancelled manifest', () => {
    const entries = timelineEntries(row('cancelled', { shipped_on: '2026-03-02' }))
    expect(entries.map(e => e.key)).toEqual(['drafted', 'shipped', 'cancelled'])
    expect(entries[2]!.date).toBe('2026-03-20')
  })
})

describe('dates', () => {
  it('formats a calendar day as written, whatever zone the viewer is in', () => {
    expect(formatDay('2026-04-05')).toBe('Apr 5, 2026')
    expect(formatDay('2026-01-01')).toBe('Jan 1, 2026')
    expect(formatDay(null)).toBe('—')
  })

  it('reads today in the viewer\'s own calendar', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(todayLocal(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })

  it('labels the rules', () => {
    expect(jurisdictionLabel('federal')).toBe('Federal (40 CFR)')
    expect(jurisdictionLabel('state:CA')).toBe('State rules: CA')
  })
})

describe('the details form', () => {
  const row: ManifestDraftFields = {
    manifest_tracking_number: '123456789ELC', jurisdiction: 'state:CA', generator_category: 'sqg', generator_epa_id: 'CAL000123456',
    transporter_epa_id: 'CAD000000001', tsdf_epa_id: null, transporter_name: 'Haul Co', tsdf_name: null, waste_codes: ['D001', '134'],
    dot_description: 'UN1993', electronic: true, notes: null,
  }

  it('splits waste codes on commas, semicolons and spaces', () => {
    expect(splitWasteCodes('D001, F003;134  0001101H,')).toEqual(['D001', 'F003', '134', '0001101H'])
    expect(splitWasteCodes('  ')).toEqual([])
  })

  it('round-trips a manifest through the form', () => {
    const form = manifestFormFromRow(row)
    expect(form).toMatchObject({ jurisdictionKind: 'state', stateCode: 'CA', wasteCodes: 'D001, 134', tsdfName: '', notes: '' })
    expect(manifestFormToBody(form)).toMatchObject({
      generator_category: 'sqg', jurisdiction: 'state:CA', manifest_tracking_number: '123456789ELC', waste_codes: ['D001', '134'],
      tsdf_epa_id: '', electronic: true,
    })
  })

  it('reads a federal manifest as federal rules with no state', () => {
    expect(manifestFormFromRow({ ...row, jurisdiction: 'federal' })).toMatchObject({ jurisdictionKind: 'federal', stateCode: '' })
    expect(manifestFormToBody({ ...EMPTY_MANIFEST_FORM, generatorCategory: 'lqg' })).toMatchObject({ jurisdiction: 'federal' })
  })

  it('upper-cases a state code and sends an unfinished one as it is, for the route to refuse', () => {
    expect(manifestFormToBody({ ...EMPTY_MANIFEST_FORM, jurisdictionKind: 'state', stateCode: ' tx ' }).jurisdiction).toBe('state:TX')
    expect(manifestFormToBody({ ...EMPTY_MANIFEST_FORM, jurisdictionKind: 'state', stateCode: '' }).jurisdiction).toBe('state:')
  })

  it('starts a new manifest from the site\'s generator profile, and from nothing when there is none', () => {
    expect(manifestFormDefaults(null)).toEqual(EMPTY_MANIFEST_FORM)
    expect(manifestFormDefaults({ generator_category: 'lqg', jurisdiction: 'california', epa_id_number: ' cal000123456 ', long_haul_default: false }))
      .toMatchObject({ generatorCategory: 'lqg', jurisdictionKind: 'state', stateCode: 'CA', generatorEpaId: 'CAL000123456' })
    expect(manifestFormDefaults({ generator_category: null, jurisdiction: null, epa_id_number: null, long_haul_default: false }))
      .toEqual(EMPTY_MANIFEST_FORM)
  })

  it('does not copy an EPA ID that is not in the manifest\'s format', () => {
    expect(manifestFormDefaults({ generator_category: 'sqg', jurisdiction: 'federal', epa_id_number: 'pending', long_haul_default: false }).generatorEpaId).toBe('')
  })

  it('names the API field for every form field', () => {
    expect(Object.keys(MANIFEST_FORM_API_FIELD).sort()).toEqual(Object.keys(EMPTY_MANIFEST_FORM).sort())
  })
})
