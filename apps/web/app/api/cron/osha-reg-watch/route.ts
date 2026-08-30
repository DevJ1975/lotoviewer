import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { getAnthropic, AnthropicNotConfiguredError } from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'
import { SONNET } from '@/lib/ai/models'
import {
  federalRegisterDocsToLlmText,
  calOshaPagesToLlmText,
  htmlToPlainText,
  computeDedupKey,
  normalizeOshaUpdate,
  type FederalRegisterDoc,
  type CalOshaPage,
  type RawOshaItem,
  type NormalizedOshaUpdate,
} from '@/lib/oshaRegWatch'
import type { RegulationJurisdiction } from '@soteria/core/oshaRegWatch'

// Regulatory Watch cron (~every 30 days; scheduled monthly in vercel.json).
//
// Two independent source passes, each ending in one Claude call that picks the
// substantive items + anything upcoming and writes a plain-language
// workplace-impact summary. Results are inserted (idempotent on a cron-derived
// dedup_key) into the GLOBAL public.osha_regulation_updates table that the
// home-dashboard panels read, tagged with the jurisdiction they came from.
//
//   FEDERAL — the Federal Register public JSON API. Not osha.gov: that sits
//     behind an Akamai WAF which 403s datacenter clients (confirmed from
//     Vercel-class IPs). The FR API is built for programmatic access and
//     carries the same final/proposed rules, notices, comment periods, and
//     effective dates as structured fields.
//
//   CAL/OSHA — dir.ca.gov. California rulemaking never appears in the Federal
//     Register, so there is no structured feed to use; the Standards Board
//     publishes hand-tagged HTML. We fetch a small fixed set of index pages,
//     strip them to text, and let the model read prose. This is weaker than
//     the federal path and is treated as such — see CAL_OSHA_SYSTEM_PROMPT,
//     which forbids inferring a date the page does not state.
//
// The two passes are independent on purpose: either source can be down, or
// blocked by an egress policy, without taking the other with it. A pass whose
// fetch fails records the failure and spends no Anthropic tokens, leaving the
// last successful run's summaries in place (graceful degrade). The job only
// reports a non-2xx when BOTH passes fail.
//
// Auth + run-logging follow the same posture as the other crons.

export const runtime = 'nodejs'
// One sequential pass — a single API fetch plus a single Sonnet call. Well
// under the cap, but the default 10s is too tight for the fetch + generation.
export const maxDuration = 300

const FETCH_TIMEOUT_MS = 20_000
const AI_MODEL = SONNET

// Federal Register documents.json filtered to OSHA, newest first. We request
// only the fields we serialize for the model to keep the payload small. The
// 25-doc window comfortably covers a monthly cadence; the unique dedup_key
// makes re-seeing a document on the next run a no-op.
const FR_API_URL =
  'https://www.federalregister.gov/api/v1/documents.json' +
  '?conditions%5Bagencies%5D%5B%5D=occupational-safety-and-health-administration' +
  '&order=newest&per_page=25' +
  '&fields%5B%5D=document_number&fields%5B%5D=title&fields%5B%5D=type' +
  '&fields%5B%5D=publication_date&fields%5B%5D=effective_on' +
  '&fields%5B%5D=comments_close_on&fields%5B%5D=abstract&fields%5B%5D=html_url'

// Cal/OSHA rulemaking index pages. Deliberately few and stable: the Standards
// Board's proposed-regulations list is where a rule appears once it is noticed
// for adoption, and the DIR news index catches emergency actions and adopted
// standards that never sit on the proposals page long. DIR publishes no API
// and gives no rate-limit contract, so keep this list short.
const CAL_OSHA_SOURCES: ReadonlyArray<{ url: string; label: string }> = [
  { url: 'https://www.dir.ca.gov/oshsb/proposedregulations.html', label: 'Cal/OSHA Standards Board — proposed regulations' },
  { url: 'https://www.dir.ca.gov/oshsb/apprvd.html',              label: 'Cal/OSHA Standards Board — recently approved standards' },
  { url: 'https://www.dir.ca.gov/dosh/rulemaking/dosh_rulemaking_proposed.html', label: 'Cal/OSHA — proposed rulemaking / advisory' },
]

const SYSTEM_PROMPT = `You are an OSHA regulatory analyst. You are given recent U.S. Federal Register documents published by OSHA, one per block. Each block has labeled fields: Title, Type (e.g. "Rule", "Proposed Rule", "Notice"), Published, Effective, Comments close, URL, and Abstract.

From these documents, extract the distinct, substantive OSHA regulatory items:
- recently published or updated rules, notices, and enforcement directives, and
- anything explicitly UPCOMING: proposed rules (NPRMs), open public-comment periods, and scheduled future effective dates.

For each item, write a 2-3 sentence plain-language summary of how it may affect a typical workplace's safety obligations: what is changing, who is affected, and what an employer should do.

Rules:
- Use ONLY information present in the documents. Never invent titles, dates, or URLs. If a field is not present, return an empty string for it.
- Copy dates verbatim from the labeled fields, in ISO format YYYY-MM-DD; return an empty string when a date is not given.
- source_url must be the document's URL line; map category from Type ("Rule" -> final_rule, "Proposed Rule" -> proposed_rule, "Notice" -> guidance, otherwise other).
- Set is_upcoming=true only for proposed rules, open comment periods, or changes whose effective date is in the future.
- Skip purely administrative or procedural notices with no workplace impact (meetings, information collections, minor corrections).
- Prefer a few high-confidence items over many speculative ones. If nothing substantive is present, return an empty list.`

// The Cal/OSHA pass reads scraped prose, not typed fields, so this prompt is
// tighter than the federal one in exactly the places the source is weaker:
// dates must be quoted from the page rather than inferred, and the URL must
// come from the block's own Source/URL header (the dedup key hashes it).
const CAL_OSHA_SYSTEM_PROMPT = `You are a Cal/OSHA regulatory analyst. You are given the text of California Division of Occupational Safety and Health (Cal/OSHA) and Occupational Safety and Health Standards Board web pages, one per block. Each block starts with a "Source:" line and a "URL:" line, followed by the page's text.

From these pages, extract the distinct, substantive California Title 8 regulatory items — especially anything UPCOMING: proposed regulations, open public-comment periods, scheduled public hearings, adopted standards not yet effective, and emergency rulemaking.

For each item, write a 2-3 sentence plain-language summary of how it may affect a California employer's safety obligations: what is changing, who is affected, and what an employer should do.

Rules:
- Use ONLY information stated on the page. Never invent a title, a date, a section number, or a URL.
- Dates: copy them ONLY if the page states them, converting to ISO YYYY-MM-DD. If the page does not state a date, return an empty string for that field. Do NOT infer, estimate, or calculate a date, and do NOT carry a date from one item to another.
- source_url must be the URL line from the block the item came from.
- Map category: an adopted or approved standard -> final_rule; a proposed regulation, discussion draft, or advisory -> proposed_rule; enforcement guidance or an advisory bulletin -> guidance; otherwise other.
- Set is_upcoming=true for anything not yet in effect: proposed regulations, open comment periods, scheduled hearings, and adopted standards with a future effective date.
- Include the Title 8 section number in the title when the page gives one (e.g. "§3396").
- Skip board meeting logistics, petitions with no proposed text, staff appointments, and navigation boilerplate.
- Prefer a few high-confidence items over many speculative ones. If nothing substantive is present, return an empty list.`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title:              { type: 'string' },
          category:           { type: 'string', enum: ['final_rule', 'proposed_rule', 'enforcement', 'guidance', 'upcoming', 'other'] },
          is_upcoming:        { type: 'boolean' },
          source_url:         { type: 'string' },
          published_date:     { type: 'string' },
          effective_date:     { type: 'string' },
          comment_close_date: { type: 'string' },
          impact_summary:     { type: 'string' },
          severity:           { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['title', 'category', 'is_upcoming', 'source_url', 'impact_summary', 'severity'],
      },
    },
  },
  required: ['items'],
} as const

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

export async function GET(req: Request)  {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

// Fetch the newest OSHA Federal Register documents. Returns the document array
// on success, or null on any non-2xx / network error / timeout so the caller
// can degrade gracefully without spending Anthropic tokens.
async function fetchFederalRegisterDocs(): Promise<FederalRegisterDoc[] | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const resp = await fetch(FR_API_URL, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'SoteriaField-OSHARegWatch/1.0 (+https://soteriafield.app)',
      },
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as { results?: FederalRegisterDoc[] }
    return Array.isArray(json.results) ? json.results : []
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch the Cal/OSHA rulemaking index pages and reduce each to text.
 *
 * Returns only the pages that came back — a single dead URL must not sink the
 * pass, since DIR reorganizes its site without notice. Returns null only when
 * NONE of them were reachable, which is the signal to skip the pass entirely
 * rather than send the model an empty prompt.
 */
async function fetchCalOshaPages(): Promise<CalOshaPage[] | null> {
  const results = await Promise.all(CAL_OSHA_SOURCES.map(async (src): Promise<CalOshaPage | null> => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const resp = await fetch(src.url, {
        signal: ctrl.signal,
        headers: {
          accept: 'text/html',
          'user-agent': 'SoteriaField-RegWatch/1.0 (+https://soteriafield.app)',
        },
      })
      if (!resp.ok) return null
      const text = htmlToPlainText(await resp.text())
      return text === '' ? null : { url: src.url, label: src.label, text }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }))

  const pages = results.filter((p): p is CalOshaPage => p !== null)
  return pages.length === 0 ? null : pages
}

async function extractUpdates(
  systemPrompt: string,
  instruction: string,
  sourceText: string,
): Promise<RawOshaItem[]> {
  // Global job — no tenant context — so getAnthropic(null) uses the platform
  // env key (see getTenantApiKey: a null tenant short-circuits to env).
  const client = await getAnthropic(null)
  const today = new Date().toISOString().slice(0, 10)
  const response = await client.messages.create({
    model:      AI_MODEL,
    max_tokens: 8000,
    thinking:   { type: 'disabled' },
    system:     systemPrompt,
    messages: [{
      role: 'user',
      content: `Today is ${today}. ${instruction}\n\n${sourceText}`,
    }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('AI returned no text block')
  const parsed = JSON.parse(textBlock.text) as { items?: RawOshaItem[] }
  return Array.isArray(parsed.items) ? parsed.items : []
}

interface PassResult {
  reachable: boolean
  scanned:   number
  inserted:  number
  skipped:   number
  failed:    number
  error?:    string
}

const SKIPPED_PASS: PassResult = { reachable: false, scanned: 0, inserted: 0, skipped: 0, failed: 0 }

/**
 * Insert one pass's normalized items in a single statement. Idempotent:
 * dedup_key is derived from the source URL and uniquely constrained, so
 * re-seeing a document is a no-op.
 *
 * The upsert is ON CONFLICT DO NOTHING ... RETURNING, which is what lets the
 * batch keep the old per-row accounting: the response carries only the rows
 * that were genuinely new, and every row missing from it is a re-sighting
 * (skipped, not failed). DO NOTHING also absorbs two feed items that hash to
 * the same key inside one batch, which a plain insert would reject outright.
 */
async function insertUpdates(
  items: readonly RawOshaItem[],
  jurisdiction: RegulationJurisdiction,
): Promise<{ inserted: number; skipped: number; failed: number }> {
  const admin = supabaseAdmin()
  const fetchedAt = new Date().toISOString()

  const normalized = items
    .map(raw => normalizeOshaUpdate(raw, jurisdiction))
    .filter((update): update is NormalizedOshaUpdate => update !== null)
  const unusable = items.length - normalized.length
  if (normalized.length === 0) return { inserted: 0, skipped: unusable, failed: 0 }

  const rows = normalized.map(update => ({
    dedup_key:  computeDedupKey(update),
    ...update,
    ai_model:   AI_MODEL,
    fetched_at: fetchedAt,
  }))

  try {
    const { data, error } = await admin
      .from('osha_regulation_updates')
      .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('dedup_key')
    if (error) {
      Sentry.captureException(error, { tags: { source: 'osha-reg-watch', stage: 'insert', jurisdiction } })
      return { inserted: 0, skipped: unusable, failed: rows.length }
    }
    const inserted = data?.length ?? 0
    return { inserted, skipped: unusable + (rows.length - inserted), failed: 0 }
  } catch (err) {
    Sentry.captureException(err, { tags: { source: 'osha-reg-watch', stage: 'insert', jurisdiction } })
    return { inserted: 0, skipped: unusable, failed: rows.length }
  }
}

/** Shared tail of both passes: extract with the model, then insert. */
async function runPass(opts: {
  jurisdiction: RegulationJurisdiction
  systemPrompt: string
  instruction:  string
  sourceText:   string
}): Promise<PassResult> {
  const { jurisdiction } = opts
  let items: RawOshaItem[]
  try {
    items = await extractUpdates(opts.systemPrompt, opts.instruction, opts.sourceText)
  } catch (err) {
    if (err instanceof MalformedTenantKeyError || err instanceof AnthropicNotConfiguredError) {
      Sentry.captureMessage('osha-reg-watch: Anthropic not configured', {
        level: 'warning', tags: { source: 'osha-reg-watch', stage: 'extract', jurisdiction },
      })
    } else {
      Sentry.captureException(err, { tags: { source: 'osha-reg-watch', stage: 'extract', jurisdiction } })
    }
    return { ...SKIPPED_PASS, reachable: true, error: 'AI extraction failed' }
  }

  const counts = await insertUpdates(items, jurisdiction)
  return { reachable: true, scanned: items.length, ...counts }
}

async function runFederalPass(): Promise<PassResult> {
  // Pull OSHA's recent Federal Register documents. If the API is unreachable,
  // bail BEFORE spending Anthropic tokens; the panels keep showing the last
  // successful run's summaries.
  const docs = await fetchFederalRegisterDocs()
  if (docs === null) {
    Sentry.captureMessage('osha-reg-watch: Federal Register API unreachable', {
      level: 'warning',
      tags: { source: 'osha-reg-watch', stage: 'fetch', jurisdiction: 'federal' },
    })
    return SKIPPED_PASS
  }
  if (docs.length === 0) return { ...SKIPPED_PASS, reachable: true }

  return runPass({
    jurisdiction: 'federal',
    systemPrompt: SYSTEM_PROMPT,
    instruction:  'Extract OSHA regulatory updates and upcoming items from the following Federal Register documents:',
    sourceText:   federalRegisterDocsToLlmText(docs),
  })
}

async function runCalOshaPass(): Promise<PassResult> {
  const pages = await fetchCalOshaPages()
  if (pages === null) {
    Sentry.captureMessage('osha-reg-watch: no Cal/OSHA source pages reachable', {
      level: 'warning',
      tags: { source: 'osha-reg-watch', stage: 'fetch', jurisdiction: 'CA' },
    })
    return SKIPPED_PASS
  }

  const sourceText = calOshaPagesToLlmText(pages)
  if (sourceText === '') return { ...SKIPPED_PASS, reachable: true }

  return runPass({
    jurisdiction: 'CA',
    systemPrompt: CAL_OSHA_SYSTEM_PROMPT,
    instruction:  'Extract Cal/OSHA Title 8 regulatory updates and upcoming items from the following pages:',
    sourceText,
  })
}

async function runCron(): Promise<NextResponse> {
  // Run both passes regardless of how the other fared — Cal/OSHA coverage
  // must not depend on the Federal Register being up, or vice-versa.
  const [federal, california] = await Promise.all([runFederalPass(), runCalOshaPass()])

  const inserted = federal.inserted + california.inserted
  const body = {
    reachable: federal.reachable || california.reachable,
    scanned:   federal.scanned + california.scanned,
    inserted,
    skipped:   federal.skipped + california.skipped,
    failed:    federal.failed + california.failed,
    // `count` mirrors `inserted` so the cron-runs dashboard's summary
    // extractor (which looks for a `count` field) surfaces a number.
    count:     inserted,
    federal,
    california,
  }

  // Only a total outage is an error. One source down is a degraded run that
  // still delivered the other's updates, and paging on it would train the
  // operator to ignore this job.
  const bothFailed = !federal.reachable && !california.reachable
  const bothErrored = federal.error != null && california.error != null
  return NextResponse.json(body, { status: bothFailed || bothErrored ? 502 : 200 })
}
