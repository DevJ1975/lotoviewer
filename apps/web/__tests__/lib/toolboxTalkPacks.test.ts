import { describe, expect, it } from 'vitest'
import {
  TOOLBOX_TALK_ARCHIVE_DAYS,
  TOOLBOX_TALK_DAYS_AHEAD,
  isToolboxTalkIndustry,
  normalizeToolboxTalkIndustry,
  toolboxTalkIndustryPrompt,
} from '@/lib/toolboxTalkPacks'

describe('toolbox talk pack config', () => {
  it('generates two weeks ahead and keeps a one-year archive window', () => {
    expect(TOOLBOX_TALK_DAYS_AHEAD).toBe(14)
    expect(TOOLBOX_TALK_ARCHIVE_DAYS).toBe(365)
  })

  it('normalizes unknown tenant settings to the general-industry pack', () => {
    expect(normalizeToolboxTalkIndustry('general')).toBe('general')
    expect(normalizeToolboxTalkIndustry('construction')).toBe('construction')
    expect(normalizeToolboxTalkIndustry('food')).toBe('general')
    expect(normalizeToolboxTalkIndustry(null)).toBe('general')
  })

  it('validates only the two shipped tenant-selectable packs', () => {
    expect(isToolboxTalkIndustry('general')).toBe(true)
    expect(isToolboxTalkIndustry('construction')).toBe(true)
    expect(isToolboxTalkIndustry('oil_gas')).toBe(false)
  })

  it('uses distinct prompt guidance for construction and general industry', () => {
    expect(toolboxTalkIndustryPrompt('general')).toContain('OSHA 1910')
    expect(toolboxTalkIndustryPrompt('construction')).toContain('OSHA 1926')
  })
})
