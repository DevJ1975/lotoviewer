import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { getAnthropic, AnthropicNotConfiguredError } from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'
import { SONNET } from '@/lib/ai/models'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { sortTopicsForRotation, pickTopicsForDates } from '@/lib/toolboxRotation'
import {
  TOOLBOX_TALK_DAYS_AHEAD,
  normalizeToolboxTalkIndustry,
  toolboxTalkIndustryPrompt,
  type ToolboxTalkIndustry,
} from '@/lib/toolboxTalkPacks'

// Weekly toolbox-talk generation cron.
//
// For every tenant with the `toolbox-talks` module enabled, this job
// makes sure the next 14 calendar days (today + the following 13) each
// have one generated talk. For any missing day it:
//   1. Picks an unused topic from the tenant's industry pool
//      (toolbox_topics rows). "Unused" = least-recently-delivered
//      to that tenant — once the pool exhausts it cycles back to the
//      oldest, so a tenant with 5 workers and 100 topics rotates
//      through ~14 weeks before any topic repeats.
//   2. Calls Claude Sonnet to expand the topic's summary into a
//      site-appropriate 5–8 minute body, 4–6 key points, and a
//      delivery cue card for whoever's running the meeting.
//   3. Inserts toolbox_talks row keyed on (tenant_id, talk_date).
//      The unique constraint makes the insert idempotent — re-runs
//      of the cron do nothing for days that already have a talk.
//
// Generation is intentionally NOT exposed to clients. Workers and
// admins can read + sign in, but only this server-side cron creates
// talks. That's the abuse-prevention posture the operator asked for:
// no per-tenant "generate now" button, no admin API, just the
// scheduled job calling Anthropic with the platform's (or the
// tenant's overridden) key.
//
// Auth: Bearer CRON_SECRET (Vercel scheduled invocation) OR
//       x-internal-secret INTERNAL_PUSH_SECRET (manual curl).
//       Same posture as the other crons under /api/cron/.
//
// Vercel schedule: 0 5 * * 0  — Sundays 00:00 EST / 01:00 EDT,
// before the Monday morning shift.

export const runtime = 'nodejs'
// Anthropic generation × N tenants × up to 14 days each can take a
// while. Bumping max duration above the default 10s keeps a tenant
// from getting half a week if their generation is slow.
export const maxDuration = 300

const MODULE_ID         = 'toolbox-talks'
const DAYS_AHEAD        = TOOLBOX_TALK_DAYS_AHEAD
const AI_MODEL          = SONNET
// Caps on AI output so a misbehaving model can't blow up a row. The
// system prompt asks for 350-700 words (~5KB at typical density);
// 20KB is generous headroom and still leaves the talk renderable
// without scrolling forever.
const BODY_MAX_CHARS    = 20_000
const KEY_POINT_MAX_LEN = 200
const KEY_POINTS_MAX    = 8
// TODO(toolbox-talks-i18n): the cron currently produces English only.
// Migration 111 added title_es/body_markdown_es/key_points_es/
// delivery_notes_es columns and the detail page renders both. The
// next iteration of this prompt should ask Claude for parallel EN +
// ES output (both at 6th-grade) and the SCHEMA below should require
// the *_es fields. Until then, cron-generated rows have NULL ES
// fields and the page falls back to EN when Spanish is selected.
const SYSTEM_PROMPT = `You are a senior workplace safety trainer authoring a daily "toolbox talk" — a 5-to-7 minute pre-shift safety briefing a foreman delivers to a crew at the start of the day. The talk should READ as a script the foreman delivers, not a checklist they read off.

Style and substance:
- Open with a real-feeling scenario (3-6 sentences). A worker, a setting, a small mistake or near-miss, and what it cost. Make the worker someone the crew can picture — first name, trade, age, location. The story is the hook; the rest of the talk leans on it.
- Bake in interactivity. Pause at least four times to ask the crew a specific question or to do a brief activity ("point to the closest extinguisher", "show your buddy your boot tread", "raise a hand if this happened to you in the last month"). Mark these as **bold prompts** and tell the supervisor to wait for answers.
- Use plain language. Reading level: 6th grade. Short sentences. Common words. If a technical term is unavoidable (lockout, harness, fume hood) name it, then explain it in one short line.
- Address the worker directly: "you," "your crew," "your gloves." Not "one should."
- Close with a "Today's promise" line the crew can repeat aloud, then ONE final question for the supervisor to ask the crew.

Don't:
- Don't cite regulation numbers (no "29 CFR 1910.x", no "ANSI Z87", no "NFPA 70E"). Workers don't read these and the citations make the talk feel like compliance theater. Use plain phrases — "the safety sheet," "the procedure," "the law."
- No emojis. No corporate-speak. No padding.
- Don't open with "Today we're going to talk about..." — open with the scenario.

Output a JSON object with these fields:
- title: 4-10 word title for the talk (sharper than the topic title, oriented to today's delivery)
- body_markdown: the full talk body. 700-1000 words. Markdown allowed (### headings, bullet lists, **bold** for crew prompts). Sections in this order: scenario hook → "Pause and ask the crew" prompt → why this matters (in plain language) → what we're doing today (3-5 short bullets) → "Look around right now" prompt → a what-if scenario → what we don't do → today's promise → one last question for the crew.
- key_points: array of 4-6 short (under 12 words each) takeaways the supervisor can write on the whiteboard.
- delivery_notes: 1-3 sentence cue card — what to emphasize, where to slow down, when to wait for crew answers instead of moving on.`

const SCHEMA = {
  type: 'object',
  properties: {
    title:          { type: 'string' },
    body_markdown:  { type: 'string' },
    key_points:     { type: 'array', items: { type: 'string' } },
    delivery_notes: { type: 'string' },
  },
  required: ['title', 'body_markdown', 'key_points', 'delivery_notes'],
  additionalProperties: false,
} as const

interface GeneratedFields {
  title:          string
  body_markdown:  string
  key_points:     string[]
  delivery_notes: string
}

interface TopicRow {
  id:        string
  title:     string
  summary:   string
  reference: string | null
}

interface TenantRow {
  id:       string
  name:     string
  modules:  Record<string, boolean> | null
  settings: Record<string, unknown> | null
}

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

async function runCron(): Promise<NextResponse> {
  const admin = supabaseAdmin()

  try {
    // 1. Pull every active tenant. The disabled_at filter matches
    //    the posture of incident-trends-weekly/training-expiry —
    //    soft-deleted tenants don't get talks generated, which
    //    would otherwise burn Anthropic budget on accounts the
    //    operator has already turned off. Module visibility is then
    //    decided per row (tenants.modules JSON) — the helper agrees
    //    with how the drawer hides the link, so a tenant who turned
    //    the module off won't get talks generated.
    const { data: tenants, error: tErr } = await admin
      .from('tenants')
      .select('id, name, modules, settings')
      .is('disabled_at', null)
    if (tErr) {
      Sentry.captureException(tErr, { tags: { route: '/api/cron/generate-toolbox-talks', stage: 'fetch-tenants' } })
      return NextResponse.json({ error: tErr.message }, { status: 500 })
    }
    const enabled = (tenants ?? []).filter((t): t is TenantRow =>
      isModuleVisible(MODULE_ID, (t.modules ?? null) as Record<string, boolean> | null))

    if (enabled.length === 0) {
      return NextResponse.json({ tenants_scanned: 0, talks_generated: 0, message: 'No tenants have the toolbox-talks module enabled.' })
    }

    // 2. Build the date list once — today + 13.
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const dates: string[] = []
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const d = new Date(today.getTime() + i * 86_400_000)
      dates.push(d.toISOString().slice(0, 10))
    }

    let totalGenerated = 0
    let totalFailed    = 0
    const perTenantSummary: Array<{ tenant_id: string; generated: number; skipped: number; failed: number }> = []

    for (const tenant of enabled) {
      const result = await generateForTenant(tenant, dates)
      totalGenerated += result.generated
      totalFailed    += result.failed
      perTenantSummary.push({ tenant_id: tenant.id, ...result })
    }

    return NextResponse.json({
      tenants_scanned: enabled.length,
      talks_generated: totalGenerated,
      talks_failed:    totalFailed,
      per_tenant:      perTenantSummary,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/generate-toolbox-talks' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}

async function generateForTenant(
  tenant: TenantRow,
  dates: string[],
): Promise<{ generated: number; skipped: number; failed: number }> {
  const admin = supabaseAdmin()

  // Industry preference per tenant. Superadmin writes this via the
  // tenant setup/edit form; unknown legacy values fall back to the
  // general-industry pack rather than burning cron time on an empty
  // topic pool.
  const industry = normalizeToolboxTalkIndustry(tenant.settings?.toolbox_industry)

  // Find which of the 14 dates already have a talk so we skip them.
  const { data: existing } = await admin
    .from('toolbox_talks')
    .select('talk_date')
    .eq('tenant_id', tenant.id)
    .in('talk_date', dates)

  const existingDates = new Set((existing ?? []).map(r => r.talk_date as string))
  const missingDates  = dates.filter(d => !existingDates.has(d))
  if (missingDates.length === 0) {
    return { generated: 0, skipped: dates.length, failed: 0 }
  }

  // Topic pool for this tenant's industry. If a pack is incomplete in
  // a target environment, fall back to 'general' rather than skipping
  // the whole tenant — being wrong about WHICH topic to deliver is
  // better than delivering NO topic.
  const fetchTopics = (i: ToolboxTalkIndustry) => admin
    .from('toolbox_topics')
    .select('id, title, summary, reference')
    .eq('industry', i)
    .eq('active', true)

  let topics: TopicRow[] | null = null
  let topicsErr: { message: string } | null = null
  {
    const r = await fetchTopics(industry)
    topicsErr = r.error
    topics    = (r.data as TopicRow[] | null)
  }
  if ((!topics || topics.length === 0) && industry !== 'general') {
    Sentry.captureMessage(`Toolbox industry '${industry}' has no active topics — falling back to 'general'`,
      { level: 'warning', tags: { tenant_id: tenant.id } })
    const r = await fetchTopics('general')
    topicsErr = r.error
    topics    = (r.data as TopicRow[] | null)
  }
  if (topicsErr || !topics || topics.length === 0) {
    Sentry.captureException(new Error(topicsErr?.message ?? 'No active topics available'),
      { tags: { route: '/api/cron/generate-toolbox-talks', stage: 'topics', tenant_id: tenant.id } })
    return { generated: 0, skipped: existingDates.size, failed: missingDates.length }
  }

  // Determine recency per topic — the talk_date of the most recent
  // talk that referenced it, for THIS tenant. Topics never used get
  // null recency and sort first; oldest used next; most-recent last.
  const { data: recent } = await admin
    .from('toolbox_talks')
    .select('topic_id, talk_date')
    .eq('tenant_id', tenant.id)
    .order('talk_date', { ascending: false })
    .limit(500)

  const lastUsed = new Map<string, string>()
  for (const row of recent ?? []) {
    const id = row.topic_id as string
    if (!lastUsed.has(id)) lastUsed.set(id, row.talk_date as string)
  }

  const sorted = sortTopicsForRotation(topics, lastUsed)
  const picks  = pickTopicsForDates(sorted, missingDates)

  // Per-tenant Anthropic client. Skip the tenant on configuration
  // errors — toolbox-talks isn't worth failing the whole cron over,
  // and the next run will retry. We log so the operator notices.
  let client: Anthropic
  try {
    client = await getAnthropic(tenant.id)
  } catch (err) {
    if (err instanceof MalformedTenantKeyError) {
      Sentry.captureMessage('Skipping tenant in toolbox-talks: malformed Anthropic key',
        { level: 'warning', tags: { tenant_id: tenant.id } })
    } else if (err instanceof AnthropicNotConfiguredError) {
      Sentry.captureMessage('Skipping tenant in toolbox-talks: no Anthropic key configured',
        { level: 'warning', tags: { tenant_id: tenant.id } })
    } else {
      Sentry.captureException(err, { tags: { source: 'toolbox-talks', tenant_id: tenant.id } })
    }
    return { generated: 0, skipped: existingDates.size, failed: missingDates.length }
  }

  let generated = 0
  let failed    = 0

  // Walk the (date, topic) picks. If generation throws, log + move
  // on — the cron will retry that date on its next run.
  for (const { date, topic } of picks) {
    try {
      const fields = await generateTalkBody(client, topic, tenant.name, industry)

      // Defense-in-depth: the JSON-schema output_config should
      // guarantee these shapes, but a future SDK regression or a
      // partial response shouldn't crash the cron. Coerce defensively
      // so a malformed AI return degrades to a sparse-but-valid row
      // rather than throwing.
      const safeTitle    = typeof fields.title === 'string' ? fields.title.trim().slice(0, 200) : ''
      const safeBody     = typeof fields.body_markdown === 'string' ? fields.body_markdown.slice(0, BODY_MAX_CHARS) : ''
      const safePoints   = Array.isArray(fields.key_points)
        ? fields.key_points
            .filter((p): p is string => typeof p === 'string')
            .map(p => p.slice(0, KEY_POINT_MAX_LEN))
            .slice(0, KEY_POINTS_MAX)
        : []
      const safeNotes    = typeof fields.delivery_notes === 'string' ? fields.delivery_notes.trim().slice(0, 1000) : ''

      const { error: insertErr } = await admin
        .from('toolbox_talks')
        .insert({
          tenant_id:      tenant.id,
          topic_id:       topic.id,
          talk_date:      date,
          title:          safeTitle || topic.title,
          body_markdown:  safeBody,
          key_points:     safePoints,
          delivery_notes: safeNotes,
          generated_by:   'cron',
          ai_model:       AI_MODEL,
        })

      if (insertErr) {
        // The unique (tenant_id, talk_date) constraint is the most
        // likely error path here — concurrent runs are protected by
        // the constraint, not by an explicit lock. 23505 = unique
        // violation; treat that as a skip, not a failure.
        if (insertErr.code === '23505') continue
        Sentry.captureException(insertErr,
          { tags: { route: '/api/cron/generate-toolbox-talks', stage: 'insert', tenant_id: tenant.id, talk_date: date } })
        failed++
        continue
      }
      generated++
    } catch (err) {
      Sentry.captureException(err,
        { tags: { route: '/api/cron/generate-toolbox-talks', stage: 'generate', tenant_id: tenant.id, talk_date: date } })
      failed++
    }
  }

  return { generated, skipped: existingDates.size, failed }
}

async function generateTalkBody(
  client: Anthropic,
  topic: TopicRow,
  tenantName: string,
  industry: ToolboxTalkIndustry,
): Promise<GeneratedFields> {
  const userPrompt = [
    `Write today's toolbox talk for the crew at ${tenantName}.`,
    '',
    `Topic: ${topic.title}`,
    `Summary the talk should ground against: ${topic.summary}`,
    topic.reference ? `Cite this regulation if relevant: ${topic.reference}` : null,
  ].filter(Boolean).join('\n')

  const response = await client.messages.create({
    model:      AI_MODEL,
    max_tokens: 4000,
    system:     `${SYSTEM_PROMPT}\n\n${toolboxTalkIndustryPrompt(industry)}`,
    messages:   [{ role: 'user', content: userPrompt }],
    output_config: {
      format: { type: 'json_schema', schema: SCHEMA },
    },
  })

  const textBlock = response.content.find(b => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('AI returned no text block')
  }
  return JSON.parse(textBlock.text) as GeneratedFields
}
