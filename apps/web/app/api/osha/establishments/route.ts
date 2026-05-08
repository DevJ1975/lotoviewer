import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET    /api/osha/establishments   List (any tenant member).
// POST   /api/osha/establishments   Create (admin).
// PATCH  /api/osha/establishments?id=  Update fields (admin).
// DELETE /api/osha/establishments?id=  Remove (owner only — losing
//                                      the row cascade-deletes
//                                      annual summaries that depend
//                                      on it; treat carefully).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// COLS — fields safe to return in any response. ita_api_token is
// deliberately excluded; we expose only a boolean "has_ita_api_token"
// so the UI can show a "configured" badge without ever round-
// tripping the secret.
const COLS = [
  'id', 'tenant_id', 'establishment_name',
  'street', 'city', 'state', 'zip', 'naics_code',
  'hours_employees_by_year',
  'certifying_executive_name', 'certifying_executive_title',
  'is_partial_year',
  'ita_establishment_id',
  'created_at', 'updated_at', 'created_by', 'updated_by',
].join(', ')

// Internal-only: same list + the token. Used to derive
// has_ita_api_token before stripping the column off the response.
const COLS_INTERNAL = COLS + ', ita_api_token'

interface PostBody {
  establishment_name:           string
  street?:                      string
  city?:                        string
  state?:                       string
  zip?:                         string
  naics_code?:                  string
  certifying_executive_name?:   string
  certifying_executive_title?:  string
  is_partial_year?:             boolean
  // Per-year input: caller can seed with one year up front.
  year?:                        number
  annual_avg_employees?:        number
  total_hours_worked?:          number
  // OSHA ITA submission credentials — typically set later via PATCH
  // once the admin has registered the site at osha.gov/ita and
  // generated an API token. Both columns are nullable.
  ita_establishment_id?:        string | null
  ita_api_token?:               string | null
}

interface PatchBody extends Partial<PostBody> {
  id?: string
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('osha_establishments')
      .select(COLS_INTERNAL)
      .eq('tenant_id', gate.tenantId)
      .order('establishment_name')
    if (error) throw new Error(error.message)
    // Strip the token off every row, replace with boolean. Token is
    // a secret — only the submit-to-ita route ever needs it.
    const safe = (data ?? []).map(r => {
      const row = r as unknown as Record<string, unknown>
      const { ita_api_token, ...rest } = row
      return { ...rest, has_ita_api_token: Boolean(ita_api_token) }
    })
    return NextResponse.json({ establishments: safe })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'establishments/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = (await req.json()) as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.establishment_name || !body.establishment_name.trim()) {
    return NextResponse.json({ error: 'establishment_name is required' }, { status: 400 })
  }

  const yearKey = (typeof body.year === 'number' && Number.isInteger(body.year) && body.year >= 2000)
    ? String(body.year) : null
  const hoursByYear: Record<string, { employees: number; hours: number }> = {}
  if (yearKey) {
    hoursByYear[yearKey] = {
      employees: typeof body.annual_avg_employees === 'number' ? body.annual_avg_employees : 0,
      hours:     typeof body.total_hours_worked === 'number' ? body.total_hours_worked : 0,
    }
  }

  try {
    const admin = supabaseAdmin()
    const insert = {
      tenant_id:                  gate.tenantId,
      establishment_name:         body.establishment_name.trim(),
      street:                     body.street?.trim() || null,
      city:                       body.city?.trim() || null,
      state:                      body.state?.trim() || null,
      zip:                        body.zip?.trim() || null,
      naics_code:                 body.naics_code?.trim() || null,
      hours_employees_by_year:    hoursByYear,
      certifying_executive_name:  body.certifying_executive_name?.trim() || null,
      certifying_executive_title: body.certifying_executive_title?.trim() || null,
      is_partial_year:            !!body.is_partial_year,
      created_by:                 gate.userId,
      updated_by:                 gate.userId,
    }
    const { data, error } = await admin
      .from('osha_establishments')
      .insert(insert)
      .select(COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'establishments/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ establishment: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'establishments/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── PATCH ─────────────────────────────────────────────────────────────────

const PATCHABLE_FIELDS = [
  'establishment_name', 'street', 'city', 'state', 'zip', 'naics_code',
  'certifying_executive_name', 'certifying_executive_title', 'is_partial_year',
  // OSHA-issued ID safe to round-trip; the token is handled separately
  // below so we can normalise empty-string -> null (clear) and never
  // accept a value that is just whitespace.
  'ita_establishment_id',
] as const

export async function PATCH(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: '?id= is required' }, { status: 400 })

  let body: PatchBody
  try { body = (await req.json()) as PatchBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_by: gate.userId }
  for (const k of PATCHABLE_FIELDS) {
    if (k in body) {
      const v = (body as Record<string, unknown>)[k]
      update[k] = typeof v === 'string' ? (v.trim() || null) : v
    }
  }
  // ita_api_token: accept only if explicitly present in the body. An
  // empty string clears the token; otherwise we trim and store. The
  // GET endpoint never returns the token, so a UI round-trip can't
  // accidentally clobber it — the field is only patched when the
  // admin pastes a new value.
  if ('ita_api_token' in body) {
    const raw = (body as Record<string, unknown>).ita_api_token
    if (typeof raw === 'string') {
      update.ita_api_token = raw.trim() || null
    } else if (raw === null) {
      update.ita_api_token = null
    }
  }

  // Year-input merge: callers can patch one year at a time. We read
  // the existing jsonb, merge, and write back so other years stay
  // intact.
  const yearKey = typeof body.year === 'number' ? String(body.year) : null
  if (yearKey) {
    try {
      const admin = supabaseAdmin()
      const { data: existing } = await admin
        .from('osha_establishments')
        .select('hours_employees_by_year')
        .eq('id', id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      const prior = ((existing as { hours_employees_by_year?: Record<string, unknown> } | null)?.hours_employees_by_year ?? {}) as Record<string, { employees: number; hours: number }>
      prior[yearKey] = {
        employees: typeof body.annual_avg_employees === 'number' ? body.annual_avg_employees : (prior[yearKey]?.employees ?? 0),
        hours:     typeof body.total_hours_worked === 'number' ? body.total_hours_worked : (prior[yearKey]?.hours ?? 0),
      }
      update.hours_employees_by_year = prior
    } catch (err) {
      Sentry.captureException(err, { tags: { route: 'establishments/PATCH', stage: 'year-merge' } })
      return NextResponse.json({ error: 'Failed to merge year input' }, { status: 500 })
    }
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('osha_establishments')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select(COLS)
      .single()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'establishments/PATCH' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ establishment: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'establishments/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ─── DELETE ────────────────────────────────────────────────────────────────

export async function DELETE(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  if (gate.role !== 'owner' && gate.role !== 'superadmin') {
    return NextResponse.json({ error: 'Owner-only' }, { status: 403 })
  }

  const url = new URL(req.url)
  const id = url.searchParams.get('id') ?? ''
  if (!UUID_RE.test(id))
    return NextResponse.json({ error: '?id= is required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { error } = await admin
      .from('osha_establishments')
      .delete()
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
    if (error) {
      Sentry.captureException(error, { tags: { route: 'establishments/DELETE' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'establishments/DELETE' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
