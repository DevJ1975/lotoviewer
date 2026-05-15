import { describe, it, expect } from 'vitest'
import { sortTopicsForRotation, pickTopicsForDates } from '@/lib/toolboxRotation'

interface FakeTopic {
  id:    string
  title: string
}

const TOPICS: FakeTopic[] = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Bravo' },
  { id: 'c', title: 'Charlie' },
  { id: 'd', title: 'Delta' },
  { id: 'e', title: 'Echo' },
]

describe('sortTopicsForRotation', () => {
  it('puts never-used topics first, in id-stable order', () => {
    const lastUsed = new Map<string, string>()
    const sorted = sortTopicsForRotation(TOPICS, lastUsed)
    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('does not mutate the input array', () => {
    const lastUsed = new Map<string, string>([['a', '2026-05-01']])
    const original = [...TOPICS]
    sortTopicsForRotation(TOPICS, lastUsed)
    expect(TOPICS).toEqual(original)
  })

  it('sorts used topics by ascending last-used date', () => {
    const lastUsed = new Map<string, string>([
      ['a', '2026-05-05'],
      ['b', '2026-05-01'],
      ['c', '2026-05-03'],
    ])
    // d, e never used → first; then b (oldest), c, a (newest)
    const sorted = sortTopicsForRotation(TOPICS, lastUsed)
    expect(sorted.map(t => t.id)).toEqual(['d', 'e', 'b', 'c', 'a'])
  })

  it('mixes never-used and used topics correctly', () => {
    const lastUsed = new Map<string, string>([
      ['a', '2026-05-05'],
      ['c', '2026-04-30'],
    ])
    const sorted = sortTopicsForRotation(TOPICS, lastUsed)
    // b, d, e never used (id-sorted) → 'b','d','e'; then c (older), then a
    expect(sorted.map(t => t.id)).toEqual(['b', 'd', 'e', 'c', 'a'])
  })

  it('breaks date ties by ascending topic id', () => {
    const lastUsed = new Map<string, string>([
      ['a', '2026-05-01'],
      ['b', '2026-05-01'],
      ['c', '2026-05-01'],
    ])
    const sorted = sortTopicsForRotation(TOPICS, lastUsed)
    // Tied trio sorted alphabetically; never-used d/e come first
    expect(sorted.map(t => t.id)).toEqual(['d', 'e', 'a', 'b', 'c'])
  })

  it('handles an empty topic list', () => {
    expect(sortTopicsForRotation([], new Map())).toEqual([])
  })

  it('handles all topics having the same date (full cycle just completed)', () => {
    const lastUsed = new Map<string, string>([
      ['a', '2026-05-04'],
      ['b', '2026-05-04'],
      ['c', '2026-05-04'],
      ['d', '2026-05-04'],
      ['e', '2026-05-04'],
    ])
    const sorted = sortTopicsForRotation(TOPICS, lastUsed)
    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('is deterministic across runs given the same inputs (idempotent cron re-trigger)', () => {
    const lastUsed = new Map<string, string>([
      ['a', '2026-05-05'], ['b', '2026-05-01'], ['c', '2026-05-03'],
    ])
    const r1 = sortTopicsForRotation(TOPICS, lastUsed).map(t => t.id)
    const r2 = sortTopicsForRotation(TOPICS, lastUsed).map(t => t.id)
    expect(r1).toEqual(r2)
  })

  it('ignores topics that appear in lastUsed but not in the pool', () => {
    const lastUsed = new Map<string, string>([
      ['a', '2026-05-05'],
      ['gone', '2025-01-01'],  // topic was deactivated
    ])
    const sorted = sortTopicsForRotation(TOPICS, lastUsed)
    expect(sorted.map(t => t.id)).toEqual(['b', 'c', 'd', 'e', 'a'])
  })

  it('rotates correctly across consecutive weekly runs (simulated)', () => {
    // Week 1: nothing used.
    const week1 = sortTopicsForRotation(TOPICS, new Map())
    expect(week1.slice(0, 3).map(t => t.id)).toEqual(['a', 'b', 'c'])

    // After week 1, topics a/b/c marked used on consecutive days.
    const afterWeek1 = new Map<string, string>([
      ['a', '2026-05-04'],
      ['b', '2026-05-05'],
      ['c', '2026-05-06'],
    ])
    const week2 = sortTopicsForRotation(TOPICS, afterWeek1)
    // d, e are still never-used → first.
    expect(week2.slice(0, 2).map(t => t.id)).toEqual(['d', 'e'])
  })
})

describe('pickTopicsForDates', () => {
  const sorted = TOPICS

  it('returns one (date, topic) per missing date', () => {
    const dates = ['2026-05-04', '2026-05-05']
    const picks = pickTopicsForDates(sorted, dates)
    expect(picks).toEqual([
      { date: '2026-05-04', topic: TOPICS[0] },
      { date: '2026-05-05', topic: TOPICS[1] },
    ])
  })

  it('cycles through the topic pool when there are more dates than topics', () => {
    const dates = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']
    const picks = pickTopicsForDates(TOPICS.slice(0, 3), dates)
    expect(picks.map(p => p.topic.id)).toEqual(['a', 'b', 'c', 'a', 'b', 'c', 'a'])
  })

  it('returns an empty array when missingDates is empty', () => {
    expect(pickTopicsForDates(sorted, [])).toEqual([])
  })

  it('returns an empty array when sorted pool is empty', () => {
    expect(pickTopicsForDates([], ['d1'])).toEqual([])
  })

  it('handles a single-topic pool by repeating it for every date', () => {
    const picks = pickTopicsForDates([{ id: 'only' }], ['d1', 'd2', 'd3'])
    expect(picks.map(p => p.topic.id)).toEqual(['only', 'only', 'only'])
  })

  it('preserves date order from the input', () => {
    const dates = ['2026-05-07', '2026-05-04', '2026-05-09']
    const picks = pickTopicsForDates(sorted, dates)
    expect(picks.map(p => p.date)).toEqual(['2026-05-07', '2026-05-04', '2026-05-09'])
  })

  it('assigns a unique topic to every day in the two-week window when enough topics exist', () => {
    const topics = Array.from({ length: 14 }, (_, i) => ({ id: `topic-${i + 1}` }))
    const dates = Array.from({ length: 14 }, (_, i) => `2026-05-${String(i + 1).padStart(2, '0')}`)
    const picks = pickTopicsForDates(topics, dates)
    expect(picks.map(p => p.topic.id)).toEqual(topics.map(t => t.id))
  })
})
