import { describe, expect, it } from 'vitest'
import { buildLdrNotice, ldrNoticeStatus } from '@soteria/core/ldrNotice'

describe('ldrNoticeStatus', () => {
  it('is not required when the stream is not LDR-restricted', () => {
    const s = ldrNoticeStatus({ ldr_restricted: false, ldr_notice_sent: false, ldr_notice_date: null })
    expect(s.required).toBe(false)
    expect(s.outstanding).toBe(false)
  })

  it('is outstanding when restricted but not sent', () => {
    const s = ldrNoticeStatus({ ldr_restricted: true, ldr_notice_sent: false, ldr_notice_date: null })
    expect(s.outstanding).toBe(true)
  })

  it('is satisfied once sent', () => {
    const s = ldrNoticeStatus({ ldr_restricted: true, ldr_notice_sent: true, ldr_notice_date: '2026-05-01' })
    expect(s.outstanding).toBe(false)
    expect(s.sentDate).toBe('2026-05-01')
  })
})

describe('buildLdrNotice', () => {
  it('splits EPA and California codes and carries the certification', () => {
    const notice = buildLdrNotice(
      { name: 'Spent solvent', waste_codes: ['D001', 'F003', '134'] },
      { generatorName: 'Acme Plant', epaIdNumber: 'CAL000111222' },
      '2026-05-14',
      'MANIFEST-123',
    )
    expect(notice.epaWasteCodes).toEqual(['D001', 'F003'])
    expect(notice.californiaWasteCodes).toEqual(['134'])
    expect(notice.manifestTrackingNumber).toBe('MANIFEST-123')
    expect(notice.noticeDate).toBe('2026-05-14')
    expect(notice.certificationStatement).toMatch(/40 CFR Part 268/)
    expect(notice.generatorName).toBe('Acme Plant')
  })

  it('defaults the manifest number to null', () => {
    const notice = buildLdrNotice(
      { name: 'X', waste_codes: [] },
      { generatorName: null, epaIdNumber: null },
      '2026-01-01',
    )
    expect(notice.manifestTrackingNumber).toBeNull()
    expect(notice.epaWasteCodes).toEqual([])
  })
})
