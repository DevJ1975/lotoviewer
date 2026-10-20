import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOTO_COACH_KB } from '@/lib/strike/kb/loto'
import { ATTEMPT_OPEN_RULE, buildCoachDynamicPrompt, LOTO_COACH_STATIC_PROMPT } from '@/lib/strike/coachPrompt'

const KB_DIR = resolve(__dirname, '../../lib/strike/kb/loto')
const files = readdirSync(KB_DIR).filter(f => f.endsWith('.md')).sort()

describe('LOTO Coach knowledge base', () => {
  it('ingests exactly the markdown files on disk, each with a unique key', () => {
    expect(LOTO_COACH_KB.map(d => d.file).sort()).toEqual(files)
    expect(new Set(LOTO_COACH_KB.map(d => d.key)).size).toBe(LOTO_COACH_KB.length)
  })

  it.each(files)('%s has a top heading and cites a 1910.147 paragraph', file => {
    const text = readFileSync(join(KB_DIR, file), 'utf8')
    expect(text.startsWith('# ')).toBe(true)
    expect(text).toMatch(/1910\.147\([a-f]\)/)
  })

  it.each(files)('%s attributes any fatality or injury figure to OSHA', file => {
    const text = readFileSync(join(KB_DIR, file), 'utf8')
    for (const line of text.split('\n')) {
      if (/\b\d[\d,]*\s+(deaths|fatalities|injuries)\b/i.test(line)) expect(line).toMatch(/OSHA estimates/)
    }
  })

  it('defers site decisions to the written program rather than answering yes/no', () => {
    const all = files.map(f => readFileSync(join(KB_DIR, f), 'utf8')).join('\n')
    expect(all.match(/follow your site's (written )?program/gi)?.length ?? 0).toBeGreaterThanOrEqual(5)
  })

  it('includes Spanish questions for the bilingual workforce', () => {
    const faq = readFileSync(join(KB_DIR, '10-faq.md'), 'utf8')
    const spanish = faq.slice(faq.indexOf('## Español'))
    expect(spanish.match(/^\*\*.+\?\*\*$/gm)?.length ?? 0).toBeGreaterThanOrEqual(5)
  })
})

describe('LOTO Coach prompt', () => {
  it('hard-codes the non-negotiable guardrails in the cached block', () => {
    expect(LOTO_COACH_STATIC_PROMPT).toMatch(/never authorize/i)
    expect(LOTO_COACH_STATIC_PROMPT).toMatch(/zero energy/)
    expect(LOTO_COACH_STATIC_PROMPT).toMatch(/1910\.333\(b\)\(2\)\(iv\)\(B\)/)
    expect(LOTO_COACH_STATIC_PROMPT).toMatch(/Stop\. Get clear and get your supervisor now/)
    expect(LOTO_COACH_STATIC_PROMPT).toMatch(/answer in Spanish/)
  })

  it('adds the knowledge-check rule only while an attempt is open', () => {
    const open = buildCoachDynamicPrompt({ tenantName: 'T', moduleTitle: 'LOTO 101', attemptOpen: true, retrievedContext: '' })
    const closed = buildCoachDynamicPrompt({ tenantName: 'T', moduleTitle: 'LOTO 101', attemptOpen: false, retrievedContext: '' })
    expect(open).toContain(ATTEMPT_OPEN_RULE)
    expect(closed).not.toContain(ATTEMPT_OPEN_RULE)
    expect(closed).toContain('nothing retrieved')
  })
})
