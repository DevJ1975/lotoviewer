import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET   /api/risk/controls-library     list controls (any tenant member)
//   ?hazard_category=physical filter for the wizard panel
//   ?include_inactive=1       include soft-deleted entries (admin UI)
// POST  /api/risk/controls-library     create a custom control (admin)
//
// Returns ordered by hierarchy level (elimination → ppe per ISO
// 45001 8.1.2) then by name.

const HIERARCHY_ORDER = ['elimination','substitution','engineering','administrative','ppe']
const VALID_HIERARCHY_LEVELS = ['elimination','substitution','engineering','administrative','ppe']
const VALID_CATS = ['physical','chemical','biological','mechanical','electrical','ergonomic','psychosocial','environmental','radiological']

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const cat            = url.searchParams.get('hazard_category')?.trim() || null
  const includeInactive = url.searchParams.get('include_inactive') === '1'

  try {
    let query = gate.authedClient
      .from('controls_library')
      .select('id, hierarchy_level, name, description, regulatory_ref, applicable_categories, active, created_at, updated_at')
      .order('name', { ascending: true })

    if (!includeInactive) query = query.eq('active', true)

    if (cat) {
      query = query.contains('applicable_categories', JSON.stringify([cat]))
    }

    const { data, error } = await query
    if (error) throw new Error(error.message)

    const sorted = (data ?? []).slice().sort((a, b) => {
      const aIdx = HIERARCHY_ORDER.indexOf(a.hierarchy_level)
      const bIdx = HIERARCHY_ORDER.indexOf(b.hierarchy_level)
      if (aIdx !== bIdx) return aIdx - bIdx
      return a.name.localeCompare(b.name)
    })

    return NextResponse.json({ controls: sorted })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/controls-library/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

interface PostBody {
  hierarchy_level?:       unknown
  name?:                  unknown
  description?:           unknown
  applicable_categories?: unknown
  regulatory_ref?:        unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (typeof body.hierarchy_level !== 'string' || !VALID_HIERARCHY_LEVELS.includes(body.hierarchy_level)) {
    return NextResponse.json({ error: 'hierarchy_level must be one of ' + VALID_HIERARCHY_LEVELS.join(', ') }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const description = typeof body.description    === 'string' ? body.description.trim()    || null : null
  const regulatory_ref = typeof body.regulatory_ref === 'string' ? body.regulatory_ref.trim() || null : null

  let applicable_categories: string[] = []
  if (Array.isArray(body.applicable_categories)) {
    applicable_categories = body.applicable_categories
      .filter((c): c is string => typeof c === 'string')
      .filter(c => VALID_CATS.includes(c))
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('controls_library')
      .insert({
        tenant_id:       gate.tenantId,
        hierarchy_level: body.hierarchy_level,
        name,
        description,
        regulatory_ref,
        applicable_categories,
        active:          true,
        created_by:      gate.userId,
      })
      .select('*')
      .single()
    if (error) {
      // Unique-violation on (tenant_id, hierarchy_level, name)
      if (typeof error.message === 'string' && error.message.includes('unique')) {
        return NextResponse.json({
          error: 'A control with that name + hierarchy level already exists.',
          code:  'duplicate_control',
        }, { status: 409 })
      }
      Sentry.captureException(error, { tags: { route: 'controls-library/POST' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ control: data }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'controls-library/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
