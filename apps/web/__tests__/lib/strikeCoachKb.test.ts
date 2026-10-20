import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOTO_COACH_KB } from '@/lib/strike/kb/loto'
import { parseStrikeContent } from '@soteria/core/strikeContent'
import { ATTEMPT_OPEN_RULE, buildCoachDynamicPrompt, LOTO_COACH_STATIC_PROMPT, practiceCheckPrompts } from '@/lib/strike/coachPrompt'

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
    const open = buildCoachDynamicPrompt({ tenantName: 'T', moduleTitle: 'LOTO 101', attemptOpen: true, practiceChecks: [], retrievedContext: '' })
    const closed = buildCoachDynamicPrompt({ tenantName: 'T', moduleTitle: 'LOTO 101', attemptOpen: false, practiceChecks: [], retrievedContext: '' })
    expect(open).toContain(ATTEMPT_OPEN_RULE)
    expect(closed).not.toContain(ATTEMPT_OPEN_RULE)
    expect(closed).toContain('nothing retrieved')
  })
})

describe('LOTO Coach and practice checks', () => {
  const seed = JSON.parse(readFileSync(resolve(__dirname, '../../../../services/learning-studio/seed/loto-101/module.json'), 'utf8'))
  const parsed = parseStrikeContent(seed.content)
  if (!parsed.ok) throw new Error('LOTO 101 seed no longer parses')

  it('lists exactly the ungraded interactions, by the text the learner sees', () => {
    expect(practiceCheckPrompts(parsed.content)).toEqual([
      'Match each energy source to the device that isolates it.',
      'Tap every true energy-isolation point on this machine. Leave the others.',
      'Put the seven lockout steps in the right order.',
      expect.stringContaining('You arrive to help a coworker clear a jam.'),
    ])
  })

  it('names the practice checks as exempt from the open-attempt rule and tells the coach to hint, not hand over', () => {
    const prompt = buildCoachDynamicPrompt({
      tenantName: 'T', moduleTitle: 'LOTO 101', attemptOpen: true, practiceChecks: practiceCheckPrompts(parsed.content), retrievedContext: '',
    })
    expect(prompt).toContain('PRACTICE CHECKS IN THIS MODULE')
    expect(prompt).toContain('- Put the seven lockout steps in the right order.')
    expect(ATTEMPT_OPEN_RULE).toMatch(/practice checks .* are not graded and are exempt/)
    expect(LOTO_COACH_STATIC_PROMPT).toMatch(/one hint at a time/)
  })

  it('has a knowledge-base doc that covers every LOTO 101 practice check', () => {
    const doc = readFileSync(join(KB_DIR, '11-practice-checks.md'), 'utf8')
    for (const heading of ['Match each energy source', 'Tap every true energy-isolation point', 'seven lockout steps', "I locked it out"]) {
      expect(doc).toContain(heading)
    }
  })
})
