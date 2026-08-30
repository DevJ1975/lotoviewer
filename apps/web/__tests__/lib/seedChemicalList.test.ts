import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { searchCommonChemicals, normalizeChemicalList } from '@/lib/ai/seedChemicalList'

// Unit-test the deterministic seams of seed-list generation with a mocked
// Anthropic client: the pause_turn continuation loop terminates, and normalize
// drops nameless rows + nulls malformed CAS. No network, no real model.

function textMsg(text: string, stop: string): Anthropic.Message {
  return {
    content: [{ type: 'text', text }],
    stop_reason: stop,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message
}

function clientWith(create: ReturnType<typeof vi.fn>): Anthropic {
  return { messages: { create } } as unknown as Anthropic
}

describe('searchCommonChemicals', () => {
  it('resumes pause_turn then returns the final text with summed usage', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(textMsg('searching…', 'pause_turn'))
      .mockResolvedValueOnce(textMsg('Acetone (67-64-1), Fisher', 'end_turn'))
    const { rawText, usage } = await searchCommonChemicals(clientWith(create), 50)
    expect(create).toHaveBeenCalledTimes(2)
    expect(rawText).toContain('Acetone')
    expect(usage.inputTokens).toBe(2)
  })

  it('caps continuations so a permanently-paused loop terminates', async () => {
    const create = vi.fn().mockResolvedValue(textMsg('still searching', 'pause_turn'))
    await searchCommonChemicals(clientWith(create), 50)
    // MAX_CONTINUATIONS = 5 → at most 6 calls.
    expect(create).toHaveBeenCalledTimes(6)
  })

  it('passes an exclude list into the prompt to avoid repeats', async () => {
    const create = vi.fn().mockResolvedValue(textMsg('ok', 'end_turn'))
    await searchCommonChemicals(clientWith(create), 10, ['Acetone', 'Toluene'])
    const sentMessages = create.mock.calls[0][0].messages
    expect(JSON.stringify(sentMessages)).toContain('Acetone')
    expect(JSON.stringify(sentMessages)).toContain('Toluene')
  })
})

describe('normalizeChemicalList', () => {
  it('keeps named rows, nulls malformed CAS, and empties blank manufacturer', async () => {
    const payload = {
      chemicals: [
        { name: 'Acetone',  cas: '67-64-1', manufacturer: 'Fisher', rationale: 'Common solvent' },
        { name: 'Mystery',  cas: 'not-a-cas', manufacturer: '', rationale: '' },
        { name: '',         cas: '7732-18-5', manufacturer: 'X', rationale: 'no name → dropped' },
      ],
    }
    const create = vi.fn().mockResolvedValue(textMsg(JSON.stringify(payload), 'end_turn'))
    const { chemicals } = await normalizeChemicalList(clientWith(create), 'some prose')

    expect(chemicals.map(c => c.name)).toEqual(['Acetone', 'Mystery'])
    expect(chemicals[0]).toMatchObject({ cas: '67-64-1', manufacturer: 'Fisher' })
    expect(chemicals[1].cas).toBeNull()          // 'not-a-cas' rejected
    expect(chemicals[1].manufacturer).toBeNull() // '' → null
  })

  it('returns [] without calling the model when there is no prose', async () => {
    const create = vi.fn()
    const { chemicals } = await normalizeChemicalList(clientWith(create), '   ')
    expect(chemicals).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })

  it('returns [] on non-JSON output rather than throwing', async () => {
    const create = vi.fn().mockResolvedValue(textMsg('not json', 'end_turn'))
    const { chemicals } = await normalizeChemicalList(clientWith(create), 'prose')
    expect(chemicals).toEqual([])
  })
})
