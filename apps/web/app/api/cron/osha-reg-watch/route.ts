import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { getAnthropic, AnthropicNotConfiguredError } from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'
import { SONNET } from '@/lib/ai/models'
import {
  federalRegisterDocsToLlmText,
  computeDedupKey,
  normalizeOshaUpdate,
  type FederalRegisterDoc,
  type RawOshaItem,
} from '@/lib/oshaRegWatch'

// OSHA Regulatory Watch cron (~every 30 days; scheduled monthly in vercel.json).
//
// Pulls OSHA's recent rulemaking from the Federal Register public JSON API —
// the official publication channel for OSHA rules/notices — then asks Claude
// ONCE to pick the substantive items + anything upcoming and write a
// plain-language workplace-impact summary for each. Results are inserted
// (idempotent on a cron-derived dedup_key) into the GLOBAL
// public.osha_regulation_updates table that the home-dashboard panel reads.
// One summary per update, shared across tenants.
//
// Why the Federal Register API and not osha.gov: osha.gov sits behind an
// Akamai WAF that 403s datacenter clients (confirmed from Vercel-class IPs),
// so it can't be scraped from a serverless function. The Federal Register API
// is built for programmatic access and carries the same OSHA final/proposed
// rules, notices, comment periods, and effective dates as structured fields.
// If the API is unreachable, the job records the run and returns WITHOUT
// spending Anthropic tokens, leaving the last successful run's summaries in
// place (graceful degrade).
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
      content: `Today is ${today}. Extract OSHA regulatory updates and upcoming items from the following Federal Register documents:\n\n${sourceText}`,
    }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') throw new Error('AI returned no text block')
  const parsed = JSON.parse(textBlock.text) as { items?: RawOshaItem[] }
  return Array.isArray(parsed.items) ? parsed.items : []
}

async function runCron(): Promise<NextResponse> {
  // Step 1 — pull OSHA's recent Federal Register documents. If the API is
  // unreachable, record the run and bail BEFORE spending Anthropic tokens;
  // the panel keeps showing the last successful run's summaries.
  const docs = await fetchFederalRegisterDocs()
  if (docs === null) {
    Sentry.captureMessage('osha-reg-watch: Federal Register API unreachable', {
      level: 'warning',
      tags: { source: 'osha-reg-watch', stage: 'fetch' },
    })
    return NextResponse.json({ reachable: false, scanned: 0, inserted: 0 })
  }
  if (docs.length === 0) {
    return NextResponse.json({ reachable: true, scanned: 0, inserted: 0, message: 'No OSHA documents returned.' })
  }

  // Step 2 — one Claude call: pick the substantive items + summarize impact.
  let items: RawOshaItem[]
  try {
    items = await extractUpdates(federalRegisterDocsToLlmText(docs))
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

  // Step 3 — idempotent insert. dedup_key is derived from the document's
  // canonical URL, so re-seeing a document no-ops via the unique constraint
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
