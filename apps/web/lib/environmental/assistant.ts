import { daysUntilDue } from '@soteria/core/complianceCalendar'
import type { Resolved, GuideDef } from '@soteria/core/environmental/content'
import { fallbackNotice, resolveJurisdiction } from '@soteria/core/environmental/jurisdiction'
import { summarizeEnvironmentalKpis, type EnvKpis } from '@soteria/core/environmental/metrics'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { ENV_PROGRAMS, type EnvProgram } from '@soteria/core/environmental/siteProfile'

// What the assistant says about environmental compliance: how-to answers from the
// library, and where each site stands. Both are deterministic and need no AI
// search, so the assistant has real answers even when retrieval is not configured.
// The library is drafted with citations and is not yet signed off by an expert;
// every answer says so, because an assistant that sounds certain about a
// regulation is worse than one that says what it is.

export const GUIDANCE_DISCLAIMER =
  'Drafted from the regulations with citations and not yet reviewed by a Certified Safety Professional. Confirm against the current text and your permits before relying on it. This is guidance, not legal advice.'

const MAX_GUIDES = 3
const MAX_REQUIREMENTS = 6
const MAX_SUMMARY = 300

const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2)

function guideText(guide: Resolved<GuideDef>): string {
  return [
    guide.title, ...guide.quickSteps,
    ...guide.sections.flatMap(s => [s.title, ...s.paragraphs, ...(s.bullets ?? [])]),
  ].join(' ')
}

/** How many of the topic's words the guide mentions; the title counts extra, since it names the subject. */
function relevance(guide: Resolved<GuideDef>, topicWords: readonly string[]): number {
  const body = new Set(wordsOf(guideText(guide)))
  const title = new Set(wordsOf(guide.title))
  return topicWords.reduce((score, w) => score + (body.has(w) ? 1 : 0) + (title.has(w) ? 2 : 0), 0)
}

export interface GuidanceInput {
  program?: string
  state?: string | null
  topic?: string
}

export function findGuidance(input: GuidanceInput) {
  const program = (ENV_PROGRAMS as readonly string[]).includes(input.program ?? '') ? (input.program as EnvProgram) : null
  const { library } = libraryForState(input.state)
  const jurisdiction = resolveJurisdiction(input.state)
  const topicWords = wordsOf(input.topic ?? '')

  const inProgram = library.guides.filter(g => program === null || g.program === program || g.program === 'overview')
  const ranked = topicWords.length > 0
    ? inProgram.map(g => ({ g, score: relevance(g, topicWords) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).map(r => r.g)
    : inProgram
  const guides = ranked.slice(0, MAX_GUIDES).map(g => ({
    title: g.title,
    program: g.program,
    quickSteps: g.quickSteps,
    sections: g.sections.map(s => ({
      title: s.title,
      text: [...s.paragraphs, ...(s.bullets ?? [])].join(' '),
      citations: (s.citations ?? []).map(c => c.ref),
    })),
  }))

  const requirements = library.legal
    .filter(l => program === null || l.program === program)
    .slice(0, MAX_REQUIREMENTS)
    .map(l => ({
      title: l.title,
      citation: l.citation,
      jurisdiction: l.source,
      summary: l.summary.length > MAX_SUMMARY ? `${l.summary.slice(0, MAX_SUMMARY - 1)}…` : l.summary,
      needsChecking: l.verify ?? null,
    }))

  return {
    jurisdiction: { chain: jurisdiction.chain, status: jurisdiction.status },
    notice: fallbackNotice(jurisdiction),
    disclaimer: GUIDANCE_DISCLAIMER,
    guides,
    requirements,
    found: guides.length > 0 || requirements.length > 0,
  }
}

// ── where each site stands ──────────────────────────────────────────────────

export interface SiteRows {
  site:        { id: string; name: string; state: string | null }
  obligations: ReadonlyArray<{ status: string; next_due_at: string; lead_days: number }>
  permits:     ReadonlyArray<{ status: string; expiration_date: string | null; renewal_lead_days: number }>
  legal:       ReadonlyArray<{ applicability: string; compliance_status: string; last_reviewed_at: string | null; next_review_due: string | null }>
  findings:    ReadonlyArray<{ status: string }>
}

export interface SiteStanding extends EnvKpis {
  site: string
  state: string | null
  legalNonCompliant: number
  legalNeedsAttention: number
  /** The soonest open deadline and how far off it is (negative = overdue). */
  nextDeadline: { dueOn: string; days: number } | null
}

export function standingOf(rows: SiteRows, now: Date): SiteStanding {
  const kpis = summarizeEnvironmentalKpis({
    obligations: rows.obligations.map(o => ({ status: o.status, nextDueAt: o.next_due_at, leadDays: o.lead_days })),
    checklistTemplates: [],
    findings: rows.findings,
    permits: rows.permits.map(p => ({ status: p.status, expirationDate: p.expiration_date, renewalLeadDays: p.renewal_lead_days })),
    legal: rows.legal.map(l => ({ applicability: l.applicability, lastReviewedAt: l.last_reviewed_at, nextReviewDue: l.next_review_due })),
  }, now)
  const applicable = rows.legal.filter(l => l.applicability === 'applicable')
  const open = rows.obligations.filter(o => o.status === 'open').map(o => o.next_due_at).sort()
  return {
    site: rows.site.name,
    state: rows.site.state,
    ...kpis,
    legalNonCompliant: applicable.filter(l => l.compliance_status === 'non_compliant').length,
    legalNeedsAttention: applicable.filter(l => l.compliance_status === 'attention').length,
    nextDeadline: open[0] ? { dueOn: open[0], days: daysUntilDue(open[0], now) } : null,
  }
}

/**
 * Group rows by site. A row with no site (a requirement or deadline that covers every
 * site) counts for each of them, because each site is subject to it.
 */
export function groupBySite<T extends { facility_id: string | null }>(rows: readonly T[], siteId: string): T[] {
  return rows.filter(r => r.facility_id === null || r.facility_id === siteId)
}
