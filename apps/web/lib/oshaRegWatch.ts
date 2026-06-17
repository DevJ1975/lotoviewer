// OSHA Regulatory Watch — pure transforms for the osha-reg-watch cron.
//
// Source of record is the Federal Register public JSON API (the official
// publication channel for OSHA rulemaking), filtered to the OSHA agency.
// osha.gov's own pages sit behind an Akamai WAF that 403s datacenter clients,
// so a Vercel cron can't scrape them — but the Federal Register API is built
// for programmatic access and carries the same final/proposed rules, notices,
// comment periods, and effective dates as structured fields.
//
// These helpers are the deterministic, side-effect-free pieces of the
// pipeline — kept here so they're unit-testable without a network round-trip
// or a model call:
//
//   federalRegisterDocsToLlmText  serialize FR documents into a labeled text
//                                 block for the model to read
//   normalizeOshaUpdate           validate + coerce one model item into a DB row
//   computeDedupKey               derive a stable idempotency key for the unique constraint
//
// Why the model never supplies the dedup key: re-running the cron over the
// same documents must produce identical keys so the unique constraint makes
// the insert idempotent. A key the model invents could drift run-to-run; a key
// WE derive from the document's canonical URL cannot.

import { createHash } from 'node:crypto'
import {
  OSHA_UPDATE_CATEGORIES,
  OSHA_UPDATE_SEVERITIES,
  type OshaUpdateCategory,
  type OshaUpdateSeverity,
} from '@soteria/core/oshaRegWatch'

// The subset of a Federal Register document (documents.json) the cron reads.
// Every field is nullable because we request them via `fields[]` and the API
// omits/null-fills any the document doesn't carry.
export interface FederalRegisterDoc {
  document_number:   string | null
  title:             string | null
  type:              string | null   // 'Rule' | 'Proposed Rule' | 'Notice' | ...
  publication_date:  string | null   // ISO YYYY-MM-DD
  effective_on:      string | null
  comments_close_on: string | null
  abstract:          string | null
  html_url:          string | null
}

// One item exactly as Claude emits it under the route's json_schema. The
// model is instructed to emit '' for absent fields rather than omit them, so
// every string may be a placeholder; normalizeOshaUpdate does the coercion.
export interface RawOshaItem {
  title:               string
  category:            string
  is_upcoming:         boolean
  source_url:          string
  published_date?:     string
  effective_date?:     string
  comment_close_date?: string
  impact_summary:      string
  severity:            string
}

// A model item after validation + coercion: ready to insert, minus the
// cron-owned columns (dedup_key, ai_model, fetched_at). null date fields mean
// "absent / unparseable".
export interface NormalizedOshaUpdate {
  title:              string
  category:           OshaUpdateCategory
  is_upcoming:        boolean
  source_url:         string
  published_date:     string | null
  effective_date:     string | null
  comment_close_date: string | null
  impact_summary:     string
  severity:           OshaUpdateSeverity | null
}

const MAX_TEXT_CHARS = 40_000

/**
 * Serialize Federal Register documents into a compact, labeled text block for
 * the model. Each document becomes a delimited record carrying its title,
 * type, key dates, canonical URL, and abstract — the same shape the model is
 * asked to extract back out. The URL line is load-bearing: computeDedupKey
 * hashes the URL the model echoes, so every doc with an html_url surfaces it.
 * Output is hard-capped so an unusually large batch can't blow the prompt.
 */
export function federalRegisterDocsToLlmText(docs: FederalRegisterDoc[]): string {
  const blocks = docs.map(doc => {
    const lines = [
      `Title: ${(doc.title ?? '').trim()}`,
      `Type: ${(doc.type ?? '').trim()}`,
      doc.publication_date  ? `Published: ${doc.publication_date}`        : null,
      doc.effective_on      ? `Effective: ${doc.effective_on}`           : null,
      doc.comments_close_on ? `Comments close: ${doc.comments_close_on}` : null,
      doc.html_url          ? `URL: ${doc.html_url}`                     : null,
      doc.abstract          ? `Abstract: ${doc.abstract.trim()}`         : null,
    ].filter(Boolean)
    return lines.join('\n')
  })
  const text = blocks.join('\n\n---\n\n')
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Accept only a real ISO calendar date; anything else (placeholder '',
// "TBD", an impossible date the regex would still pass) becomes null.
function coerceDate(v: string | undefined): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (!ISO_DATE_RE.test(trimmed)) return null
  const d = new Date(`${trimmed}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) return null
  return trimmed
}

function coerceCategory(v: string): OshaUpdateCategory {
  return (OSHA_UPDATE_CATEGORIES as readonly string[]).includes(v)
    ? (v as OshaUpdateCategory)
    : 'other'
}

function coerceSeverity(v: string): OshaUpdateSeverity | null {
  return (OSHA_UPDATE_SEVERITIES as readonly string[]).includes(v)
    ? (v as OshaUpdateSeverity)
    : null
}

/**
 * Validate + coerce one model item into a DB-ready row. Returns null when the
 * item lacks the two fields that make it worth showing — a title and an
 * impact summary — so a hallucinated or empty entry never reaches the table.
 * Unknown categories degrade to 'other'; unparseable dates degrade to null.
 */
export function normalizeOshaUpdate(raw: RawOshaItem): NormalizedOshaUpdate | null {
  const title = (raw.title ?? '').trim()
  const impact_summary = (raw.impact_summary ?? '').trim()
  if (title === '' || impact_summary === '') return null

  return {
    title,
    category:           coerceCategory((raw.category ?? '').trim()),
    is_upcoming:        raw.is_upcoming === true,
    source_url:         (raw.source_url ?? '').trim(),
    published_date:     coerceDate(raw.published_date),
    effective_date:     coerceDate(raw.effective_date),
    comment_close_date: coerceDate(raw.comment_close_date),
    impact_summary,
    severity:           coerceSeverity((raw.severity ?? '').trim()),
  }
}

/**
 * Stable idempotency key for the unique constraint. Prefer the source URL (a
 * Federal Register document's canonical, permanent html_url); fall back to
 * title + published date on the rare doc with no URL. Always returns a
 * non-empty hash, so a row can never collide on a NULL key.
 */
export function computeDedupKey(item: {
  source_url:     string
  title:          string
  published_date: string | null
}): string {
  const url = item.source_url.trim().toLowerCase()
  const basis = url !== ''
    ? `url:${url}`
    : `title:${item.title.trim().toLowerCase()}|${item.published_date ?? ''}`
  return createHash('sha1').update(basis).digest('hex')
}
