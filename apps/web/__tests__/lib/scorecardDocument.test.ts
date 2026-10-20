// @vitest-environment node
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildScorecardDocx, type ScorecardDocumentInput } from '@/lib/scorecardDocument'
import { summarizeIncidentRisk } from '@soteria/core/incidentRiskModel'
import { microlearningFixture } from '../fixtures/microlearning'

// The Word export is opened by people, not parsed by us, so the contract is:
// a well-formed .docx whose text carries the same numbers as the other
// formats, and nothing Word would refuse to open.

const risk = summarizeIncidentRisk({
  recordablesRecent: 6, recordablesPrior: 2, nearMissRecent: 0,
  bbsSafe: 0, bbsUnsafe: 10, capasOverdue: 8, riskReviewsOverdue: 9,
  highRisksUncontrolled: 4, trainingExpired: 6, atmFailed: 10, atmTotal: 10,
  hazardHuntsDue: 10, hazardHuntsDone: 0, hhFindingsOpened: 8, hhFindingsResolved: 0,
})

function input(overrides: Partial<ScorecardDocumentInput> = {}): ScorecardDocumentInput {
  return {
    tenantName: 'Acme — “Field” & Co.',
    windowDays: 30,
    loto: { totalPermits: 42, cancelRate: 12, failingTestRate: 4, photoCompletionPct: 88 },
    incident: { trir: 3.21, dart: 1.8, ltir: 0.9, severityRate: 12.4, totalRecordable: 6, daysSinceLastRecordable: 14 },
    risk,
    microlearning: microlearningFixture(),
    generatedAt: new Date('2026-11-10T12:00:00Z'),
    ...overrides,
  }
}

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('word/document.xml')?.async('string')
  if (!xml) throw new Error('word/document.xml missing')
  return xml
}

/** The document's visible text, runs joined. */
function plainText(xml: string): string {
  return [...xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join(' ')
}

describe('buildScorecardDocx', () => {
  it('produces a Word document with the headline safety numbers', async () => {
    const text = plainText(await documentXml(await buildScorecardDocx(input())))
    expect(text).toContain('EHS Scorecard — Acme — “Field” &amp; Co.')
    expect(text).toContain('TRIR (per 100 FTE)')
    expect(text).toContain('3.21')
    expect(text).toContain('Predicted risk')
  })

  it('carries the microlearning facts and per-module table in the shared wording', async () => {
    const text = plainText(await documentXml(await buildScorecardDocx(input())))
    expect(text).toContain('Microlearning (STRIKE) — last 30 days')
    expect(text).toContain('Completions (last 30 days)')
    expect(text).toContain('LOTO 101: Control of Hazardous Energy')
    expect(text).toContain('English 1 · Spanish 1')
    expect(text).toContain('Supervisor-verified (ADA) completions count as completions')
  })

  it('strips characters XML forbids, which would stop Word opening the file', async () => {
    const xml = await documentXml(await buildScorecardDocx(input()))
    expect(xml).not.toMatch(/\u0007/)
    expect(plainText(xml)).toContain('=HYPERLINK(&quot;http://evil&quot;) Confined Space')
  })

  it('leaves the microlearning section out when STRIKE is off', async () => {
    const text = plainText(await documentXml(await buildScorecardDocx(input({ microlearning: null, risk: null }))))
    expect(text).not.toContain('Microlearning')
    expect(text).toContain('Executive summary')
  })
})
