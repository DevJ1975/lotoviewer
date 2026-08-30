import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { MODEL_PRICING } from '@/lib/ai/usageAggregator'
import { SONNET, HAIKU, OPUS } from '@/lib/ai/models'

// Two invariants that the Claude 4.6/4.8 → 5 migration turned from
// cosmetic into load-bearing.

const APPS_WEB = resolve(__dirname, '../../..')
const ROOTS = ['lib', 'app/api']

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      out.push(...walk(full))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** Every `client.messages.create({ … })` call, with its file, line and body. */
function callSites(): Array<{ file: string; line: number; body: string }> {
  const sites: Array<{ file: string; line: number; body: string }> = []
  for (const root of ROOTS) {
    for (const file of walk(join(APPS_WEB, root))) {
      const src = readFileSync(file, 'utf8')
      const lines = src.split('\n')
      lines.forEach((text, i) => {
        // Skip the worked example in lib/ai/client.ts's header comment.
        if (/^\s*\/\//.test(text)) return
        if (!/messages\.create\(\{/.test(text)) return
        // Walk to the matching close brace so nested objects stay inside.
        let depth = 0
        const chunk: string[] = []
        for (let j = i; j < lines.length; j++) {
          chunk.push(lines[j])
          for (const ch of lines[j]) {
            if (ch === '{') depth++
            else if (ch === '}') depth--
          }
          if (j > i && depth <= 0) break
        }
        sites.push({ file: file.slice(APPS_WEB.length + 1), line: i + 1, body: chunk.join('\n') })
      })
    }
  }
  return sites
}

describe('thinking posture is declared at every call site', () => {
  const sites = callSites()

  it('finds the call sites at all (guards the guard)', () => {
    // If a refactor moves these, this test must fail loudly rather than
    // silently pass over an empty list.
    expect(sites.length).toBeGreaterThan(30)
  })

  // On Sonnet 4.6 / Opus 4.8, omitting `thinking` meant NO thinking. On
  // Sonnet 5 / Opus 5 it means ADAPTIVE thinking, and max_tokens caps
  // thinking PLUS response text — so a surface that omits it and parses JSON
  // out of a tight budget starts truncating and throwing. Relying on the
  // default is what made that flip dangerous; stating it is the fix.
  it.each(callSites().map(s => [`${s.file}:${s.line}`, s.body] as const))(
    '%s declares thinking explicitly',
    (_label, body) => {
      expect(body).toMatch(/thinking:\s*\{\s*type:\s*'(adaptive|disabled)'/)
    },
  )

  // Disabling thinking is only accepted at effort `high` or below on Opus 5;
  // pairing it with xhigh/max is a 400, validated per request.
  it('never pairs disabled thinking with xhigh or max effort', () => {
    for (const site of sites) {
      if (!/thinking:\s*\{\s*type:\s*'disabled'/.test(site.body)) continue
      expect(
        /effort:\s*'(xhigh|max)'/.test(site.body),
        `${site.file}:${site.line} disables thinking at xhigh/max effort, which the API rejects`,
      ).toBe(false)
    }
  })
})

describe('MODEL_PRICING covers retired ids still in ai_invocations', () => {
  it('prices the current models', () => {
    expect(MODEL_PRICING[SONNET]).toEqual({ inputPerMTok: 3, outputPerMTok: 15 })
    expect(MODEL_PRICING[HAIKU]).toEqual({ inputPerMTok: 1, outputPerMTok: 5 })
    expect(MODEL_PRICING[OPUS]).toEqual({ inputPerMTok: 5, outputPerMTok: 25 })
  })

  // The dashboard reads back months of rows. costForInvocation falls back to
  // SONNET pricing for an unknown id, which is right for the old Sonnet but
  // would silently re-price every historical Opus row at 3/15 instead of
  // 5/25 — rewriting past spend, not just future.
  it.each([
    ['claude-opus-4-8', 5, 25],
    ['claude-opus-4-7', 5, 25],
    ['claude-sonnet-4-6', 3, 15],
  ])('still prices %s at %i/%i', (id, input, output) => {
    expect(MODEL_PRICING[id as string]).toEqual({ inputPerMTok: input, outputPerMTok: output })
  })
})
