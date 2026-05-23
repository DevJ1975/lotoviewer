import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// Inspection templates: list + create (with items). Admin-only (the builder).

export const runtime = 'nodejs'

const ITEM_TYPES = ['pass_fail_na', 'multiple_choice', 'numeric', 'text', 'photo', 'signature'] as const

interface IncomingItem {
  section?: unknown; item_type?: unknown; prompt?: unknown
  required?: unknown; weight?: unknown; fail_creates_action?: unknown; config?: unknown
}

function normalizeItems(raw: unknown): { rows: Omit<Record<string, unknown>, 'template_id' | 'tenant_id'>[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { rows: [], error: 'items_required' }
  const rows: Record<string, unknown>[] = []
  raw.forEach((it: IncomingItem, i) => {
    const type = typeof it.item_type === 'string' ? it.item_type : ''
    const prompt = typeof it.prompt === 'string' ? it.prompt.trim() : ''
    if (!ITEM_TYPES.includes(type as (typeof ITEM_TYPES)[number]) || !prompt) return
    rows.push({
      section: typeof it.section === 'string' && it.section ? it.section : 'General',
      sort_order: i,
      item_type: type,
      prompt,
      required: it.required === true,
      weight: typeof it.weight === 'number' && it.weight > 0 ? it.weight : 1,
      fail_creates_action: it.fail_creates_action === true,
      config: it.config && typeof it.config === 'object' ? it.config : {},
    })
  })
  if (rows.length === 0) return { rows: [], error: 'items_required' }
  return { rows }
}

export async function GET(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  try {
    const { data, error } = await g.authedClient
      .from('inspection_templates')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) return sanitizeError(error, 'GET /api/inspections/templates')
    return Response.json({ templates: data ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/inspections/templates')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return Response.json({ error: 'name_required' }, { status: 400 })

  const { rows, error: itemsErr } = normalizeItems(body.items)
  if (itemsErr) return Response.json({ error: itemsErr }, { status: 400 })

  try {
    const { data: tmpl, error: tErr } = await g.authedClient
      .from('inspection_templates')
      .insert({
        tenant_id:    g.tenantId,
        name,
        description:  typeof body.description === 'string' ? body.description : null,
        category:     typeof body.category === 'string' && body.category ? body.category : 'general',
        scoring_mode: body.scoring_mode === 'none' ? 'none' : 'weighted',
        version:      1,
        created_by:   g.userId,
      })
      .select('id')
      .single()
    if (tErr || !tmpl) return sanitizeError(tErr ?? new Error('insert failed'), 'POST /api/inspections/templates')

    const { error: iErr } = await g.authedClient
      .from('inspection_template_items')
      .insert(rows.map(r => ({ ...r, tenant_id: g.tenantId, template_id: tmpl.id })))
    if (iErr) return sanitizeError(iErr, 'POST /api/inspections/templates')

    return Response.json({ id: tmpl.id }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/inspections/templates')
  }
}
