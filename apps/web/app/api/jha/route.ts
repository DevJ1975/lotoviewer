import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  JHA_FREQUENCIES,
  JHA_STATUSES,
  validateJhaCreateInput,
  type JhaFrequency,
  type JhaStatus,
} from '@soteria/core/jha'

// GET  /api/jha   List with filters + pagination (any tenant member).
// POST /api/jha   Create the header row only (tenant admin/owner).
//                 Steps / hazards / controls are added later via the
//                 slice-3 editor's nested routes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_SORTS = ['updated_at', 'created_at', 'next_review_date', 'job_number'] as const
const VALID_DIRS  = ['asc', 'desc'] as const

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)

  const statusRaw = url.searchParams.get('status')
  const statuses = statusRaw
    ? statusRaw.split(',').map(s => s.trim()).filter((s): s is JhaStatus =>
        (JHA_STATUSES as readonly string[]).includes(s))
    : []

  const freqRaw = url.searchParams.get('frequency')
  const freqs = freqRaw
    ? freqRaw.split(',').map(s => s.trim()).filter((s): s is JhaFrequency =>
        (JHA_FREQUENCIES as readonly string[]).includes(s))
    : []

  const search    = url.searchParams.get('search')?.trim() ?? ''
  const assignee  = url.searchParams.get('assigned_to')?.trim() ?? ''

  const sortRaw = url.searchParams.get('sort')
  const sort = (VALID_SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as typeof VALID_SORTS[number]) : 'updated_at'
  const dirRaw = url.searchParams.get('dir')
  const dir = (VALID_DIRS as readonly string[]).includes(dirRaw ?? '')
    ? (dirRaw as typeof VALID_DIRS[number]) : 'desc'

  const limitRaw  = url.searchParams.get('limit')
  const offsetRaw = url.searchParams.get('offset')
  const limit  = Math.min(200, Math.max(1, parseInt(limitRaw  ?? '50', 10) || 50))
  const offset = Math.max(0, parseInt(offsetRaw ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('jhas')
      .select('id, tenant_id, job_number, title, description, location, performed_by, frequency, required_ppe, status, assigned_to, reviewer, approver, approved_at, approved_by, next_review_date, last_reviewed_at, last_reviewed_by, created_at, updated_at, created_by, updated_by',
        { count: 'exact' })
      .eq('tenant_id', gate.tenantId)

    if (statuses.length > 0) q = q.in('status', statuses)
    if (freqs.length    > 0) q = q.in('frequency', freqs)
    if (assignee && UUID_RE.test(assignee)) q = q.eq('assigned_to', assignee)
    if (search) {
      const safe = search.replace(/[,()]/g, ' ').trim()
      if (safe) q = q.or(`title.ilike.%${safe}%,job_number.ilike.%${safe}%,location.ilike.%${safe}%`)
    }

    q = q.order(sort, { ascending: dir === 'asc' }).range(offset, offset + limit - 1)

    const { data, count, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({
      jhas:   data ?? [],
      total:  count ?? 0,
      limit,
      offset,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'jha/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const validationError = validateJhaCreateInput({
    title:        typeof body.title        === 'string' ? body.title        : undefined,
    frequency:    typeof body.frequency    === 'string' ? body.frequency as JhaFrequency : undefined,
    description:  typeof body.description  === 'string' ? body.description  : null,
    location:     typeof body.location     === 'string' ? body.location     : null,
    performed_by: typeof body.performed_by === 'string' ? body.performed_by : null,
  })
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const insert = {
    tenant_id:    gate.tenantId,
    title:        (body.title as string).trim(),
    description:  typeof body.description  === 'string' && body.description.trim()  ? body.description.trim()  : null,
    location:     typeof body.location     === 'string' && body.location.trim()     ? body.location.trim()     : null,
    performed_by: typeof body.performed_by === 'string' && body.performed_by.trim() ? body.performed_by.trim() : null,
    frequency:    body.frequency as JhaFrequency,
    created_by:   gate.userId,
    status:       'draft',
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('jhas')
      .insert(insert)
      .select('*')
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'jha/POST', stage: 'insert' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ jha: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'jha/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
