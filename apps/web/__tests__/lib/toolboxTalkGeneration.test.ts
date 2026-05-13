import { describe, expect, it } from 'vitest'
import { normalizeGeneratedToolboxTalk, parseGenerationBudget } from '@/lib/toolboxTalkGeneration'

describe('toolbox talk generation normalization', () => {
  it('normalizes bounded generated fields', () => {
    const normalized = normalizeGeneratedToolboxTalk({
      title: '  Keep Forklift Lanes Clear  ',
      body_markdown: 'A'.repeat(120),
      key_points: ['  Look before crossing  ', '', 42, 'Use marked walkways'],
      delivery_notes: '  Ask the crew to point at the nearest crossing.  ',
    }, 'Fallback')

    expect(normalized).toMatchObject({
      title: 'Keep Forklift Lanes Clear',
      bodyMarkdown: 'A'.repeat(120),
      keyPoints: ['Look before crossing', 'Use marked walkways'],
      deliveryNotes: 'Ask the crew to point at the nearest crossing.',
    })
  })

  it('rejects blank or too-short talk bodies so cron retries later', () => {
    expect(() => normalizeGeneratedToolboxTalk({
      title: 'Bad Talk',
      body_markdown: 'Too short',
      key_points: ['Point one'],
      delivery_notes: '',
    }, 'Fallback')).toThrow(/too short/)
  })

  it('rejects generated talks without supervisor key points', () => {
    expect(() => normalizeGeneratedToolboxTalk({
      title: 'No Points',
      body_markdown: 'A'.repeat(120),
      key_points: [],
      delivery_notes: '',
    }, 'Fallback')).toThrow(/key points/)
  })

  it('parses a positive per-run generation budget', () => {
    expect(parseGenerationBudget('12', 40)).toBe(12)
    expect(parseGenerationBudget('0', 40)).toBe(40)
    expect(parseGenerationBudget(undefined, 40)).toBe(40)
  })
})
