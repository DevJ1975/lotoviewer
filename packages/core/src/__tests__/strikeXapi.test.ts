import { describe, expect, it } from 'vitest'
import { parseStrikeContent, type StrikeContent, type StrikeInteractionBlock } from '../strikeContent'
import {
  STRIKE_XAPI_ACCOUNT_HOME,
  strikeXapiActivityId,
  strikeXapiActor,
  strikeXapiEventsForBlockEvents,
  strikeXapiStatement,
} from '../strikeXapi'

const content: StrikeContent = (() => {
  const result = parseStrikeContent({ blocks: [
    { key: 's1', kind: 'motion_scene', title: 'Why LOTO', beats: [], narration: { audio_path: 'a.mp3', captions_path: 'a.vtt', transcript: 't', duration_ms: 1000 } },
    { key: 'quiet', kind: 'motion_scene', title: 'Silent', beats: [] },
    { key: 'c1', kind: 'callout', title: 'Stored energy' },
    { key: 'sort', kind: 'drag_sort', prompt: 'Order the steps', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] },
  ] })
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.content
})()
const sort = content.blocks[3] as StrikeInteractionBlock

const module = { moduleId: 'mod-1', moduleTitle: 'LOTO 101', versionId: 'ver-1', locale: 'es' }
const base = { id: 'stmt-1', timestamp: '2026-10-20T12:00:00.000Z', registration: 'attempt-1', actor: strikeXapiActor({ name: 'Ana', email: null, accountName: 'member:m1' }) }

describe('strikeXapiActor', () => {
  it('identifies by normalized email so the LMS can match its own user', () => {
    expect(strikeXapiActor({ name: ' Ana Ruiz ', email: ' Ana@Plant.COM ', accountName: 'u1' }))
      .toEqual({ objectType: 'Agent', name: 'Ana Ruiz', mbox: 'mailto:ana@plant.com' })
  })

  it('falls back to a stable account for learners without an email', () => {
    expect(strikeXapiActor({ name: null, email: null, accountName: 'member:m1' }))
      .toEqual({ objectType: 'Agent', name: undefined, account: { homePage: STRIKE_XAPI_ACCOUNT_HOME, name: 'member:m1' } })
  })
})

describe('strikeXapiStatement', () => {
  it('scores a pass on the module with scaled, raw and bounds', () => {
    const s = strikeXapiStatement({ ...base, module, event: { verb: 'passed', scorePercent: 90 } })
    expect(s.verb.id).toBe('http://adlnet.gov/expapi/verbs/passed')
    expect(s.object.id).toBe(strikeXapiActivityId(module, null))
    expect(s.object.definition).toEqual({ name: { es: 'LOTO 101' }, type: 'http://adlnet.gov/expapi/activities/course' })
    expect(s.result).toEqual({ success: true, completion: true, score: { scaled: 0.9, raw: 90, min: 0, max: 100 } })
    expect(s.context.registration).toBe('attempt-1')
    expect(s.context.contextActivities).toBeUndefined()
  })

  // A supervisor-verified (assisted) completion has no score, so this is the
  // only statement that tells the LMS the learner succeeded.
  it('reports completing the module as a success, with or without a score', () => {
    const s = strikeXapiStatement({ ...base, module, event: { verb: 'completed', block: null } })
    expect(s.verb.id).toBe('http://adlnet.gov/expapi/verbs/completed')
    expect(s.result).toEqual({ completion: true, success: true })
  })

  it('records a failed attempt as unsuccessful but complete', () => {
    const s = strikeXapiStatement({ ...base, module, event: { verb: 'failed', scorePercent: 60 } })
    expect(s.result).toMatchObject({ success: false, completion: true, score: { scaled: 0.6 } })
  })

  it('describes an interaction as a cmi.interaction under its module, with hints used', () => {
    const s = strikeXapiStatement({ ...base, module, event: { verb: 'answered', block: sort, success: false, hintsUsed: 2 } })
    expect(s.object.id).toBe(strikeXapiActivityId(module, 'sort'))
    expect(s.object.definition).toEqual({
      name: { es: 'Order the steps' },
      type: 'http://adlnet.gov/expapi/activities/cmi.interaction',
      interactionType: 'sequencing',
    })
    expect(s.result).toEqual({ success: false, extensions: { 'https://soteriafield.app/xapi/strike/extensions/hints-used': 2 } })
    expect(s.context.contextActivities?.parent[0].id).toBe(strikeXapiActivityId(module, null))
  })

  it('carries the module version so an LMS can tell versions apart', () => {
    const s = strikeXapiStatement({ ...base, module, event: { verb: 'attempted' } })
    expect(s.context.extensions).toEqual({ 'https://soteriafield.app/xapi/strike/extensions/module-version': 'ver-1' })
    expect(s.result).toBeUndefined()
  })
})

describe('strikeXapiEventsForBlockEvents', () => {
  it('maps only the evidence an LMS cares about', () => {
    const events = strikeXapiEventsForBlockEvents(content, [
      { block_key: 's1', event: 'seen', detail: {} },
      { block_key: 's1', event: 'completed', detail: {} },
      { block_key: 'quiet', event: 'seen', detail: {} },
      { block_key: 'c1', event: 'seen', detail: {} },
      { block_key: 'sort', event: 'seen', detail: {} },
      { block_key: 'sort', event: 'interaction', detail: { correct: false, hints_used: 1 } },
      { block_key: 'sort', event: 'completed', detail: {} },
      { block_key: 'gone', event: 'completed', detail: {} },
    ])
    expect(events.map(e => `${e.verb}:${'block' in e ? e.block?.key : ''}`)).toEqual([
      'experienced:s1', 'experienced:quiet', 'experienced:c1', 'answered:sort', 'completed:sort',
    ])
    expect(events[3]).toMatchObject({ success: false, hintsUsed: 1 })
  })

  it('never trusts a malformed hint count from the client', () => {
    const [event] = strikeXapiEventsForBlockEvents(content, [{ block_key: 'sort', event: 'interaction', detail: { correct: true, hints_used: 'lots' } }])
    expect(event).toMatchObject({ verb: 'answered', success: true, hintsUsed: 0 })
  })
})
