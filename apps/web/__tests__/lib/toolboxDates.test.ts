import { describe, expect, it } from 'vitest'
import { dateWindow, localDateString, tenantTimeZone } from '@/lib/toolboxDates'

describe('toolbox date helpers', () => {
  it('uses tenant-configured time zone aliases when present', () => {
    expect(tenantTimeZone({ toolbox_time_zone: 'America/New_York' })).toBe('America/New_York')
    expect(tenantTimeZone({ timezone: 'America/Chicago' })).toBe('America/Chicago')
  })

  it('falls back to the default time zone for invalid settings', () => {
    expect(tenantTimeZone({ toolbox_time_zone: 'Mars/Base' })).toBe('America/Los_Angeles')
  })

  it('resolves the tenant-local workday instead of UTC day', () => {
    const latePacific = new Date('2026-05-14T02:30:00.000Z')
    expect(localDateString(latePacific, 'America/Los_Angeles')).toBe('2026-05-13')
    expect(localDateString(latePacific, 'UTC')).toBe('2026-05-14')
  })

  it('builds a stable date-only window', () => {
    expect(dateWindow('2026-05-30', 4)).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
    ])
  })
})
