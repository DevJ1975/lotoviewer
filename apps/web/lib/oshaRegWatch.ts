// Regulatory Watch — pure transforms for the osha-reg-watch cron.
//
// TWO sources, because the two regulators publish nothing alike:
//
//   Federal OSHA — the Federal Register public JSON API, filtered to the OSHA
//     agency. osha.gov's own pages sit behind an Akamai WAF that 403s
//     datacenter clients, so a Vercel cron can't scrape them; the FR API is
//     built for programmatic access and carries the same final/proposed
//     rules, notices, comment periods, and effective dates as typed fields.
//
//   Cal/OSHA — dir.ca.gov. California rulemaking is NOT in the Federal
//     Register; the Standards Board publishes proposed regulations and
//     rulemaking notices as hand-tagged HTML with no API and no schema. So
//     that path strips tags to text and lets the model read prose, which is
//     strictly weaker than the FR path and is treated as such: a stricter
//     prompt, and a source whose layout can change without warning. Same
//     best-effort posture as scripts/ingest-cal-osha-t8.mjs.
//
// These helpers are the deterministic, side-effect-free pieces of the
// pipeline — kept here so they're unit-testable without a network round-trip
// or a model call:
//
//   federalRegisterDocsToLlmText  serialize FR documents into a labeled text
//                                 block for the model to read
//   htmlToPlainText               strip a dir.ca.gov page down to readable prose
//   calOshaPagesToLlmText         serialize those pages into one labeled block
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
  type RegulationJurisdiction,
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
  jurisdiction:       RegulationJurisdiction
  is_upcoming:        boolean
  source_url:         string
  published_date:     string | null
  effective_date:     string | null
  comment_close_date: string | null
  impact_summary:     string
  severity:           OshaUpdateSeverity | null
}

// One fetched Cal/OSHA page, already reduced to text.
export interface CalOshaPage {
  url:   string
  label: string
  text:  string
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

/**
 * Reduce a dir.ca.gov HTML page to readable prose.
 *
 * Deliberately crude — a regex strip, not a parser. The model only needs the
 * words; markup fidelity buys nothing and a real DOM parser would be a new
 * dependency in a serverless function for no gain. Script and style bodies go
 * first (their contents are text nodes that would otherwise survive), then
 * tags, then HTML entities, then whitespace is collapsed.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    // Trim per line: an unwrapped opening tag (<li>, <td>) collapses to a
    // space, so without this every scraped line arrives indented by one.
    .split('\n').map(line => line.trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Serialize fetched Cal/OSHA pages into one labeled block for the model.
 * Mirrors federalRegisterDocsToLlmText, but each record is a whole page of
 * prose rather than typed fields — so the URL line is the only thing the
 * model can reliably echo back, and computeDedupKey leans on it.
 */
export function calOshaPagesToLlmText(pages: readonly CalOshaPage[]): string {
  const blocks = pages
    .filter(p => p.text.trim() !== '')
    .map(p => [`Source: ${p.label}`, `URL: ${p.url}`, '', p.text.trim()].join('\n'))
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
export function normalizeOshaUpdate(
  raw: RawOshaItem,
  jurisdiction: RegulationJurisdiction = 'federal',
): NormalizedOshaUpdate | null {
  const title = (raw.title ?? '').trim()
  const impact_summary = (raw.impact_summary ?? '').trim()
  if (title === '' || impact_summary === '') return null

  return {
    title,
    category:           coerceCategory((raw.category ?? '').trim()),
    jurisdiction,
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
 *
 * Non-federal jurisdictions prefix the basis so two regulators can never
 * collide on the URL-less fallback path. Federal keys are left byte-identical
 * to what they were before jurisdiction existed — changing them would give
 * every already-stored row a new key, and the next run would insert a
 * duplicate of the entire feed.
 */
export function computeDedupKey(item: {
  source_url:     string
  title:          string
  published_date: string | null
  jurisdiction?:  RegulationJurisdiction
}): string {
  const url = item.source_url.trim().toLowerCase()
  const basis = url !== ''
    ? `url:${url}`
    : `title:${item.title.trim().toLowerCase()}|${item.published_date ?? ''}`
  const jurisdiction = item.jurisdiction ?? 'federal'
  const scoped = jurisdiction === 'federal' ? basis : `${jurisdiction}|${basis}`
  return createHash('sha1').update(scoped).digest('hex')
}
