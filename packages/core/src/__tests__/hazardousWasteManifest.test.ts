import { describe, it, expect } from 'vitest'
import {
  MANIFEST_ACTIONS, MANIFEST_MAX_CONTAINERS, MANIFEST_MAX_WASTE_CODES, MANIFEST_STATUSES, MANIFEST_STATUS_IS_TERMINAL,
  MANIFEST_TRANSITIONS,
  availableManifestActions, isTexasWasteCode, isValidEpaId, isValidTrackingNumber, manifestClockRule, manifestJurisdictionFor,
  manifestRetentionEnd, manifestReturnClock, normalizeEpaId, normalizeTrackingNumber, normalizeWasteCodes,
  validateManifestCreateInput, validateManifestFields, validateManifestTransitionInput,
  type ManifestClockInput, type ManifestCreateInput, type ManifestJurisdiction, type ManifestStatus,
} from '../hazardousWasteManifest'
import type { RcraGeneratorCategory } from '../hazardousWaste'

const SHIPPED_ON = '2026-03-01'
const DAY_MS = 86_400_000

/** Noon UTC, `days` after the ship date: the clock is read by calendar day, so the hour must not matter. */
const dayAfterShipping = (days: number) => new Date(Date.parse(`${SHIPPED_ON}T12:00:00Z`) + days * DAY_MS)

const clockAt = (days: number, over: Partial<ManifestClockInput> = {}) =>
  manifestReturnClock({
    generatorCategory: 'lqg', jurisdiction: 'federal', status: 'shipped',
    shippedOn: SHIPPED_ON, completedOn: null, exceptionReportedOn: null, now: dayAfterShipping(days), ...over,
  })

describe('manifestReturnClock: boundaries', () => {
  describe('LQG, 35-day follow-up and 45-day exception report', () => {
    it.each([
      [0, 'on_track'], [34, 'on_track'],
      [35, 'follow_up_due'], [36, 'follow_up_due'], [44, 'follow_up_due'],
      [45, 'exception_report_due'], [46, 'exception_report_due'], [200, 'exception_report_due'],
    ] as const)('on day %i is %s', (day, stage) => {
      expect(clockAt(day).stage).toBe(stage)
      expect(clockAt(day).daysSinceShipped).toBe(day)
    })

    it('falls due ON the date: shipped 1 March, day 35 is 5 April', () => {
      const clock = clockAt(35)
      expect(clock.followUpOn).toBe('2026-04-05')
      expect(clock.stage).toBe('follow_up_due')
      expect(clockAt(34).stage).toBe('on_track')
    })

    it('puts the exception report on day 45: 15 April', () => {
      expect(clockAt(0).exceptionReportDueOn).toBe('2026-04-15')
    })

    it('counts down to the follow-up, then to the exception report, then past it', () => {
      expect(clockAt(34).daysToNextStep).toBe(1)
      expect(clockAt(35).daysToNextStep).toBe(10)
      expect(clockAt(44).daysToNextStep).toBe(1)
      expect(clockAt(45).daysToNextStep).toBe(0)
      expect(clockAt(46).daysToNextStep).toBe(-1)
    })
  })

  describe('SQG, a 60-day exception report and no 35-day step', () => {
    const sqg = (day: number) => clockAt(day, { generatorCategory: 'sqg' })

    it.each([
      [0, 'on_track'], [35, 'on_track'], [45, 'on_track'], [59, 'on_track'],
      [60, 'exception_report_due'], [61, 'exception_report_due'],
    ] as const)('on day %i is %s', (day, stage) => {
      expect(sqg(day).stage).toBe(stage)
    })

    it('has no follow-up date, and counts down to day 60 (30 April)', () => {
      expect(sqg(10).followUpOn).toBeNull()
      expect(sqg(10).exceptionReportDueOn).toBe('2026-04-30')
      expect(sqg(10).daysToNextStep).toBe(50)
      expect(sqg(60).daysToNextStep).toBe(0)
      expect(sqg(61).daysToNextStep).toBe(-1)
    })
  })
})

describe('manifestReturnClock: every category in every jurisdiction', () => {
  const CATEGORIES: RcraGeneratorCategory[] = ['lqg', 'sqg', 'vsqg']
  const JURISDICTIONS: ManifestJurisdiction[] = ['federal', 'state:CA', 'state:TX']

  // category, jurisdiction -> [follow-up day, exception-report day], or null when no clock runs.
  const EXPECTED: Record<string, readonly [number | null, number] | null> = {
    'lqg federal': [35, 45], 'lqg state:CA': [35, 45], 'lqg state:TX': [35, 45],
    'sqg federal': [null, 60], 'sqg state:CA': [null, 60], 'sqg state:TX': [null, 60],
    'vsqg federal': null, 'vsqg state:CA': [null, 60], 'vsqg state:TX': null,
  }

  for (const generatorCategory of CATEGORIES) {
    for (const jurisdiction of JURISDICTIONS) {
      const key = `${generatorCategory} ${jurisdiction}`
      const expected = EXPECTED[key]!

      it(`${key}: ${expected ? `exception report on day ${expected[1]}` : 'no clock'}`, () => {
        const rule = manifestClockRule(generatorCategory, jurisdiction)
        expect(rule === null ? null : [rule.followUpDay, rule.exceptionReportDay]).toEqual(expected)

        if (expected === null) {
          expect(clockAt(100, { generatorCategory, jurisdiction })).toMatchObject({
            stage: 'not_applicable', applicable: false, daysSinceShipped: null, followUpOn: null, exceptionReportDueOn: null, daysToNextStep: null,
          })
          return
        }
        const [followUpDay, exceptionDay] = expected
        expect(clockAt(exceptionDay - 1, { generatorCategory, jurisdiction }).stage).not.toBe('exception_report_due')
        expect(clockAt(exceptionDay, { generatorCategory, jurisdiction })).toMatchObject({ stage: 'exception_report_due', applicable: true })
        if (followUpDay !== null) expect(clockAt(followUpDay, { generatorCategory, jurisdiction }).stage).toBe('follow_up_due')
      })
    }
  }

  it('treats a California VSQG as an SQG and a federal VSQG as not subject, on the same dates', () => {
    expect(clockAt(59, { generatorCategory: 'vsqg', jurisdiction: 'state:CA' }).stage).toBe('on_track')
    expect(clockAt(60, { generatorCategory: 'vsqg', jurisdiction: 'state:CA' }).stage).toBe('exception_report_due')
    expect(clockAt(60, { generatorCategory: 'vsqg', jurisdiction: 'federal' }).stage).toBe('not_applicable')
  })

  it('says a federal VSQG answer should be checked against the state', () => {
    expect(clockAt(10, { generatorCategory: 'vsqg' }).note).toMatch(/state/i)
  })
})

describe('manifestReturnClock: status decides, dates only run the clock of an open manifest', () => {
  it.each(['draft', 'completed', 'exception_reported', 'cancelled'] as const)('%s ignores the clock even 400 days on', status => {
    const clock = clockAt(400, { status, completedOn: '2026-03-20', exceptionReportedOn: '2026-04-20' })
    expect(clock.stage).toBe(status)
    expect(clock).toMatchObject({ daysSinceShipped: null, followUpOn: null, exceptionReportDueOn: null, daysToNextStep: null })
  })

  it('still ignores the clock for a VSQG: the status wins over "not applicable"', () => {
    expect(clockAt(400, { status: 'completed', generatorCategory: 'vsqg' }).stage).toBe('completed')
    expect(clockAt(1, { status: 'draft', generatorCategory: 'vsqg' }).stage).toBe('draft')
  })

  it('reports whether the generator is held to a clock even before it starts', () => {
    expect(clockAt(0, { status: 'draft' }).applicable).toBe(true)
    expect(clockAt(0, { status: 'draft', generatorCategory: 'vsqg' }).applicable).toBe(false)
  })

  it('names the date a finished manifest finished on', () => {
    expect(clockAt(50, { status: 'completed', completedOn: '2026-03-20' }).note).toContain('2026-03-20')
    expect(clockAt(50, { status: 'exception_reported', exceptionReportedOn: '2026-04-20' }).note).toContain('2026-04-20')
  })

  it('does not invent a clock when an open manifest has no ship date, or a date that is not a day', () => {
    for (const shippedOn of [null, '2026-02-30', 'soon']) {
      const clock = clockAt(10, { shippedOn })
      expect(clock).toMatchObject({ stage: 'on_track', daysSinceShipped: null, daysToNextStep: null })
      expect(clock.note).toMatch(/ship date/i)
    }
  })

  it('reads the calendar day in UTC, whatever hour it is', () => {
    const start = manifestReturnClock({ generatorCategory: 'lqg', jurisdiction: 'federal', status: 'shipped', shippedOn: SHIPPED_ON, completedOn: null, exceptionReportedOn: null, now: new Date('2026-04-05T00:00:00Z') })
    const end = manifestReturnClock({ generatorCategory: 'lqg', jurisdiction: 'federal', status: 'shipped', shippedOn: SHIPPED_ON, completedOn: null, exceptionReportedOn: null, now: new Date('2026-04-05T23:59:59Z') })
    const before = manifestReturnClock({ generatorCategory: 'lqg', jurisdiction: 'federal', status: 'shipped', shippedOn: SHIPPED_ON, completedOn: null, exceptionReportedOn: null, now: new Date('2026-04-04T23:59:59Z') })
    expect([start.daysSinceShipped, end.daysSinceShipped, before.daysSinceShipped]).toEqual([35, 35, 34])
  })

  it('counts across a month end, a year end and a leap day', () => {
    const lqg = (shippedOn: string, now: string) => manifestReturnClock({
      generatorCategory: 'lqg', jurisdiction: 'federal', status: 'shipped', shippedOn, completedOn: null, exceptionReportedOn: null, now: new Date(`${now}T08:00:00Z`),
    })
    expect(lqg('2025-12-01', '2026-01-05')).toMatchObject({ daysSinceShipped: 35, stage: 'follow_up_due', followUpOn: '2026-01-05' })
    expect(lqg('2028-01-15', '2028-02-29')).toMatchObject({ daysSinceShipped: 45, stage: 'exception_report_due', exceptionReportDueOn: '2028-02-29' })
    expect(lqg('2027-01-15', '2027-03-01')).toMatchObject({ daysSinceShipped: 45, exceptionReportDueOn: '2027-03-01' })
  })

  it('tells the reader what to do at each stage', () => {
    expect(clockAt(10).note).toContain('2026-04-05')
    expect(clockAt(36).note).toMatch(/contact the transporter/i)
    expect(clockAt(46).note).toMatch(/exception report/i)
  })
})

describe('manifestRetentionEnd', () => {
  it.each([
    ['2026-03-01', '2029-03-01'],
    ['2026-12-31', '2029-12-31'],
    ['2026-01-01', '2029-01-01'],
  ])('keeps %s until %s', (shipped, end) => {
    expect(manifestRetentionEnd(shipped)).toBe(end)
  })

  it('rolls a 29 February ship date to 1 March of a common year, never a day early', () => {
    expect(manifestRetentionEnd('2028-02-29')).toBe('2031-03-01')
  })

  it('does not stretch a 28 February ship date to the leap day three years on', () => {
    expect(manifestRetentionEnd('2024-02-29')).toBe('2027-03-01')
    expect(manifestRetentionEnd('2025-02-28')).toBe('2028-02-28')
  })

  it('has no end without a real ship date', () => {
    expect(manifestRetentionEnd(null)).toBeNull()
    expect(manifestRetentionEnd('2026-02-30')).toBeNull()
    expect(manifestRetentionEnd('March 1')).toBeNull()
  })
})

describe('identifiers', () => {
  const trackingNumbers: Array<[string, boolean]> = [
    ['123456789ELC', true], ['000000000AAA', true], ['  123456789elc  ', true],
    ['123456789EL', false], ['123456789ELCS', false], ['12345678ELC', false], ['1234567890ELC', false],
    ['ABCDEFGHIJKL', false], ['123456789123', false], ['123456789 ELC', false], ['123456789-ELC', false], ['', false],
  ]
  it.each(trackingNumbers)('tracking number %j is %s', (value, valid) => {
    expect(isValidTrackingNumber(value)).toBe(valid)
  })

  it('normalizes a tracking number by trimming and upper-casing only', () => {
    expect(normalizeTrackingNumber('  123456789elc ')).toBe('123456789ELC')
    expect(normalizeTrackingNumber('123456789 elc')).toBe('123456789 ELC')
  })

  const epaIds: Array<[string, boolean]> = [
    ['CAL000123456', true], ['NYD123456789', true], [' txd000000001 ', true],
    ['CA0000123456', false], ['CAL00012345', false], ['CAL0001234567', false], ['12L000123456', false],
    ['CALL00123456', false], ['CAL00012345A', false], ['', false],
  ]
  it.each(epaIds)('EPA ID %j is %s', (value, valid) => {
    expect(isValidEpaId(value)).toBe(valid)
  })

  it('normalizes an EPA ID by trimming and upper-casing', () => {
    expect(normalizeEpaId(' cal000123456 ')).toBe('CAL000123456')
  })

  const texasCodes: Array<[string, boolean]> = [
    ['0001101H', true], ['1234567H', true], ['0001101h', true], ['9999999H', true],
    ['00011011', true], ['00011012', true], ['00011013', true],
    ['00011014', false], ['00011010', false], ['0001101N', false],
    ['000110H', false], ['00011011H', false], ['0001101HH', false], ['ABCD101H', false], ['000A101H', false], ['', false],
    ['D001', false], ['134', false],
  ]
  it.each(texasCodes)('Texas waste code %j is %s', (value, valid) => {
    expect(isTexasWasteCode(value)).toBe(valid)
  })

  it('normalizes a list of waste codes: upper-cased, blanks and repeats dropped, order kept', () => {
    expect(normalizeWasteCodes([' d001', 'F003', '', 'D001', '  ', 'f003', '134'])).toEqual(['D001', 'F003', '134'])
  })
})

describe('the manifest jurisdiction', () => {
  it('maps the module\'s jurisdictions: California is state:CA', () => {
    expect(manifestJurisdictionFor('california')).toBe('state:CA')
    expect(manifestJurisdictionFor('federal')).toBe('federal')
  })
})

describe('transitions as data', () => {
  it('has a rule for every action, ending in a known status', () => {
    for (const action of MANIFEST_ACTIONS) {
      const rule = MANIFEST_TRANSITIONS[action]
      expect(MANIFEST_STATUSES).toContain(rule.to)
      for (const from of rule.from) expect(MANIFEST_STATUSES).toContain(from)
    }
  })

  it('offers each status exactly the actions that start from it', () => {
    const expected: Record<ManifestStatus, string[]> = {
      draft: ['ship', 'cancel'], shipped: ['receive', 'file_exception', 'cancel'],
      completed: [], exception_reported: [], cancelled: [],
    }
    for (const status of MANIFEST_STATUSES) expect(availableManifestActions(status), status).toEqual(expected[status])
  })

  it('never leaves a terminal status', () => {
    for (const status of MANIFEST_STATUSES.filter(s => MANIFEST_STATUS_IS_TERMINAL[s])) {
      expect(availableManifestActions(status), status).toEqual([])
    }
    for (const status of MANIFEST_STATUSES.filter(s => !MANIFEST_STATUS_IS_TERMINAL[s])) {
      expect(availableManifestActions(status).length, status).toBeGreaterThan(0)
    }
  })

  it('says what happens to the containers: only completing disposes of them, only cancelling takes them back', () => {
    expect(MANIFEST_TRANSITIONS.ship.containersAfter).toBeNull()
    expect(MANIFEST_TRANSITIONS.file_exception.containersAfter).toBeNull()
    expect(MANIFEST_TRANSITIONS.receive.containersAfter).toBe('disposed')
    expect(MANIFEST_TRANSITIONS.cancel.containersAfter).toBe('closed')
  })

  it('asks for a date on every action but cancel', () => {
    expect(MANIFEST_TRANSITIONS.ship.dateMeaning).toBe('shipped_on')
    expect(MANIFEST_TRANSITIONS.receive.dateMeaning).toBe('completed_on')
    expect(MANIFEST_TRANSITIONS.file_exception.dateMeaning).toBe('exception_reported_on')
    expect(MANIFEST_TRANSITIONS.cancel.dateMeaning).toBeNull()
  })
})

describe('validateManifestFields', () => {
  it('accepts nothing at all: a PATCH may send only what changed', () => {
    expect(validateManifestFields({})).toEqual([])
  })

  it('accepts a complete, well-formed set', () => {
    expect(validateManifestFields({
      manifest_tracking_number: '123456789ELC', jurisdiction: 'state:CA', generator_category: 'lqg',
      generator_epa_id: 'CAL000123456', transporter_epa_id: 'CAD000000001', tsdf_epa_id: 'AZD000000002',
      transporter_name: 'Haul Co', tsdf_name: 'Burn Inc', waste_codes: ['D001', 'F003', '134', '0001101H'],
      dot_description: 'UN1993, Waste Flammable liquids, n.o.s., 3, PG II', electronic: true, notes: 'Two drums',
    })).toEqual([])
  })

  it('treats null as "not given" for the optional columns', () => {
    expect(validateManifestFields({
      manifest_tracking_number: null, generator_epa_id: null, transporter_epa_id: null, tsdf_epa_id: null,
      transporter_name: null, tsdf_name: null, dot_description: null, notes: null,
    })).toEqual([])
  })

  it('names each bad field', () => {
    const errors = validateManifestFields({
      manifest_tracking_number: '12345', jurisdiction: 'texas' as ManifestJurisdiction, generator_category: 'huge' as RcraGeneratorCategory,
      generator_epa_id: 'bad', transporter_epa_id: 'bad', tsdf_epa_id: 'bad',
    })
    expect(errors.map(e => e.field).sort()).toEqual([
      'generator_category', 'generator_epa_id', 'jurisdiction', 'manifest_tracking_number', 'transporter_epa_id', 'tsdf_epa_id',
    ])
  })

  it('refuses over-long text at the length the database allows', () => {
    expect(validateManifestFields({ transporter_name: 'x'.repeat(200), tsdf_name: 'x'.repeat(200), dot_description: 'x'.repeat(1000), notes: 'x'.repeat(2000) })).toEqual([])
    expect(validateManifestFields({ transporter_name: 'x'.repeat(201) }).map(e => e.field)).toEqual(['transporter_name'])
    expect(validateManifestFields({ tsdf_name: 'x'.repeat(201) }).map(e => e.field)).toEqual(['tsdf_name'])
    expect(validateManifestFields({ dot_description: 'x'.repeat(1001) }).map(e => e.field)).toEqual(['dot_description'])
    expect(validateManifestFields({ notes: 'x'.repeat(2001) }).map(e => e.field)).toEqual(['notes'])
  })

  it('names the waste codes it does not recognise, after normalising', () => {
    expect(validateManifestFields({ waste_codes: ['d001', 'X12', '12'] })).toEqual([
      { field: 'waste_codes', message: expect.stringContaining('X12, 12') },
    ])
  })

  it('caps the waste codes at the database limit, counted after repeats are dropped', () => {
    const codes = Array.from({ length: MANIFEST_MAX_WASTE_CODES }, (_, i) => String(100 + i))
    expect(validateManifestFields({ waste_codes: codes })).toEqual([])
    expect(validateManifestFields({ waste_codes: [...codes, ...codes] })).toEqual([])
    expect(validateManifestFields({ waste_codes: [...codes, '999'] }).map(e => e.field)).toEqual(['waste_codes'])
  })
})

describe('validateManifestCreateInput', () => {
  const ID = '6f1c0a52-2b53-4d2e-9a6e-0a1f1f3b9c11'
  const valid = (over: Partial<ManifestCreateInput> = {}): ManifestCreateInput => ({
    container_ids: [ID], manifest_tracking_number: null, jurisdiction: 'federal', generator_category: 'lqg',
    generator_epa_id: null, transporter_epa_id: null, tsdf_epa_id: null, transporter_name: null, tsdf_name: null,
    waste_codes: [], dot_description: null, electronic: false, notes: null, ...over,
  })

  it('accepts one container and no optional detail', () => {
    expect(validateManifestCreateInput(valid())).toEqual([])
  })

  it('needs at least one container, and no more than the database takes', () => {
    expect(validateManifestCreateInput(valid({ container_ids: [] })).map(e => e.field)).toEqual(['container_ids'])
    const many = Array.from({ length: MANIFEST_MAX_CONTAINERS + 1 }, () => ID)
    expect(validateManifestCreateInput(valid({ container_ids: many.slice(0, MANIFEST_MAX_CONTAINERS) }))).toEqual([])
    expect(validateManifestCreateInput(valid({ container_ids: many })).map(e => e.field)).toEqual(['container_ids'])
  })

  it('refuses a container id that is not a UUID', () => {
    expect(validateManifestCreateInput(valid({ container_ids: [ID, 'not-a-uuid'] })).map(e => e.field)).toEqual(['container_ids'])
  })

  it('also reports the field errors, all at once', () => {
    const errors = validateManifestCreateInput(valid({ container_ids: [], generator_epa_id: 'x' }))
    expect(errors.map(e => e.field).sort()).toEqual(['container_ids', 'generator_epa_id'])
  })
})

describe('validateManifestTransitionInput', () => {
  it('accepts each action with the date it needs', () => {
    expect(validateManifestTransitionInput({ action: 'ship', on: '2026-03-01', note: null })).toEqual([])
    expect(validateManifestTransitionInput({ action: 'receive', on: '2026-03-20', note: 'Signed copy by mail' })).toEqual([])
    expect(validateManifestTransitionInput({ action: 'file_exception', on: '2026-04-20', note: null })).toEqual([])
    expect(validateManifestTransitionInput({ action: 'cancel', on: null, note: null })).toEqual([])
  })

  it('asks for a date on every action that fills one', () => {
    for (const action of ['ship', 'receive', 'file_exception']) {
      expect(validateManifestTransitionInput({ action, on: null, note: null }), action).toEqual([{ field: 'on', message: 'Enter the date' }])
    }
  })

  it('refuses a date that is not a calendar day, even where none is required', () => {
    for (const on of ['2026-02-30', '03/01/2026', 'today', '2026-3-1']) {
      expect(validateManifestTransitionInput({ action: 'ship', on, note: null }).map(e => e.field), on).toEqual(['on'])
      expect(validateManifestTransitionInput({ action: 'cancel', on, note: null }).map(e => e.field), on).toEqual(['on'])
    }
  })

  it('refuses an unknown action and an over-long note', () => {
    expect(validateManifestTransitionInput({ action: 'complete', on: '2026-03-01', note: null }).map(e => e.field)).toEqual(['action'])
    expect(validateManifestTransitionInput({ action: 'ship', on: '2026-03-01', note: 'x'.repeat(500) })).toEqual([])
    expect(validateManifestTransitionInput({ action: 'ship', on: '2026-03-01', note: 'x'.repeat(501) }).map(e => e.field)).toEqual(['note'])
  })
})
