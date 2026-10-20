import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  missingRequiredBlocks,
  parseStrikeContent,
  scoreStrikeInteraction,
  stableShuffle,
  strikeContentRuntimeMs,
  validateStrikeVersionForPublish,
  type StrikeContent,
  type StrikeInteractionBlock,
} from '../strikeContent'

const approved = { ai_generated: true, approved_by: 'reviewer-1', approved_at: '2026-10-01T00:00:00Z' }

function scene(key: string, durationMs: number | null, overrides: Record<string, unknown> = {}) {
  return {
    key,
    kind: 'motion_scene',
    title: `Scene ${key}`,
    script: 'Narration script.',
    beats: [{ at_ms: 0, text: 'Beat' }],
    image: { path: `${key}.png`, alt: 'An industrial scene', ...approved },
    narration: durationMs === null ? null : {
      audio_path: `${key}.mp3`,
      captions_path: `${key}.vtt`,
      transcript: 'Narration script.',
      duration_ms: durationMs,
      voice: 'trainer',
      ...approved,
    },
    ...overrides,
  }
}

const sortBlock = {
  key: 'sort',
  kind: 'drag_sort',
  prompt: 'Order the steps',
  items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
  remediate_block_key: null,
}

function parsed(blocks: unknown[]): StrikeContent {
  const result = parseStrikeContent({ blocks })
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.content
}

describe('parseStrikeContent', () => {
  it('rejects content without a blocks array', () => {
    expect(parseStrikeContent({}).ok).toBe(false)
    expect(parseStrikeContent(null).ok).toBe(false)
  })

  it('accepts a valid scene + interaction and sorts beats by cue time', () => {
    const content = parsed([
      scene('s1', 30_000, { beats: [{ at_ms: 5000, text: 'second' }, { at_ms: 0, text: 'first' }] }),
      sortBlock,
    ])
    const first = content.blocks[0]
    expect(first.kind === 'motion_scene' && first.beats.map(b => b.text)).toEqual(['first', 'second'])
  })

  it('reports duplicate keys, unknown kinds and dangling remediation links with block indexes', () => {
    const result = parseStrikeContent({
      blocks: [scene('s1', 1000), scene('s1', 1000), { key: 'x', kind: 'video' }, { ...sortBlock, remediate_block_key: 'nope' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map(i => i.index)).toEqual([1, 2, 3])
  })

  it('requires a correct hotspot target and in-range coordinates', () => {
    const image = { path: 'h.png', alt: 'machine' }
    const noCorrect = parseStrikeContent({ blocks: [{ key: 'h', kind: 'hotspot', image, targets: [
      { id: 'a', x_pct: 10, y_pct: 10 }, { id: 'b', x_pct: 20, y_pct: 20 },
    ] }] })
    const outOfRange = parseStrikeContent({ blocks: [{ key: 'h', kind: 'hotspot', image, targets: [
      { id: 'a', x_pct: 140, y_pct: 10, correct: true }, { id: 'b', x_pct: 20, y_pct: 20 },
    ] }] })
    expect(noCorrect.ok).toBe(false)
    expect(outOfRange.ok).toBe(false)
  })
})

describe('validateStrikeVersionForPublish', () => {
  const goodQuestion = { prompt: 'Q', graded: true, answers: [{ is_correct: true }, { is_correct: false }] }

  it('passes a fully approved, captioned module within its time budget', () => {
    const issues = validateStrikeVersionForPublish({
      content: parsed([scene('s1', 60_000), sortBlock]),
      questions: [goodQuestion],
      passingScore: 80,
      estimatedMinutes: 5,
    })
    expect(issues).toEqual([])
  })

  it('blocks unapproved AI media, missing alt text and missing transcripts', () => {
    const content = parsed([scene('s1', 1000, {
      image: { path: 'a.png', alt: '', ai_generated: true },
      narration: { audio_path: 'a.mp3', captions_path: 'a.vtt', transcript: '', duration_ms: 1000, ai_generated: true },
    })])
    const messages = validateStrikeVersionForPublish({ content, questions: [goodQuestion], passingScore: 80, estimatedMinutes: 5 })
      .map(i => i.message)
    expect(messages.some(m => m.includes('without alt text'))).toBe(true)
    expect(messages.some(m => m.includes('AI image awaiting'))).toBe(true)
    expect(messages.some(m => m.includes('no transcript'))).toBe(true)
    expect(messages.some(m => m.includes('AI narration awaiting'))).toBe(true)
  })

  it('blocks an unpassable graded question, no graded questions, and a bad passing score', () => {
    const content = parsed([scene('s1', 1000)])
    const noCorrect = validateStrikeVersionForPublish({
      content, questions: [{ prompt: 'Trick', graded: true, answers: [{ is_correct: false }] }], passingScore: 80, estimatedMinutes: 5,
    })
    expect(noCorrect.some(i => i.message.includes('has no correct answer'))).toBe(true)

    const none = validateStrikeVersionForPublish({ content, questions: [], passingScore: null, estimatedMinutes: 5 })
    expect(none.map(i => i.message)).toEqual([
      'A module needs at least one graded knowledge-check question.',
      'Set a passing score between 1 and 100.',
    ])
  })

  it('blocks narration that overruns the estimated minutes', () => {
    const issues = validateStrikeVersionForPublish({
      content: parsed([scene('s1', 200_000), scene('s2', 150_000)]),
      questions: [goodQuestion],
      passingScore: 80,
      estimatedMinutes: 5,
    })
    expect(issues).toEqual([{ index: -1, message: 'Narration runs 5:50, longer than the 5-minute estimate.' }])
  })
})

describe('scoreStrikeInteraction', () => {
  const blocks = parsed([
    sortBlock,
    { key: 'match', kind: 'drag_match', pairs: [{ id: 'e', prompt: 'Electrical', answer: 'Disconnect' }, { id: 'p', prompt: 'Pneumatic', answer: 'Valve' }] },
    { key: 'hot', kind: 'hotspot', image: { path: 'h.png', alt: 'm' }, targets: [
      { id: 'disc', x_pct: 1, y_pct: 1, correct: true }, { id: 'estop', x_pct: 2, y_pct: 2 },
    ] },
    { key: 'sc', kind: 'scenario', stem: 'S', choices: [
      { id: 'y', label: 'Own lock', correct: true, feedback: 'Yes' }, { id: 'n', label: 'Trust', feedback: 'No' },
    ] },
  ]).blocks as StrikeInteractionBlock[]
  const [sort, match, hot, scenario] = blocks

  it('grades drag-sort by position and names misplaced items', () => {
    expect(scoreStrikeInteraction(sort, { kind: 'drag_sort', orderedIds: ['a', 'b', 'c'] })).toEqual({ correct: true, incorrectIds: [] })
    expect(scoreStrikeInteraction(sort, { kind: 'drag_sort', orderedIds: ['b', 'a', 'c'] })).toEqual({ correct: false, incorrectIds: ['a', 'b'] })
  })

  it('grades drag-match per pair', () => {
    expect(scoreStrikeInteraction(match, { kind: 'drag_match', answerByPairId: { e: 'Disconnect', p: 'Disconnect' } }))
      .toEqual({ correct: false, incorrectIds: ['p'] })
  })

  it('grades hotspots by target id: missing a correct one or picking a decoy both fail', () => {
    expect(scoreStrikeInteraction(hot, { kind: 'hotspot', selectedIds: ['disc'] }).correct).toBe(true)
    expect(scoreStrikeInteraction(hot, { kind: 'hotspot', selectedIds: ['disc', 'estop'] }).incorrectIds).toEqual(['estop'])
    expect(scoreStrikeInteraction(hot, { kind: 'hotspot', selectedIds: [] }).incorrectIds).toEqual(['disc'])
  })

  it('grades scenarios and rejects a response of the wrong kind', () => {
    expect(scoreStrikeInteraction(scenario, { kind: 'scenario', choiceId: 'y' }).correct).toBe(true)
    expect(scoreStrikeInteraction(scenario, { kind: 'scenario', choiceId: 'n' }).correct).toBe(false)
    expect(scoreStrikeInteraction(scenario, { kind: 'hotspot', selectedIds: ['y'] }).correct).toBe(false)
  })
})

describe('missingRequiredBlocks', () => {
  const content = parsed([
    scene('narrated', 1000),
    scene('silent', null),
    { key: 'note', kind: 'callout', title: 'Careful' },
    sortBlock,
  ])

  it('needs narrated scenes and interactions completed, silent scenes and callouts seen', () => {
    expect(missingRequiredBlocks(content, [
      { block_key: 'narrated', event: 'seen' },
      { block_key: 'silent', event: 'seen' },
      { block_key: 'note', event: 'seen' },
      { block_key: 'sort', event: 'interaction' },
    ])).toEqual(['narrated', 'sort'])
  })

  it('treats completed as satisfying a seen requirement', () => {
    expect(missingRequiredBlocks(content, [
      { block_key: 'narrated', event: 'completed' },
      { block_key: 'silent', event: 'completed' },
      { block_key: 'note', event: 'completed' },
      { block_key: 'sort', event: 'completed' },
    ])).toEqual([])
  })
})

describe('helpers', () => {
  it('sums narration runtime and formats durations', () => {
    expect(strikeContentRuntimeMs(parsed([scene('a', 61_000), scene('b', null), scene('c', 2_500)]))).toBe(63_500)
    expect(formatDuration(63_500)).toBe('1:04')
  })

  it('shuffles deterministically and never returns the original order', () => {
    const items = ['prepare', 'notify', 'shutdown', 'isolate']
    expect(stableShuffle(items, 'user-1')).toEqual(stableShuffle(items, 'user-1'))
    expect(stableShuffle(items, 'user-1')).not.toEqual(items)
    expect([...stableShuffle(items, 'user-1')].sort()).toEqual([...items].sort())
  })
})

describe('LOTO 101 seed module', () => {
  const seed = JSON.parse(readFileSync(
    resolve(__dirname, '../../../../services/learning-studio/seed/loto-101/module.json'),
    'utf8',
  ))

  it('parses cleanly against the content model', () => {
    const result = parseStrikeContent(seed.content)
    expect(result.ok ? [] : result.issues).toEqual([])
  })

  it('has a passable 10-question knowledge check', () => {
    expect(seed.questions).toHaveLength(10)
    for (const q of seed.questions) expect(q.answers.some((a: { correct: boolean }) => a.correct)).toBe(true)
  })
})
