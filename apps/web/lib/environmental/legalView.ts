import type { LegalApplicability, LegalCompliance, ReviewFrequency, ReviewState } from '@soteria/core/environmental/legalRegister'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import { ENV_PROGRAMS, type EnvProgram } from '@soteria/core/environmental/siteProfile'
import type { LegalEntry } from './client'

// What the legal register screen shows and how it narrows and orders it. Pure
// functions over rows the API already returned, so the screen's rules are
// testable without a browser. Review state arrives on each row, computed by the
// server against its own clock; nothing here reads the time.

export type Tone = 'good' | 'warn' | 'bad' | 'idle'
interface Meta { label: string; tone: Tone }

export const COMPLIANCE_META: Readonly<Record<LegalCompliance, Meta>> = {
  compliant:     { label: 'Compliant',       tone: 'good' },
  attention:     { label: 'Needs attention', tone: 'warn' },
  non_compliant: { label: 'Non-compliant',   tone: 'bad' },
  not_evaluated: { label: 'Not evaluated',   tone: 'idle' },
}

export const APPLICABILITY_META: Readonly<Record<LegalApplicability, Meta>> = {
  applicable:     { label: 'Applicable',     tone: 'idle' },
  not_applicable: { label: 'Not applicable', tone: 'idle' },
  under_review:   { label: 'Under review',   tone: 'warn' },
}

type ReviewFields = Pick<LegalEntry, 'last_reviewed_at' | 'next_review_due'>

const day = (iso: string | null) => iso?.slice(0, 10) ?? 'no date'

export const REVIEW_META: Readonly<Record<ReviewState, Meta & { chip: (entry: ReviewFields) => string }>> = {
  never_reviewed: { label: 'Never reviewed', tone: 'warn', chip: () => 'Never reviewed' },
  ok:             { label: 'Up to date',     tone: 'good', chip: e => (e.next_review_due ? `Review due ${day(e.next_review_due)}` : `Reviewed ${day(e.last_reviewed_at)}`) },
  due_soon:       { label: 'Due soon',       tone: 'warn', chip: e => `Review due ${day(e.next_review_due)}` },
  overdue:        { label: 'Overdue',        tone: 'bad',  chip: e => `Overdue since ${day(e.next_review_due)}` },
}

export function reviewChip(entry: ReviewFields & Pick<LegalEntry, 'review'>): { text: string; tone: Tone } {
  const meta = REVIEW_META[entry.review]
  return { text: meta.chip(entry), tone: meta.tone }
}

export const REVIEW_FREQUENCY_LABELS: Readonly<Record<ReviewFrequency, string>> = { annual: 'Every year', biennial: 'Every two years' }

export const jurisdictionLabel = (code: string) => (code === 'federal' ? 'Federal' : code)

/** The entry's program, or null for a custom entry with none (the column is free text). */
export function programOf(entry: Pick<LegalEntry, 'program'>): EnvProgram | null {
  return (ENV_PROGRAMS as readonly (string | null)[]).includes(entry.program) ? entry.program as EnvProgram : null
}

// ── names, never ids ────────────────────────────────────────────────────────

/** Who owns the entry, by name. "Assigned" when the name could not be resolved: an id is never shown. */
export function ownerName(ownerUserId: string | null, names: ReadonlyMap<string, string>): string | null {
  if (ownerUserId === null) return null
  return names.get(ownerUserId) ?? 'Assigned'
}

/** Which site the entry belongs to; null means it covers every site. */
export function siteLabel(facilityId: string | null, names: ReadonlyMap<string, string>): string {
  if (facilityId === null) return 'All sites'
  return names.get(facilityId) ?? 'Unknown site'
}

// ── narrowing ───────────────────────────────────────────────────────────────

/** An empty string means "any" for every field, which is what a native select reports. */
export interface LegalFilters {
  program:       EnvProgram | ''
  applicability: LegalApplicability | ''
  compliance:    LegalCompliance | ''
  review:        ReviewState | ''
  search:        string
}

export const NO_FILTERS: LegalFilters = { program: '', applicability: '', compliance: '', review: '', search: '' }

export const hasActiveFilters = (filters: LegalFilters) => Object.values(filters).some(value => value.trim() !== '')

function matchesCompliance(entry: LegalEntry, status: LegalCompliance): boolean {
  if (entry.compliance_status !== status) return false
  // A requirement that does not apply is settled, not waiting for a rating.
  return !(status === 'not_evaluated' && entry.applicability === 'not_applicable')
}

/** Every word typed must appear somewhere in the title, citation or summary, in any order. */
function matchesSearch(entry: LegalEntry, terms: readonly string[]): boolean {
  if (terms.length === 0) return true
  const text = [entry.title, entry.citation, entry.summary].filter(Boolean).join(' ').toLowerCase()
  return terms.every(term => text.includes(term))
}

export function filterEntries(entries: readonly LegalEntry[], filters: LegalFilters): LegalEntry[] {
  const terms = filters.search.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter(entry =>
    (filters.program === '' || entry.program === filters.program) &&
    (filters.applicability === '' || entry.applicability === filters.applicability) &&
    (filters.compliance === '' || matchesCompliance(entry, filters.compliance)) &&
    (filters.review === '' || entry.review === filters.review) &&
    matchesSearch(entry, terms))
}

// ── ordering ────────────────────────────────────────────────────────────────

// Lower sorts first: what is failing, then what needs a look, then what is merely
// late for review, then everything else.
const COMPLIANCE_SORT_RANK: Readonly<Record<LegalCompliance, number>> = { non_compliant: 0, attention: 1, not_evaluated: 3, compliant: 3 }
const OVERDUE_REVIEW_SORT_RANK = 2

function sortRank(entry: LegalEntry): number {
  const byCompliance = COMPLIANCE_SORT_RANK[entry.compliance_status]
  return entry.review === 'overdue' ? Math.min(byCompliance, OVERDUE_REVIEW_SORT_RANK) : byCompliance
}

/** A sorted copy. Array#sort is stable, so entries that tie keep the order the server sent. */
export function sortEntries(entries: readonly LegalEntry[]): LegalEntry[] {
  return [...entries].sort((a, b) => sortRank(a) - sortRank(b) || a.title.localeCompare(b.title))
}

// ── the summary strip ───────────────────────────────────────────────────────

type TileFilter =
  | { dimension: 'compliance';    value: LegalCompliance }
  | { dimension: 'applicability'; value: LegalApplicability }
  | { dimension: 'review';        value: ReviewState }

/** A count on the strip, and the one filter it stands for. */
export interface SummaryTile { label: string; tone: Tone; filter: TileFilter }

export const SUMMARY_TILES: readonly SummaryTile[] = [
  { ...COMPLIANCE_META.compliant,        filter: { dimension: 'compliance',    value: 'compliant' } },
  { ...COMPLIANCE_META.attention,        filter: { dimension: 'compliance',    value: 'attention' } },
  { ...COMPLIANCE_META.non_compliant,    filter: { dimension: 'compliance',    value: 'non_compliant' } },
  { ...COMPLIANCE_META.not_evaluated,    filter: { dimension: 'compliance',    value: 'not_evaluated' } },
  { ...APPLICABILITY_META.under_review,  filter: { dimension: 'applicability', value: 'under_review' } },
  { label: 'Reviews overdue', tone: REVIEW_META.overdue.tone, filter: { dimension: 'review', value: 'overdue' } },
]

/** Each count is, by construction, the number of rows its filter shows when it is the only one applied. */
export function summarize(entries: readonly LegalEntry[]): Array<{ tile: SummaryTile; count: number }> {
  return SUMMARY_TILES.map(tile => ({
    tile,
    count: filterEntries(entries, { ...NO_FILTERS, [tile.filter.dimension]: tile.filter.value }).length,
  }))
}

export const isTileActive = (filters: LegalFilters, tile: SummaryTile) => filters[tile.filter.dimension] === tile.filter.value

/** Clicking a count applies its filter; clicking it again lifts it. Other filters are left alone. */
export function toggleTile(filters: LegalFilters, tile: SummaryTile): LegalFilters {
  return { ...filters, [tile.filter.dimension]: isTileActive(filters, tile) ? '' : tile.filter.value }
}

// ── the library's "verify" note ─────────────────────────────────────────────

const STATE_CODE = /^[A-Z]{2}$/

/**
 * What the library says to check about this entry, if anything. Entries are stored
 * without the note, so it is looked up from the library of the jurisdiction that
 * defined the entry: a state's version of a requirement carries the state's note.
 * A custom entry has no library key, and so no note.
 */
export function verifyNoteFor(entry: Pick<LegalEntry, 'library_key' | 'jurisdiction'>): string | null {
  if (entry.library_key === null) return null
  const state = STATE_CODE.test(entry.jurisdiction) ? entry.jurisdiction : null
  return libraryForState(state).library.legal.find(def => def.id === entry.library_key)?.verify ?? null
}

// ── links ───────────────────────────────────────────────────────────────────

const HTTP_URL = /^https?:\/\/\S+$/i

/** The address if it is safe to put in a link (web pages only: never "javascript:"), else null. */
export const linkableUrl = (url: string | null): string | null => (url !== null && HTTP_URL.test(url) ? url : null)

// ── evaluating ──────────────────────────────────────────────────────────────

export interface EvaluationDraft {
  applicability:     LegalApplicability
  complianceStatus:  LegalCompliance
  note:              string
  /** The stored path of the attached evidence, or null for none. */
  evidencePath:      string | null
}

export interface EvaluationBody {
  applicability:     LegalApplicability
  compliance_status: LegalCompliance
  note:              string | null
  evidence_path?:    string | null
}

/**
 * The request for an evaluation. A requirement that does not apply is sent as
 * "not evaluated", the only rating the API accepts for it. Evidence is sent only
 * when it changed: left out, the entry keeps the evidence it has.
 */
export function evaluationBody(draft: EvaluationDraft, current: Pick<LegalEntry, 'evidence_path'>): EvaluationBody {
  return {
    applicability:     draft.applicability,
    compliance_status: draft.applicability === 'not_applicable' ? 'not_evaluated' : draft.complianceStatus,
    note:              draft.note.trim() || null,
    ...(draft.evidencePath !== current.evidence_path ? { evidence_path: draft.evidencePath } : {}),
  }
}
