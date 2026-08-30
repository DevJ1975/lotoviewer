import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/superadmin/sds-library/seed-runs/[id]/items/review
//   { approve?: string[], reject?: string[], approve_all?: boolean }
//
// The human gate on the AI-proposed list. Only items still 'proposed'
// transition — approved/rejected/researched items are left untouched so a
// re-submit can't undo research. approve_all flips every remaining proposed
// item to approved (the common "the list looks good" path).

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IDS = 2000

interface Ctx { params: Promise<{ id: string }> }

function uuidList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
    .slice(0, MAX_IDS)
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: runId } = await ctx.params
  if (!UUID_RE.test(runId)) return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = (await req.json()) as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const approveIds = uuidList(body.approve)
  const rejectIds  = uuidList(body.reject)
  const approveAll = body.approve_all === true

  const admin = supabaseAdmin()
  let approved = 0
  let rejected = 0

  try {
    if (approveAll) {
      const { data, error } = await admin
        .from('sds_library_seed_items')
        .update({ status: 'approved' })
        .eq('seed_run_id', runId)
        .eq('status', 'proposed')
        .select('id')
      if (error) throw new Error(error.message)
      approved = (data ?? []).length
    } else if (approveIds.length > 0) {
      const { data, error } = await admin
        .from('sds_library_seed_items')
        .update({ status: 'approved' })
        .eq('seed_run_id', runId)
        .eq('status', 'proposed')
        .in('id', approveIds)
        .select('id')
      if (error) throw new Error(error.message)
      approved = (data ?? []).length
    }

    if (rejectIds.length > 0) {
      const { data, error } = await admin
        .from('sds_library_seed_items')
        .update({ status: 'rejected' })
        .eq('seed_run_id', runId)
        .eq('status', 'proposed')
        .in('id', rejectIds)
        .select('id')
      if (error) throw new Error(error.message)
      rejected = (data ?? []).length
    }

    // If the list review left no proposed items, advance the run so the UI
    // reflects it's ready to research.
    if (approved > 0) {
      await admin.from('sds_library_seed_runs')
        .update({ status: 'researching' })
        .eq('id', runId)
        .eq('status', 'list_review')
    }

    return NextResponse.json({ approved, rejected })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
