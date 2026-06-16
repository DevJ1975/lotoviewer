import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { getAnthropic, AnthropicNotConfiguredError } from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'
import { SONNET } from '@/lib/ai/models'
import {
  htmlToLlmText,
  computeDedupKey,
  normalizeOshaUpdate,
  type RawOshaItem,
} from '@/lib/oshaRegWatch'

// OSHA Regulatory Watch cron (~every 30 days; scheduled monthly in vercel.json).
//
// Fetches a couple of osha.gov pages, reduces the HTML to a link-preserving
// text payload, and asks Claude ONCE to extract substantive regulation
// updates + anything upcoming, each with a plain-language workplace-impact
// summary. Extracted items are inserted (idempotent on a cron-derived
// dedup_key) into the GLOBAL public.osha_regulation_updates table, which the
// home-dashboard panel reads. One summary per update, shared across tenants.
//
// osha.gov sits behind an Akamai WAF that 403s many automated clients. The
// job makes a cheap reachability probe FIRST: if osha.gov is unreachable it
// records the run and returns WITHOUT spending Anthropic tokens, leaving the
// last successful run's summaries in place (graceful degrade). If the WAF
// blocks the deployment for good, OSHA_SOURCE_URLS can be repointed at the
// public Federal Register JSON API, which mirrors OSHA's rule publications.
//
// Auth + run-logging follow the same posture as the other crons.

export const runtime = 'nodejs'
// One sequential pass — a couple of fetches (each with one retry) plus a
// single Sonnet call. Well under the cap, but the default 10s is far too
// tight for a slow osha.gov response plus generation.
export const maxDuration = 300

const FETCH_TIMEOUT_MS = 20_000
const AI_MODEL = SONNET

// osha.gov pages the model reads. The regs landing surfaces rules/notices;
// the newsroom surfaces announcements + upcoming activity. A small list so
// adding or removing a source is a one-line change.
const OSHA_SOURCE_URLS = [
  'https://www.osha.gov/laws-regs',
  'https://www.osha.gov/news/newsreleases',
] as const

// A browser-like header set. osha.gov's WAF 403s the bare fetch() UA; this is
// best-effort (the WAF can still fingerprint TLS, which fetch can't spoof) and
// the reachability probe handles the case where it isn't enough.
const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
} as const

const SYSTEM_PROMPT = `You are an OSHA regulatory analyst. You are given the reduced text of one or more osha.gov pages. Links appear inline as "link text (url)".

From that text, extract distinct, substantive U.S. OSHA regulatory items:
- recently published or updated rules, notices, and enforcement directives, and
- anything explicitly UPCOMING: proposed rules (NPRMs), open public-comment periods, and scheduled future effective dates.

For each item, write a 2-3 sentence plain-language summary of how it may affect a typical workplace's safety obligations: what is changing, who is affected, and what an employer should do.

Rules:
- Use ONLY information present in the text. Never invent titles, dates, or URLs. If a field is not present, return an empty string for it.
- Dates must be ISO format YYYY-MM-DD, or an empty string if not stated.
- source_url must be the osha.gov URL shown beside the item, or an empty string if none is shown.
- Set is_upcoming=true only for proposed rules, open comment periods, or changes that are not yet in effect.
- Ignore site navigation, search boxes, headers/footers, unrelated press, and boilerplate.
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

interface FetchResult {
  ok:     boolean
  status: number
  body:   string | null
}

// GET a URL with the browser headers and a hard timeout. Returns the body on
// a 2xx; null otherwise. One retry with a short backoff covers a transient
// hiccup, but a 4xx (esp. a 403 WAF block) won't fix itself, so we bail on it
// immediately rather than retrying into the same wall.
async function fetchText(url: string): Promise<FetchResult> {
  let lastStatus = 0
  for (let attempt = 0; attempt <= 1; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const resp = await fetch(url, { signal: ctrl.signal, headers: BROWSER_HEADERS })
      lastStatus = resp.status
      if (resp.ok) return { ok: true, status: resp.status, body: await resp.text() }
      if (resp.status >= 400 && resp.status < 500) return { ok: false, status: resp.status, body: null }
    } catch {
      lastStatus = 0
    } finally {
      clearTimeout(timer)
    }
    if (attempt < 1) await new Promise(r => setTimeout(r, 1500))
  }
  return { ok: false, status: lastStatus, body: null }
}

async function extractUpdates(sourceText: string): Promise<RawOshaItem[]> {
  // Global job — no tenant context — so getAnthropic(null) uses the platform
  // env key (see getTenantApiKey: a null tenant short-circuits to env).
  const client = await getAnthropic(null)
  const today = new Date().toISOString().slice(0, 10)
  const response = await client.messages.create({
    model:      AI_MODEL,
    max_tokens: 8000,
    system:     SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Today is ${today}. Extract OSHA regulatory updates and upcoming items from the following osha.gov page text:\n\n${sourceText}`,
    }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('AI returned no text block')
  const parsed = JSON.parse(textBlock.text) as { items?: RawOshaItem[] }
  return Array.isArray(parsed.items) ? parsed.items : []
}

async function runCron(): Promise<NextResponse> {
  // Step 0 — reachability probe. osha.gov's WAF frequently 403s automated
  // clients; if the source is unreachable, record the run and bail BEFORE
  // spending Anthropic tokens. The panel keeps the last run's summaries.
  const probe = await fetchText(OSHA_SOURCE_URLS[0])
  if (!probe.ok) {
    Sentry.captureMessage('osha-reg-watch: source unreachable (likely WAF 403)', {
      level: 'warning',
      tags: { source: 'osha-reg-watch', stage: 'probe', http_status: String(probe.status) },
    })
    return NextResponse.json({ reachable: false, source_status: probe.status, scanned: 0, inserted: 0 })
  }

  // Step 1 — gather page text. The probe already fetched the first page;
  // reuse its body and fetch the rest, skipping any that fail individually.
  const pages: string[] = []
  if (probe.body) pages.push(htmlToLlmText(probe.body))
  for (const url of OSHA_SOURCE_URLS.slice(1)) {
    const page = await fetchText(url)
    if (page.ok && page.body) pages.push(htmlToLlmText(page.body))
  }
  if (pages.length === 0) {
    return NextResponse.json({ reachable: true, scanned: 0, inserted: 0, message: 'No source pages yielded text.' })
  }

  // Steps 2-3 — one Claude call extracting structured items from the text.
  let items: RawOshaItem[]
  try {
    items = await extractUpdates(pages.join('\n\n---\n\n'))
  } catch (err) {
    if (err instanceof MalformedTenantKeyError || err instanceof AnthropicNotConfiguredError) {
      Sentry.captureMessage('osha-reg-watch: Anthropic not configured', {
        level: 'warning', tags: { source: 'osha-reg-watch', stage: 'extract' },
      })
    } else {
      Sentry.captureException(err, { tags: { source: 'osha-reg-watch', stage: 'extract' } })
    }
    return NextResponse.json({ reachable: true, scanned: 0, inserted: 0, error: 'AI extraction failed' }, { status: 502 })
  }

  // Step 4 — idempotent insert. dedup_key is derived from stable fields, so
  // re-running over an unchanged page no-ops via the unique constraint
  // (23505 = already have it, treated as a skip not a failure).
  const admin = supabaseAdmin()
  const fetchedAt = new Date().toISOString()
  let inserted = 0
  let skipped  = 0
  let failed   = 0

  for (const raw of items) {
    const update = normalizeOshaUpdate(raw)
    if (!update) { skipped += 1; continue }
    const dedupKey = computeDedupKey(update)
    try {
      const { error } = await admin.from('osha_regulation_updates').insert({
        dedup_key:  dedupKey,
        ...update,
        ai_model:   AI_MODEL,
        fetched_at: fetchedAt,
      })
      if (error) {
        if (error.code === '23505') { skipped += 1; continue }
        Sentry.captureException(error, { tags: { source: 'osha-reg-watch', stage: 'insert' } })
        failed += 1
        continue
      }
      inserted += 1
    } catch (err) {
      Sentry.captureException(err, { tags: { source: 'osha-reg-watch', stage: 'insert' } })
      failed += 1
    }
  }

  // `count` mirrors `inserted` so the cron-runs dashboard's summary extractor
  // (which looks for a `count` field) surfaces a number for this job.
  return NextResponse.json({ reachable: true, scanned: items.length, inserted, skipped, failed, count: inserted })
}
