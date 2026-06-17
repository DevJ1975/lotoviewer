// OSHA Regulatory Watch — pure transforms for the osha-reg-watch cron.
//
// The cron fetches osha.gov HTML, hands a reduced text payload to Claude,
// and upserts the model's extracted items. These helpers are the
// deterministic, side-effect-free pieces of that pipeline — kept here so
// they're unit-testable without a network round-trip or a model call:
//
//   htmlToLlmText        reduce raw HTML to link-preserving plain text for the prompt
//   normalizeOshaUpdate  validate + coerce one model item into a DB-ready row
//   computeDedupKey      derive a stable idempotency key for the unique constraint
//
// Why the model never supplies the dedup key: re-running the cron over an
// unchanged page must produce identical keys so the unique constraint makes
// the insert idempotent. A key the model invents could drift run-to-run; a
// key WE derive from stable fields cannot.

import { createHash } from 'node:crypto'
import {
  OSHA_UPDATE_CATEGORIES,
  OSHA_UPDATE_SEVERITIES,
  type OshaUpdateCategory,
  type OshaUpdateSeverity,
} from '@soteria/core/oshaRegWatch'

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

const OSHA_BASE_URL = 'https://www.osha.gov'
const MAX_TEXT_CHARS = 40_000

// Tags whose CONTENT is noise for an LLM reading the page. Dropped wholesale.
const STRIP_BLOCK_RE = /<(script|style|svg|head|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g
const ANCHOR_RE = /<a\b[^>]*?href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi
const TAG_RE = /<[^>]+>/g

const ENTITIES: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, m => ENTITIES[m] ?? m)
}

// Resolve an href to an absolute URL so the model can recover an item's
// canonical source. Leaves anchors/mailto/relative-fragment links untouched.
function absolutize(href: string, baseUrl: string): string {
  const trimmed = href.trim()
  if (trimmed === '') return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('/')) return `${baseUrl}${trimmed}`
  return trimmed
}

/**
 * Reduce raw osha.gov HTML to a compact, link-preserving plain-text payload
 * for the model. Anchors become "text (absolute-url)" so the model can
 * recover each item's canonical source URL — that URL is what computeDedupKey
 * hashes, so preserving it is load-bearing, not cosmetic.
 *
 * Intentionally lossy and regex-based: the consumer is an LLM that tolerates
 * messy text, so a DOM parser (cheerio/puppeteer) would be dependency weight
 * for no accuracy gain. Output is hard-capped so a sprawling page can't blow
 * the prompt budget.
 */
export function htmlToLlmText(html: string, baseUrl: string = OSHA_BASE_URL): string {
  const withLinks = html
    .replace(STRIP_BLOCK_RE, ' ')
    .replace(HTML_COMMENT_RE, ' ')
    .replace(ANCHOR_RE, (_m, href: string, inner: string) => {
      const text = decodeEntities(inner.replace(TAG_RE, ' ')).replace(/\s+/g, ' ').trim()
      if (text === '') return ' '
      const url = absolutize(href, baseUrl)
      return url === '' ? ` ${text} ` : ` ${text} (${url}) `
    })

  const text = decodeEntities(withLinks.replace(TAG_RE, ' '))
    .replace(/\s+/g, ' ')
    .trim()

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
 * Stable idempotency key for the unique constraint. Prefer the source URL
 * (an item's durable identity even if OSHA re-words the headline); fall back
 * to title + published date when no URL was recovered. Always returns a
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
