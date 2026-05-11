import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { getTenantApiKey } from '@/lib/ai/getTenantApiKey'

// POST /api/admin/audit-summary
//
// Synthesizes the last 24h of audit_log activity for the caller's
// tenant into a 2-3 sentence narrative + a list of anomalies. Designed
// to replace the manual "scroll through 100 rows looking for unusual
// activity" step on /admin/audit.
//
// Caching: a tenant-scoped in-memory cache keyed by the current hour
// (UTC) returns the same narrative for repeat calls within an hour.
// This keeps Anthropic spend low — most admins refresh the page a
// few times per session — and avoids reauthoring the same summary.
//
// Auth: tenant-admin (audit log can leak who did what; only admins
// + owners + superadmin should see it).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MODEL   = MODEL_BY_SURFACE['summarize-audit']
const SURFACE = 'summarize-audit' as const
const WINDOW_HOURS = 24
const TOP_N = 5

// ── Cache ─────────────────────────────────────────────────────────
// Plain Map; lifetime is the lambda's cold path. A tenant who calls
// this 10 times in a session pays 1 invocation. Eviction: drop entries
// once an hour shifts so memory stays bounded across long-lived
// instances. This is a soft cache — bust by passing ?force=1.

interface CacheEntry { hourKey: string; payload: AuditSummaryResponse }
const CACHE = new Map<string, CacheEntry>()  // tenantId → entry
function hourKey(date = new Date()): string {
  const d = date.toISOString()
  return d.slice(0, 13)  // YYYY-MM-DDTHH
}

const SCHEMA = {
  type: 'object',
  properties: {
    narrative: {
      type: 'string',
      description: '2-3 sentence summary of the last 24h of activity. Plain prose, no bullets.',
    },
    anomalies: {
      type: 'array',
      description: 'Short bullets calling out unusual patterns (deletes, after-hours edits, bulk operations). Empty array if nothing notable.',
      items: { type: 'string' },
    },
  },
  required: ['narrative', 'anomalies'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You are an audit-log analyst for Soteria FIELD, a multi-tenant safety SaaS. You receive aggregated counts of recent CRUD activity across one tenant's tables and produce a brief narrative for an admin who hasn't been watching the system.

Style:
- 2-3 sentences. Conversational but precise. No headings, no bullets in the narrative field.
- Lead with what changed and who drove it ("Maria created 4 LOTO procedures…").
- If activity is light, say so plainly.

Anomalies (separate field, list of short strings):
- Mass deletes (>5 rows in one table from one actor in 24h)
- After-hours bulk operations (UTC 22:00-06:00)
- Permit cancellations (any)
- A new actor doing a lot at once (first audit row from this user, then >10 rows)

If nothing is anomalous, return an empty anomalies array.

Use only the data provided. Do not invent activity.`

interface AuditSummaryResponse {
  windowHours: number
  generatedAt: string
  cached:      boolean
  totals: {
    rows:   number
    actors: number
    tables: number
  }
  narrative: string
  anomalies: string[]
}

interface AuditAggRow {
  table_name: string
  operation:  'INSERT' | 'UPDATE' | 'DELETE'
  actor_id:   string | null
  actor_email:string | null
  count:      number
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const force = url.searchParams.get('force') === '1'

  const key = hourKey()
  const cached = CACHE.get(gate.tenantId)
  if (!force && cached && cached.hourKey === key) {
    return NextResponse.json({ ...cached.payload, cached: true })
  }

  // Per-tenant budget + per-user rate limit. Order: budget → rate
  // limit (consistent with the generate routes).
  const budget = await checkTenantBudget({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!budget.ok) {
    return NextResponse.json(
      { error: budget.message },
      { status: 429, headers: budget.reason === 'budget_exceeded' ? { 'retry-after': String(budget.retryAfterSec) } : {} },
    )
  }
  const limit = await checkAiRateLimit({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `Rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  // Aggregate the last 24h. We hit the audit_log via service role
  // (RLS would scope it but we already gated requireTenantAdmin and
  // need the tenant_id filter to be reliable). audit_log has a
  // tenant_id column in this schema (mig 027 era + tenant gates on
  // every domain table feeding it).
  const since = new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString()
  const admin = supabaseAdmin()
  const { data: rawRows, error: aErr } = await admin
    .from('audit_log')
    .select('table_name, operation, actor_id, actor_email, created_at')
    .eq('tenant_id', gate.tenantId)
    .gte('created_at', since)
    .limit(5000)
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
  const rows = (rawRows ?? []) as Array<{
    table_name: string
    operation:  AuditAggRow['operation']
    actor_id:   string | null
    actor_email: string | null
    created_at: string
  }>

  // Bucket counts so the prompt sees pre-aggregated rows (cheaper
  // than handing the model 5000 raw rows + safer privacy-wise).
  const byKey = new Map<string, AuditAggRow>()
  const actorSet = new Set<string>()
  const tableSet = new Set<string>()
  let afterHoursOps = 0
  for (const r of rows) {
    const k = `${r.table_name}|${r.operation}|${r.actor_id ?? ''}|${r.actor_email ?? ''}`
    const existing = byKey.get(k) ?? {
      table_name:  r.table_name,
      operation:   r.operation,
      actor_id:    r.actor_id,
      actor_email: r.actor_email,
      count:       0,
    }
    existing.count += 1
    byKey.set(k, existing)
    if (r.actor_id)    actorSet.add(r.actor_id)
    if (r.actor_email) actorSet.add(r.actor_email)
    tableSet.add(r.table_name)
    const hour = new Date(r.created_at).getUTCHours()
    if (hour >= 22 || hour < 6) afterHoursOps += 1
  }

  // Top contributors (by row count) + a bounded sample so the
  // prompt fits well under cache thresholds even on busy tenants.
  const topActorsArr = Array.from(byKey.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_N * 2)

  // Quiet path — no rows means no AI call. Synth the empty-state
  // narrative locally so we don't pay for a near-empty prompt.
  if (rows.length === 0) {
    const payload: AuditSummaryResponse = {
      windowHours: WINDOW_HOURS,
      generatedAt: new Date().toISOString(),
      cached:      false,
      totals:      { rows: 0, actors: 0, tables: 0 },
      narrative:   'No audit activity in the last 24 hours.',
      anomalies:   [],
    }
    CACHE.set(gate.tenantId, { hourKey: key, payload })
    return NextResponse.json(payload)
  }

  const brief = [
    `Window: last ${WINDOW_HOURS} hours.`,
    `Total rows: ${rows.length}, distinct actors: ${actorSet.size}, distinct tables: ${tableSet.size}.`,
    `After-hours operations (22:00-06:00 UTC): ${afterHoursOps}.`,
    '',
    'Top contributors (table | op | actor | count):',
    ...topActorsArr.map(a =>
      `- ${a.table_name} | ${a.operation} | ${a.actor_email ?? a.actor_id ?? '(system)'} | ${a.count}`),
  ].join('\n')

  const client = new Anthropic({ apiKey: await getTenantApiKey(gate.tenantId) })

  let narrative = ''
  let anomalies: string[] = []
  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: brief }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    })
    const textBlock = response.content.find(b => b.type === 'text')
    if (textBlock && textBlock.type === 'text') {
      const parsed = JSON.parse(textBlock.text) as { narrative: string; anomalies: string[] }
      narrative = parsed.narrative
      anomalies = Array.isArray(parsed.anomalies) ? parsed.anomalies : []
    }
    await logAiInvocation({
      userId:           gate.userId,
      tenantId:         gate.tenantId,
      surface:          SURFACE,
      model:            MODEL,
      status:           'success',
      inputTokens:      response.usage?.input_tokens,
      outputTokens:     response.usage?.output_tokens,
      cacheReadTokens:  response.usage?.cache_read_input_tokens     ?? undefined,
      cacheWriteTokens: response.usage?.cache_creation_input_tokens ?? undefined,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/admin/audit-summary' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error' })
    // Non-fatal — return the raw counts so the page renders something.
    narrative = `${rows.length} audit rows in the last ${WINDOW_HOURS}h across ${tableSet.size} table${tableSet.size === 1 ? '' : 's'}, ${actorSet.size} actor${actorSet.size === 1 ? '' : 's'}. AI synthesis failed; review the table below.`
    anomalies = []
  }

  const payload: AuditSummaryResponse = {
    windowHours: WINDOW_HOURS,
    generatedAt: new Date().toISOString(),
    cached:      false,
    totals:      { rows: rows.length, actors: actorSet.size, tables: tableSet.size },
    narrative,
    anomalies,
  }
  CACHE.set(gate.tenantId, { hourKey: key, payload })
  return NextResponse.json(payload)
}

export type { AuditSummaryResponse }
