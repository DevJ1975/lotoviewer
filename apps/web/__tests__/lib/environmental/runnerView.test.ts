import { describe, it, expect } from 'vitest'
import {
  EMPTY_ANSWER, dueText, draftKey, groupByProgram, groupBySection, isAnswered, limitsText, numericValue, numericVerdict,
  parseDraft, progress, serializeDraft, toSubmitBody, type Answers,
} from '@/lib/environmental/runnerView'
import type { ChecklistTemplateRow, RunItemView } from '@/lib/environmental/client'

const item = (over: Partial<RunItemView> & { id: string }): RunItemView => ({
  section: 'Observations', prompt: `Prompt ${over.id}`, item_type: 'pass_fail_na', required: true, critical: false, guidance: null,
  citations: [], clause_ref: null, unit: null, min: null, max: null, ...over,
})

const ITEMS: RunItemView[] = [
  item({ id: 'sheen' }),
  item({ id: 'ph', item_type: 'numeric', section: 'Samples', unit: 'pH', min: 6, max: 9 }),
  item({ id: 'notes', item_type: 'text', section: 'Samples', required: false }),
  item({ id: 'photo', item_type: 'photo', section: 'Evidence', required: true }),
]

const answers = (over: Record<string, Partial<typeof EMPTY_ANSWER>>): Answers =>
  Object.fromEntries(Object.entries(over).map(([id, a]) => [id, { ...EMPTY_ANSWER, ...a }]))

describe('isAnswered', () => {
  it('needs a result for pass/fail, a finite number for numeric, a photo for photo', () => {
    expect(isAnswered(ITEMS[0]!, answers({}))).toBe(false)
    expect(isAnswered(ITEMS[0]!, answers({ sheen: { result: 'na' } }))).toBe(true)
    expect(isAnswered(ITEMS[1]!, answers({ ph: { value: '' } }))).toBe(false)
    expect(isAnswered(ITEMS[1]!, answers({ ph: { value: 'abc' } }))).toBe(false)
    expect(isAnswered(ITEMS[1]!, answers({ ph: { value: '0' } }))).toBe(true)
    expect(isAnswered(ITEMS[3]!, answers({ photo: { evidencePath: 't/x.jpg' } }))).toBe(true)
  })

  it('treats blank text as unanswered, and a signature as a typed name or a drawing', () => {
    expect(isAnswered(ITEMS[2]!, answers({ notes: { value: '   ' } }))).toBe(false)
    const sig = item({ id: 'sig', item_type: 'signature' })
    expect(isAnswered(sig, answers({ sig: { value: 'Pat' } }))).toBe(true)
    expect(isAnswered(sig, answers({ sig: { evidencePath: 't/sig.png' } }))).toBe(true)
    expect(isAnswered(sig, answers({}))).toBe(false)
  })
})

describe('progress', () => {
  it('counts only required items toward what blocks submitting, and lists the missing ones in order', () => {
    const p = progress(ITEMS, answers({ sheen: { result: 'pass' } }))
    expect(p).toMatchObject({ requiredTotal: 3, requiredAnswered: 1, answered: 1, total: 4 })
    expect(p.missing.map(i => i.id)).toEqual(['ph', 'photo'])
  })

  it('is complete when every required item is answered, whether or not the optional ones are', () => {
    const p = progress(ITEMS, answers({ sheen: { result: 'fail' }, ph: { value: '7.2' }, photo: { evidencePath: 't/p.jpg' } }))
    expect(p.missing).toEqual([])
    expect(p.requiredAnswered).toBe(3)
  })
})

describe('numeric readings', () => {
  it('parses a number and rejects anything else', () => {
    expect(numericValue('7.25')).toBe(7.25)
    expect(numericValue(' 0 ')).toBe(0)
    for (const bad of ['', '  ', 'x', 'Infinity', 'NaN']) expect(numericValue(bad), bad).toBeNull()
  })

  it('judges a reading against the item limits, inclusive of both ends', () => {
    const ph = ITEMS[1]!
    expect(numericVerdict(ph, '7')).toBe('pass')
    expect(numericVerdict(ph, '6')).toBe('pass')
    expect(numericVerdict(ph, '9')).toBe('pass')
    expect(numericVerdict(ph, '5.9')).toBe('fail')
    expect(numericVerdict(ph, '9.1')).toBe('fail')
    expect(numericVerdict(ph, '')).toBeNull()
  })

  it('has no verdict for a reading with no limits', () => {
    expect(numericVerdict(item({ id: 'flow', item_type: 'numeric' }), '12')).toBeNull()
  })

  it('describes the limits in words', () => {
    expect(limitsText(ITEMS[1]!)).toBe('6 to 9 pH')
    expect(limitsText(item({ id: 'a', max: 5, unit: 'gpm' }))).toBe('at most 5 gpm')
    expect(limitsText(item({ id: 'b', min: 2 }))).toBe('at least 2')
    expect(limitsText(item({ id: 'c' }))).toBeNull()
  })
})

describe('toSubmitBody', () => {
  const sign = { name: '  Pat Inspector ', imagePath: null }

  it('sends a number as a number and no result for numeric items, so the server judges the reading', () => {
    const body = toSubmitBody(ITEMS, answers({ sheen: { result: 'pass' }, ph: { value: '7.2' }, photo: { evidencePath: 't/p.jpg' } }), sign)
    expect(body.answers).toContainEqual({ item_id: 'ph', value: 7.2, note: null, evidence_id: null })
    expect(body.answers.find(a => a.item_id === 'ph')).not.toHaveProperty('result')
  })

  it('carries the note and photo for a failure, trimmed', () => {
    const body = toSubmitBody(ITEMS, answers({ sheen: { result: 'fail', note: '  oil sheen  ', evidencePath: 't/s.jpg' } }), sign)
    expect(body.answers[0]).toEqual({ item_id: 'sheen', result: 'fail', note: 'oil sheen', evidence_id: 't/s.jpg' })
  })

  it('leaves out unanswered items, keeps a note written on an unanswered one, and trims the signature name', () => {
    const body = toSubmitBody(ITEMS, answers({ notes: { note: 'came back later' } }), sign)
    expect(body.answers.map(a => a.item_id)).toEqual(['notes'])
    expect(body.signature_name).toBe('Pat Inspector')
    expect(body.attested).toBe(true)
  })

  it('includes the drawn signature only when there is one', () => {
    expect(toSubmitBody(ITEMS, answers({}), sign)).not.toHaveProperty('signature_image_path')
    expect(toSubmitBody(ITEMS, answers({}), { name: 'P', imagePath: 't/sig.png' })).toHaveProperty('signature_image_path', 't/sig.png')
  })
})

describe('groupBySection', () => {
  it('keeps checklist order and groups only consecutive items of a section', () => {
    expect(groupBySection(ITEMS).map(g => [g.section, g.items.map(i => i.id)])).toEqual([
      ['Observations', ['sheen']], ['Samples', ['ph', 'notes']], ['Evidence', ['photo']],
    ])
  })
})

describe('local draft', () => {
  it('round-trips', () => {
    const draft = { answers: { sheen: { ...EMPTY_ANSWER, result: 'pass' as const, note: 'ok' } }, signatureName: 'Pat' }
    expect(parseDraft(serializeDraft(draft))).toEqual(draft)
  })

  it('is discarded when missing, damaged or the wrong shape, and cleans odd fields', () => {
    for (const raw of [null, '', '{', '[]', '"x"', '{"answers":[]}', '{"answers":5}']) expect(parseDraft(raw), String(raw)).toBeNull()
    expect(parseDraft('{"answers":{"a":{"result":"maybe","value":5,"evidencePath":3,"note":null}}}')).toEqual({
      answers: { a: EMPTY_ANSWER }, signatureName: '',
    })
  })

  it('is keyed by run, so two checklists never share answers', () => {
    expect(draftKey('a')).not.toBe(draftKey('b'))
  })
})

describe('checklist list helpers', () => {
  const row = (over: Partial<ChecklistTemplateRow>): ChecklistTemplateRow => ({
    library_key: 'k', name: 'N', description: '', program: 'stormwater', subject_type: 'facility', cadence: 'quarterly', item_count: 3,
    source: 'federal', template_id: null, last_completed_on: null, due_status: 'never', due_on: null, ...over,
  })

  it('groups by program in the library order and omits programs with none', () => {
    const groups = groupByProgram([row({ library_key: 'a', program: 'air' }), row({ library_key: 'b', program: 'stormwater' }), row({ library_key: 'c', program: 'air' })])
    expect(groups.map(g => [g.program, g.templates.map(t => t.library_key)])).toEqual([['stormwater', ['b']], ['air', ['a', 'c']]])
  })

  it('words the due status plainly', () => {
    expect(dueText(row({}))).toBe('Not done yet')
    expect(dueText(row({ due_status: 'ok', last_completed_on: '2026-06-30', due_on: '2026-09-30' }))).toBe('Last done 2026-06-30, next due 2026-09-30')
    expect(dueText(row({ due_status: 'overdue', last_completed_on: '2026-03-31', due_on: '2026-06-30' }))).toBe('Last done 2026-03-31, overdue since 2026-06-30')
  })
})
