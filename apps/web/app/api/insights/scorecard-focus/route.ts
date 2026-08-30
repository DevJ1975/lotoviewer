import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { getAnthropic } from '@/lib/ai/client'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { computeIncidentRisk } from '@/lib/incidentRiskFeatures'
import { forecastCount, assessTrend } from '@soteria/core/forecast'
import type { IncidentRiskResult } from '@soteria/core/incidentRiskModel'

// An AI route's worst case is `timeout x (retries + 1)`, and it must fit
// inside maxDuration or the platform kills the function mid-flight and the
// caller gets a raw 504 rather than any error this code produces. This route
// asks for up to 900 tokens,
// and previously declared no ceiling at all — so it inherited the platform
// default, which is far shorter than a single model call.
export const maxDuration = 60

// POST /api/insights/scorecard-focus
//
// Advisory "where to focus" narrative for the EHS Scorecard. The score and the
// ranked drivers are computed DETERMINISTICALLY server-side (computeIncidentRisk)
// — the LLM is fed that authoritative analysis and only writes prose around it; it
// never produces the risk number. On any AI failure (or when the API key isn't
// configured) the route degrades to the deterministic top drivers so the card
// always renders something useful.
//
// On-demand only: the card is button-triggered, so there is no page-load
// amplification to cache against — a fresh read on each click is the right UX,
// and the per-user rate limit bounds spend.
//
// Auth: tenant-admin (the scorecard is an admin surface).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SURFACE = 'scorecard-focus' as const
const MODEL   = MODEL_BY_SURFACE[SURFACE]
const MAX_FOCUS_AREAS = 4

// Incident KPIs arrive as already-rendered JSON from the client; treat every
// field as optional + untrusted (the deterministic risk is recomputed here).
interface MonthCount { month?: unknown; count?: unknown }
interface IncidentLike {
  trir?: number | null
  dart?: number | null
  ltir?: number | null
  severityRate?: number | null
  daysSinceLastRecordable?: number
  nearMissToRecordableRatio?: number | null
  actionClosureOnTimePct?: number | null
  rcaCompletionPct?: number | null
  recordablesByMonth?: MonthCount[]
}

interface FocusArea {
  key:   string
  title: string
  why:   string
  /** Deep link to the module where the work happens — never LLM-authored;
   *  resolved server-side from the driver the area addresses. */
  href:  string | null
  label: string | null
}

interface FocusResponse {
  score:      number
  band:       string
  focusAreas: FocusArea[]
  rationale:  string
  source:     'ai' | 'fallback'
  generatedAt: string
}

const SCHEMA = {
  type: 'object',
  properties: {
    focusAreas: {
      type: 'array',
      description: 'Ranked 1–4 areas the EHS team should work next, most impactful first. Pick the drivers with the most leverage to lower incident risk.',
      items: {
        type: 'object',
        properties: {
          driverKey: { type: 'string', description: 'The key of the driver this area addresses. MUST be one of the driver keys provided in the brief.' },
          title:     { type: 'string', description: 'Short imperative action, e.g. "Close overdue corrective actions".' },
          why:       { type: 'string', description: 'One or two sentences citing the relevant numbers — why this matters now.' },
        },
        required: ['driverKey', 'title', 'why'],
        additionalProperties: false,
      },
    },
    rationale: {
      type: 'string',
      description: '1–2 sentences on where the program stands overall and the through-line across the focus areas.',
    },
  },
  required: ['focusAreas', 'rationale'],
  additionalProperties: false,
} as const

const SYSTEM_PROMPT = `You are a senior EHS analyst for Soteria FIELD, a safety-management platform. You receive a tenant's DETERMINISTIC incident-risk analysis — a 0–100 score, its band, and a ranked list of leading + lagging drivers with their current readings, targets, and contributions — plus headline KPIs and a recordable forecast.

Your job: tell the safety team where to focus to lower risk, in plain, actionable language.

Rules:
- The risk score is GIVEN. Never recompute, re-rank by your own math, or invent numbers. Reason only from the data provided.
- Choose 1–4 focus areas. Each MUST reference a driverKey from the provided list. Order by leverage (impact × how far from target).
- Prefer leading (preventive) drivers when their pressure is comparable — acting upstream prevents the lagging outcomes.
- Each "why" cites the actual reading vs. target. Be specific and concise. No hedging, no boilerplate.
- The rationale is one honest read of the program — name the through-line, don't just restate the score.
- This is advisory guidance a human reviews; it is not a compliance determination.`

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function fmtRate(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—'
}
function fmtPct(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${Math.round(v)}%` : '—'
}

// Deterministic answer: the top contributing drivers, used both as the AI's
// input and as the fallback when the AI is unavailable.
function deterministicFocus(risk: IncidentRiskResult): { focusAreas: FocusArea[]; rationale: string } {
  const top = risk.drivers.filter(d => d.contribution > 0).slice(0, MAX_FOCUS_AREAS)
  const focusAreas: FocusArea[] = top.map(d => ({
    key: d.key, title: d.label, why: d.suggestedAction, href: d.href, label: d.label,
  }))
  const rationale = top.length === 0
    ? `Predicted incident risk is ${Math.round(risk.score)}/100 (${risk.band}). No elevated drivers — program indicators are healthy; keep leading indicators strong.`
    : `Predicted incident risk is ${Math.round(risk.score)}/100 (${risk.band}). The areas below contribute the most pressure — working them in order has the highest leverage.`
  return { focusAreas, rationale }
}

function buildBrief(risk: IncidentRiskResult, inc: IncidentLike): string {
  const driverLine = (kind: 'leading' | 'lagging') =>
    risk.drivers
      .filter(d => d.kind === kind)
      .map(d => `- [${d.key}] ${d.label}: ${d.value} (target ${d.target}) · contribution +${d.contribution} · suggested: ${d.suggestedAction}`)
      .join('\n') || '- (none)'

  const recCounts = (inc.recordablesByMonth ?? []).map(m => num(m.count))
  const fc = forecastCount(recCounts)
  const trend = assessTrend(recCounts, { lowerIsBetter: true, target: 0 })
  const forecastLine = fc
    ? `Next-month recordables (projection): ${fc.expected.toFixed(1)} (95% interval ${fc.lower.toFixed(1)}–${fc.upper.toFixed(1)}); direction: ${trend?.status ?? 'flat'}${fc.hasTrend ? '' : ' (run-rate — no statistically reliable trend)'}.`
    : 'Recordable forecast: insufficient history.'

  return [
    `Predicted incident risk: ${Math.round(risk.score)}/100 — band ${risk.band}. (This score is computed deterministically; do not recompute it.)`,
    '',
    'Leading indicators (preventive — act here to PREVENT incidents):',
    driverLine('leading'),
    '',
    'Lagging indicators (outcomes that already happened):',
    driverLine('lagging'),
    '',
    forecastLine,
    '',
    'Headline KPIs:',
    `- TRIR: ${fmtRate(inc.trir)} per 100 FTE`,
    `- DART: ${fmtRate(inc.dart)} per 100 FTE`,
    `- LTIR: ${fmtRate(inc.ltir)} per 100 FTE`,
    `- Severity rate: ${fmtRate(inc.severityRate)}`,
    `- Days since last recordable: ${(inc.daysSinceLastRecordable ?? -1) < 0 ? 'none on file' : inc.daysSinceLastRecordable}`,
    `- Near-miss : recordable ratio: ${inc.nearMissToRecordableRatio == null ? '—' : `${inc.nearMissToRecordableRatio.toFixed(1)} : 1`}`,
    `- CAPA on time: ${fmtPct(inc.actionClosureOnTimePct)}`,
    `- RCA completion: ${fmtPct(inc.rcaCompletionPct)}`,
  ].join('\n')
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { incidentMetrics?: IncidentLike }
  try { body = await req.json() } catch { body = {} }
  const inc = body.incidentMetrics ?? {}

  // Authoritative, deterministic risk — recomputed server-side, never trusted
  // from the client. If this fails there is nothing to advise on.
  let risk: IncidentRiskResult
  try {
    risk = await computeIncidentRisk(supabaseAdmin(), gate.tenantId)
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/insights/scorecard-focus' } })
    return NextResponse.json({ error: 'Could not compute the risk model.' }, { status: 500 })
  }

  const generatedAt = new Date().toISOString()

  // Healthy program — no elevated drivers. Skip the AI call (nothing to
  // prioritize) and return the deterministic "all clear".
  if (risk.drivers.every(d => d.contribution === 0)) {
    const det = deterministicFocus(risk)
    return NextResponse.json<FocusResponse>({
      score: risk.score, band: risk.band, ...det, source: 'fallback', generatedAt,
    })
  }

  // Budget → rate limit (same order as the other AI routes).
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

  const driverByKey = new Map(risk.drivers.map(d => [d.key, d]))

  try {
    const client = await getAnthropic(gate.tenantId, { timeoutMs: 40_000, maxRetries: 0 })
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 900,
      thinking:   { type: 'disabled' },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: buildBrief(risk, inc) }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    })

    const textBlock = response.content.find(b => b.type === 'text')
    const parsed = textBlock && textBlock.type === 'text'
      ? JSON.parse(textBlock.text) as { focusAreas?: Array<{ driverKey?: string; title?: string; why?: string }>; rationale?: string }
      : null

    const focusAreas: FocusArea[] = (parsed?.focusAreas ?? [])
      .filter(a => a && typeof a.title === 'string' && typeof a.why === 'string')
      .slice(0, MAX_FOCUS_AREAS)
      .map(a => {
        const d = a.driverKey ? driverByKey.get(a.driverKey) : undefined
        return { key: a.driverKey ?? '', title: a.title!, why: a.why!, href: d?.href ?? null, label: d?.label ?? null }
      })

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

    // A well-formed-but-empty result is no better than the fallback.
    if (focusAreas.length === 0) {
      const det = deterministicFocus(risk)
      return NextResponse.json<FocusResponse>({
        score: risk.score, band: risk.band, ...det, source: 'fallback', generatedAt,
      })
    }

    return NextResponse.json<FocusResponse>({
      score:      risk.score,
      band:       risk.band,
      focusAreas,
      rationale:  typeof parsed?.rationale === 'string' ? parsed.rationale : deterministicFocus(risk).rationale,
      source:     'ai',
      generatedAt,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/insights/scorecard-focus' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error' })
    // Non-fatal — the deterministic drivers are a genuine answer on their own.
    const det = deterministicFocus(risk)
    return NextResponse.json<FocusResponse>({
      score: risk.score, band: risk.band, ...det, source: 'fallback', generatedAt,
    })
  }
}

export type { FocusResponse, FocusArea }
