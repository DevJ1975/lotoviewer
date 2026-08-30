import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  EM385_PROJECT_STATUSES,
  validateCreateProjectInput,
  type Em385Edition,
  type Em385ProjectStatus,
} from '@soteria/core/em385'
import { planRegisterSeed, type Em385CatalogEntry } from '@soteria/core/em385Seeding'

// GET  /api/em385/projects   List USACE contracts for the active tenant (member).
// POST /api/em385/projects   Create a contract + seed its register (admin).
//
// On create we insert the project via the service-role client so the
// project-number trigger fires cleanly, then seed the register from the
// requirements catalog's default-required rows for the chosen edition.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const statusRaw = url.searchParams.get('status')
  const statuses = statusRaw
    ? statusRaw.split(',').map(s => s.trim()).filter((s): s is Em385ProjectStatus =>
        (EM385_PROJECT_STATUSES as readonly string[]).includes(s))
    : []

  try {
    let q = gate.authedClient
      .from('em385_projects')
      .select('id, tenant_id, facility_id, project_number, contract_number, title, edition, gda, prime_contractor, location, start_date, end_date, status, ssho_name, created_at, updated_at, updated_by')
      .eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: false })

    if (statuses.length > 0) q = q.in('status', statuses)

    const { data, error } = await q
    if (error) throw new Error(error.message)

    return NextResponse.json({ projects: data ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/projects/GET' } })
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

  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

  const validationError = validateCreateProjectInput({
    contract_number: typeof body.contract_number === 'string' ? body.contract_number : undefined,
    title:           typeof body.title === 'string' ? body.title : undefined,
    edition:         typeof body.edition === 'string' ? body.edition as Em385Edition : undefined,
    start_date:      str(body.start_date),
    end_date:        str(body.end_date),
  })
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 })

  const facilityId = str(body.facility_id) ?? gate.facilityId
  if (facilityId && !UUID_RE.test(facilityId)) {
    return NextResponse.json({ error: 'facility_id must be a uuid or null' }, { status: 400 })
  }

  const edition = body.edition as Em385Edition
  const insert = {
    tenant_id:        gate.tenantId,
    facility_id:      facilityId,
    contract_number:  (body.contract_number as string).trim(),
    title:            (body.title as string).trim(),
    edition,
    gda:              str(body.gda),
    prime_contractor: str(body.prime_contractor),
    location:         str(body.location),
    start_date:       str(body.start_date),
    end_date:         str(body.end_date),
    ssho_name:        str(body.ssho_name),
    updated_by:       gate.userId,
  }

  try {
    const admin = supabaseAdmin()

    const { data: project, error: projErr } = await admin
      .from('em385_projects')
      .insert(insert)
      .select('*')
      .single()
    if (projErr) return sanitizeError(projErr, 'em385/projects/POST:project')

    // Seed the register from the catalog's default-required rows for the edition.
    const { data: catalog, error: catErr } = await admin
      .from('em385_requirements')
      .select('id, edition, category, title, default_required')
      .eq('edition', edition)
      .eq('default_required', true)
    if (catErr) return sanitizeError(catErr, 'em385/projects/POST:catalog')

    const seed = planRegisterSeed((catalog ?? []) as Em385CatalogEntry[], {
      projectId: project.id,
      tenantId:  gate.tenantId,
      edition,
    })

    let seededCount = 0
    if (seed.length > 0) {
      const { error: seedErr } = await admin.from('em385_register_items').insert(seed)
      if (seedErr) return sanitizeError(seedErr, 'em385/projects/POST:seed')
      seededCount = seed.length
    }

    return NextResponse.json({ project, seededCount }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/projects/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
