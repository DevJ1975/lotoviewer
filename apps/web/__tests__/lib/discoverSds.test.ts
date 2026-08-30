import { describe, it, expect, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { searchSdsCandidates, normalizeCandidates } from '@/lib/ai/discoverSds'

// Unit-test the deterministic seams of discovery with a mocked Anthropic
// client: the pause_turn continuation loop terminates, and normalize drops
// candidates without a real https URL. No network, no real model.

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

describe('searchSdsCandidates', () => {
  it('resumes pause_turn then returns the final text', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce(textMsg('searching…', 'pause_turn'))
      .mockResolvedValueOnce(textMsg('Found: https://fishersci.com/acetone.pdf', 'end_turn'))
    const { rawText, usage } = await searchSdsCandidates(clientWith(create), {
      productName: 'Acetone', manufacturer: 'Fisher', productCode: null,
    })
    expect(create).toHaveBeenCalledTimes(2)
    expect(rawText).toContain('fishersci.com/acetone.pdf')
    expect(usage.inputTokens).toBe(2) // summed across both calls
  })

  it('caps continuations so a permanently-paused loop terminates', async () => {
    const create = vi.fn().mockResolvedValue(textMsg('still searching', 'pause_turn'))
    await searchSdsCandidates(clientWith(create), { productName: 'X', manufacturer: null, productCode: null })
    // MAX_CONTINUATIONS = 5 → at most 6 calls.
    expect(create).toHaveBeenCalledTimes(6)
  })
})

describe('normalizeCandidates', () => {
  it('keeps https candidates, drops insecure/missing URLs, and defaults bad confidence', async () => {
    const payload = {
      candidates: [
        { url: 'https://ok.com/sds.pdf', title: 'Acetone SDS', manufacturer: 'Fisher', product_name: 'Acetone', revision_date: '2025-01-01', confidence: 'high', reasons: 'Exact match' },
        { url: 'https://ok2.com/a.pdf', title: 'B', manufacturer: '', product_name: '', revision_date: null, confidence: 'weird', reasons: '' },
        { url: 'http://insecure.com/x.pdf', title: 'insecure', manufacturer: '', product_name: '', revision_date: null, confidence: 'low', reasons: '' },
        { title: 'no url', manufacturer: '', product_name: '', revision_date: null, confidence: 'low', reasons: '' },
      ],
    }
    const create = vi.fn().mockResolvedValue(textMsg(JSON.stringify(payload), 'end_turn'))
    const { candidates } = await normalizeCandidates(clientWith(create), 'some prose with links')

    expect(candidates.map(c => c.url)).toEqual(['https://ok.com/sds.pdf', 'https://ok2.com/a.pdf'])
    expect(candidates[0]).toMatchObject({ manufacturer: 'Fisher', revisionDate: '2025-01-01', confidence: 'high', reasonsItMatches: 'Exact match' })
    expect(candidates[1].confidence).toBe('low') // 'weird' coerced
  })

  it('returns [] without calling the model when there is no prose', async () => {
    const create = vi.fn()
    const { candidates } = await normalizeCandidates(clientWith(create), '   ')
    expect(candidates).toEqual([])
    expect(create).not.toHaveBeenCalled()
  })

  it('returns [] on non-JSON output rather than throwing', async () => {
    const create = vi.fn().mockResolvedValue(textMsg('not json', 'end_turn'))
    const { candidates } = await normalizeCandidates(clientWith(create), 'prose')
    expect(candidates).toEqual([])
  })
})
