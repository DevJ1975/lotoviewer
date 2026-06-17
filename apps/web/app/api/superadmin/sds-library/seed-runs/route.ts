import Anthropic from '@anthropic-ai/sdk'
import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic, aiErrorToResponse } from '@/lib/ai/client'
import { logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { proposeChemicalList } from '@/lib/ai/seedChemicalList'

// Superadmin: seed the global SDS reference library.
//
//   POST /api/superadmin/sds-library/seed-runs   { target_count?, chunk_size? }
//     Creates a run and generates ONE chunk of candidate chemicals (a
//     web_search-backed proposal) into sds_library_seed_items (status
//     'proposed'). A human reviews them via the /items/review route before
//     the /research pass discovers each one's SDS.
//   GET  /api/superadmin/sds-library/seed-runs
//     Lists recent runs for the dashboard.

export const runtime = 'nodejs'

const SEED_MODEL = MODEL_BY_SURFACE['seed-sds-list']

const DEFAULT_TARGET = 1000
const MAX_TARGET     = 2000           // hard cap — bounds the AI spend a run can authorize
const DEFAULT_CHUNK  = 50
const MAX_CHUNK      = 100            // one generation call stays bounded
// Rough discover cost per chemical (Sonnet + web_search). Coarse by design —
// surfaced so the operator sees the order of magnitude before researching.
const EST_USD_PER_CHEMICAL = 0.12

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.floor(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> }
  catch { /* empty body is fine — use defaults */ }

  const targetCount = clampInt(body.target_count, DEFAULT_TARGET, 1, MAX_TARGET)
  const chunkSize   = clampInt(body.chunk_size, DEFAULT_CHUNK, 1, MAX_CHUNK)

  const admin = supabaseAdmin()

  const { data: run, error: runErr } = await admin
    .from('sds_library_seed_runs')
    .insert({ status: 'list_review', target_count: targetCount, created_by: gate.userId })
    .select('*')
    .single()
  if (runErr) return NextResponse.json({ error: runErr.message }, { status: 500 })
  const runId = (run as { id: string }).id

  let client: Anthropic
  try {
    client = await getAnthropic(null)
  } catch (err) {
    const mapped = aiErrorToResponse(err, 'seed-sds-list')
    Sentry.captureException(err, { tags: { ...mapped.tags, route: '/api/superadmin/sds-library/seed-runs' } })
    // The run row exists but has no candidates; return it so the operator can
    // see it and retry once the key is configured.
    return NextResponse.json({ run, ...mapped.body }, { status: mapped.status })
  }

  try {
    const { chemicals, usage } = await proposeChemicalList(client, chunkSize)
    await logAiInvocation({
      userId: gate.userId, tenantId: null, surface: 'seed-sds-list', model: SEED_MODEL,
      status: 'success', inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, context: runId,
    })

    // Dedupe the chunk by (lower name, cas) before insert so the run's unique
    // index can't reject the whole batch.
    const seen = new Set<string>()
    const rows = chemicals
      .filter(c => {
        const key = `${c.name.toLowerCase()}|${c.cas ?? ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map(c => ({
        seed_run_id:           runId,
        proposed_name:         c.name,
        proposed_cas:          c.cas,
        proposed_manufacturer: c.manufacturer,
        rationale:             c.rationale || null,
        status:                'proposed',
      }))

    let inserted: unknown[] = []
    if (rows.length > 0) {
      const { data, error: insErr } = await admin
        .from('sds_library_seed_items')
        .insert(rows)
        .select('*')
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
      inserted = data ?? []
    }

    await admin.from('sds_library_seed_runs')
      .update({ counts: { proposed: inserted.length } })
      .eq('id', runId)

    return NextResponse.json({
      run,
      items:           inserted,
      proposed:        inserted.length,
      target_count:    targetCount,
      estimated_research_cost_usd: Math.round(targetCount * EST_USD_PER_CHEMICAL * 100) / 100,
      estimate_note:   'Rough order-of-magnitude estimate (~$0.12/chemical for discovery); actual cost is tracked per call in ai_invocations.',
    }, { status: 201 })
  } catch (err) {
    await logAiInvocation({
      userId: gate.userId, tenantId: null, surface: 'seed-sds-list', model: SEED_MODEL,
      status: 'error', context: runId,
    })
    Sentry.captureException(err, { tags: { route: '/api/superadmin/sds-library/seed-runs', stage: 'propose' } })
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ run, error: `AI error ${err.status}: ${err.message}` }, { status: 502 })
    }
    return NextResponse.json({ run, error: 'List generation failed.' }, { status: 502 })
  }
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('sds_library_seed_runs')
    .select('id, status, target_count, counts, created_by, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ runs: data ?? [] })
}
