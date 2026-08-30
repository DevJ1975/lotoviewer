// The FPE agent is the vision pass. Its safety-relevant behavior is that a
// photo it cannot load is authoritatively "missing" — never the model's word —
// and that when BOTH photos are absent it returns synthetic verdicts WITHOUT
// burning a vision call. We mock fetchImageAsBase64 (the only I/O seam) and a
// stub Anthropic client, then assert the verdict-forcing and the no-call path.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import type { FpeResult } from '@/lib/loto/audit/schemas'

// fetchImageAsBase64 is the seam between storage and the vision call. Mock it
// so each test controls exactly which photos "load".
const fetchImageAsBase64 = vi.fn<
  (url: string | null | undefined) => Promise<{ base64: string; mediaType: string } | null>
>()
vi.mock('@/lib/loto/audit/imageFetch', () => ({
  fetchImageAsBase64: (url: string | null | undefined) => fetchImageAsBase64(url),
}))

import { runFpeAgent } from '@/lib/loto/audit/agents/fpe'

// The model would return "match" for both if asked — so any "missing" verdict
// in the result proves the TS forcing, not the model.
const MODEL_BOTH_MATCH: FpeResult = {
  equip_photo: { verdict: 'match', confidence: 'high', notes: 'Shows the machine.' },
  iso_photo: {
    verdict: 'match', confidence: 'high',
    shows_isolation_point: true, consistent_with_energy_steps: true,
    notes: 'Shows the disconnect.',
  },
}

// Typed impl param so .mock.calls entries are tuples we can index into.
const messagesCreate = vi.fn(async (_args: unknown) => ({
  content: [{ type: 'text', text: JSON.stringify(MODEL_BOTH_MATCH) }],
  usage: { input_tokens: 20, output_tokens: 10 },
}))
const client = { messages: { create: messagesCreate } } as unknown as Anthropic

const EQUIPMENT: Equipment = {
  equipment_id: 'EQ-001',
  description: 'Industrial dough mixer',
  department: 'Bakery',
  equip_photo_url: 'https://cdn.example/eq.jpg',
  iso_photo_url: 'https://cdn.example/iso.jpg',
  decommissioned: false,
} as unknown as Equipment

const STEPS: LotoEnergyStep[] = []

const FAKE_IMAGE = { base64: 'AAAA', mediaType: 'image/jpeg' as const }

beforeEach(() => {
  messagesCreate.mockClear()
  fetchImageAsBase64.mockReset()
})

describe('runFpeAgent — both photos absent', () => {
  it('returns synthetic "missing" verdicts and makes NO Anthropic call', async () => {
    fetchImageAsBase64.mockResolvedValue(null) // both fetches fail

    const { result, usage } = await runFpeAgent(client, EQUIPMENT, STEPS)

    expect(messagesCreate).not.toHaveBeenCalled()
    expect(result.equip_photo.verdict).toBe('missing')
    expect(result.iso_photo.verdict).toBe('missing')
    // No vision call means no token usage.
    expect(usage).toBeNull()
  })
})

describe('runFpeAgent — one photo absent', () => {
  it('forces the equipment slot to "missing" when only the equip photo fails to load', async () => {
    // equip → null, iso → loads. Model still says both match.
    fetchImageAsBase64.mockImplementation(async (url) =>
      url === EQUIPMENT.iso_photo_url ? FAKE_IMAGE : null,
    )

    const { result } = await runFpeAgent(client, EQUIPMENT, STEPS)

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    // The unloadable equip photo is authoritatively missing despite the model.
    expect(result.equip_photo.verdict).toBe('missing')
    // The loaded iso photo keeps the model's verdict.
    expect(result.iso_photo.verdict).toBe('match')
  })

  it('forces the isolation slot to "missing" when only the iso photo fails to load', async () => {
    fetchImageAsBase64.mockImplementation(async (url) =>
      url === EQUIPMENT.equip_photo_url ? FAKE_IMAGE : null,
    )

    const { result } = await runFpeAgent(client, EQUIPMENT, STEPS)

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(result.iso_photo.verdict).toBe('missing')
    expect(result.equip_photo.verdict).toBe('match')
  })

  it('sends exactly one image content block when only one photo loads', async () => {
    fetchImageAsBase64.mockImplementation(async (url) =>
      url === EQUIPMENT.equip_photo_url ? FAKE_IMAGE : null,
    )

    await runFpeAgent(client, EQUIPMENT, STEPS)

    const args = messagesCreate.mock.calls[0]![0] as { messages: Array<{ content: Array<{ type: string }> }> }
    const blocks = args.messages[0]!.content
    expect(blocks.filter(b => b.type === 'image')).toHaveLength(1)
  })
})

describe('runFpeAgent — both photos present', () => {
  it('parses the model JSON and keeps both verdicts', async () => {
    fetchImageAsBase64.mockResolvedValue(FAKE_IMAGE)

    const { result } = await runFpeAgent(client, EQUIPMENT, STEPS)

    expect(messagesCreate).toHaveBeenCalledTimes(1)
    expect(result.equip_photo.verdict).toBe('match')
    expect(result.iso_photo.verdict).toBe('match')
  })

  it('sends two image content blocks when both photos are present', async () => {
    fetchImageAsBase64.mockResolvedValue(FAKE_IMAGE)

    await runFpeAgent(client, EQUIPMENT, STEPS)

    const args = messagesCreate.mock.calls[0]![0] as {
      messages: Array<{ content: Array<{ type: string }> }>
      output_config?: { format?: { type?: string } }
    }
    const blocks = args.messages[0]!.content
    expect(blocks.filter(b => b.type === 'image')).toHaveLength(2)
    // Structured-output path is used (json_schema), mirroring generate-loto-steps.
    expect(args.output_config?.format?.type).toBe('json_schema')
  })
})

describe('runFpeAgent — response parsing', () => {
  it('throws when the response carries no text block', async () => {
    fetchImageAsBase64.mockResolvedValue(FAKE_IMAGE)
    messagesCreate.mockResolvedValueOnce({ content: [], usage: null } as never)

    await expect(runFpeAgent(client, EQUIPMENT, STEPS)).rejects.toThrow(/no text block/i)
  })
})
