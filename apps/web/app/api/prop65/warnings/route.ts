import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  PROP65_HARM_ENDPOINTS,
  type Prop65HarmEndpoint,
} from '@soteria/core/prop65'

// POST /api/prop65/warnings — record a newly posted Prop 65 sign.
// Photo upload is performed CLIENT-SIDE to the loto-photos bucket at
// prop65WarningPhotoPath(...). The caller then submits photo_url.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const WARNING_TYPES = ['long_form', 'short_form'] as const
type WarningType = (typeof WARNING_TYPES)[number]

const SELECT_COLS = [
  'id', 'tenant_id', 'site_id', 'prop65_chemical_ids',
  'warning_type', 'harm_endpoint', 'posted_at', 'posted_by_user_id',
  'photo_url', 'removed_at', 'removed_by_user_id', 'warning_text',
  'created_at', 'updated_at',
].join(', ')

interface PostBody {
  site_id?:              unknown
  prop65_chemical_ids?:  unknown
  warning_type?:         unknown
  harm_endpoint?:        unknown
  photo_url?:            unknown
  warning_text?:         unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const siteId       = typeof body.site_id === 'string' ? body.site_id : ''
  const warningType  = typeof body.warning_type === 'string' ? body.warning_type : ''
  const endpoint     = typeof body.harm_endpoint === 'string' ? body.harm_endpoint : ''
  const photoUrl     = typeof body.photo_url === 'string' ? body.photo_url : null
  const warningText  = typeof body.warning_text === 'string' ? body.warning_text.trim() : ''
  const chemIds      = Array.isArray(body.prop65_chemical_ids)
    ? (body.prop65_chemical_ids as unknown[]).filter((v): v is string => typeof v === 'string')
    : []

  if (!UUID_RE.test(siteId))
    return NextResponse.json({ error: 'site_id must be a uuid' }, { status: 400 })
  if (chemIds.length === 0 || chemIds.some(c => !UUID_RE.test(c)))
    return NextResponse.json({ error: 'prop65_chemical_ids must be a non-empty uuid array' }, { status: 400 })
  if (!WARNING_TYPES.includes(warningType as WarningType))
    return NextResponse.json({ error: `warning_type must be one of ${WARNING_TYPES.join(', ')}` }, { status: 400 })
  if (!PROP65_HARM_ENDPOINTS.includes(endpoint as Prop65HarmEndpoint))
    return NextResponse.json({ error: `harm_endpoint must be one of ${PROP65_HARM_ENDPOINTS.join(', ')}` }, { status: 400 })
  if (!warningText)
    return NextResponse.json({ error: 'warning_text required' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: site } = await admin
      .from('prop65_sites')
      .select('id')
      .eq('id', siteId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    // Validate every chemical id exists in the system-wide list.
    const { count: chemCount } = await admin
      .from('prop65_chemicals')
      .select('id', { count: 'exact', head: true })
      .in('id', chemIds)
    if ((chemCount ?? 0) !== chemIds.length)
      return NextResponse.json({ error: 'One or more prop65_chemical_ids do not exist' }, { status: 400 })

    const insert = {
      tenant_id:           gate.tenantId,
      site_id:             siteId,
      prop65_chemical_ids: chemIds,
      warning_type:        warningType,
      harm_endpoint:       endpoint,
      posted_by_user_id:   gate.userId,
      photo_url:           photoUrl,
      warning_text:        warningText,
    }
    const { data, error } = await admin
      .from('prop65_warnings')
      .insert(insert)
      .select(SELECT_COLS)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ warning: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
