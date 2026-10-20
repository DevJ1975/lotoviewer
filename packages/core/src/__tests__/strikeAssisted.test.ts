import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStrikeContent, type StrikeContent } from '../strikeContent'
import {
  missingAssistedBlocks,
  strikeAssistedAcknowledgment,
  strikeAssistedChecklist,
  strikeAssistedContent,
  uncheckedChecklistItems,
} from '../strikeAssisted'

function seed(file: string): StrikeContent {
  const module = JSON.parse(readFileSync(resolve(__dirname, `../../../../services/learning-studio/seed/loto-101/${file}`), 'utf8'))
  const parsed = parseStrikeContent(module.content)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
  return parsed.content
}

const content = seed('module.json')

describe('strikeAssistedContent', () => {
  it('keeps only the scenes, in their original order', () => {
    const keys = strikeAssistedContent(content).blocks.map(b => b.key)
    expect(keys).toEqual(['s1-why', 's2-energy', 's3-roles', 's4-prepare', 's5-isolate', 's6-verify', 's7-group', 's8-restart'])
  })
})

describe('missingAssistedBlocks', () => {
  it('needs every scene played through, and nothing else', () => {
    const scenes = strikeAssistedContent(content).blocks.map(b => b.key)
    const allButLast = scenes.slice(0, -1).map(block_key => ({ block_key, event: 'completed' as const }))
    expect(missingAssistedBlocks(content, allButLast)).toEqual(['s8-restart'])
    expect(missingAssistedBlocks(content, [...allButLast, { block_key: 's8-restart', event: 'completed' }])).toEqual([])
  })
})

describe('strikeAssistedChecklist', () => {
  it('names the learner and turns each safety callout into its own item to read aloud', () => {
    const items = strikeAssistedChecklist(content, { learnerName: 'Ana', locale: 'en' })
    expect(items.map(i => i.key)).toEqual(['discussed', 'callout:c1-stored', 'questions', 'demonstrated'])
    expect(items[1].text).toContain('“A locked machine can still hurt you”')
    expect(items[1].detail).toMatch(/^Hydraulic cylinders, springs/)
    expect(items.every(i => i.text.includes('Ana'))).toBe(true)
  })

  it('is fully in Spanish for the Spanish version', () => {
    const items = strikeAssistedChecklist(seed('module.es.json'), { learnerName: 'Ana', locale: 'es' })
    expect(items[0].text).toBe('Repasé cada video con Ana y respondí sus preguntas.')
    expect(items[1].text).toContain('“Una máquina bloqueada todavía puede lastimarlo”')
  })

  it('reports exactly which items are still unticked', () => {
    const items = strikeAssistedChecklist(content, { learnerName: 'Ana', locale: 'en' })
    expect(uncheckedChecklistItems(items, ['discussed', 'questions'])).toEqual(['callout:c1-stored', 'demonstrated'])
    expect(uncheckedChecklistItems(items, items.map(i => i.key))).toEqual([])
  })
})

describe('strikeAssistedAcknowledgment', () => {
  it('states the accommodation and the in-person verification in the learner’s language', () => {
    expect(strikeAssistedAcknowledgment({ learnerName: 'Ana', moduleTitle: 'LOTO 101', locale: 'en' }))
      .toMatch(/verified, in person, that Ana understands “LOTO 101”.*reading and writing accommodation/)
    expect(strikeAssistedAcknowledgment({ learnerName: 'Ana', moduleTitle: 'LOTO 101', locale: 'es' }))
      .toMatch(/verifiqué en persona que Ana entiende “LOTO 101”/)
  })
})
