import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { planSystemSeeds } from '@soteria/core/complianceCalendar'

// Compliance obligations: list (with lazy system-seed) + create.
// Admin-only; tenant-scoped by RLS via the gate's authed client.

export const runtime = 'nodejs'

const CADENCES = [
  'once', 'monthly', 'quarterly', 'semiannual',
  'annual', 'biennial', 'triennial', 'quinquennial', 'custom_days',
] as const

export async function GET(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  try {
    // Lazy-seed well-known regulatory deadlines for the modules this tenant has.
    const { data: tenantRow } = await g.authedClient
      .from('tenants').select('modules').eq('id', g.tenantId).maybeSingle()
    const modules = (tenantRow?.modules ?? null) as Record<string, boolean> | null

    const { data: existing, error: exErr } = await g.authedClient
      .from('compliance_obligations').select('system_key').eq('source', 'system')
    if (exErr) return sanitizeError(exErr, 'GET /api/compliance/obligations')

    const existingKeys = new Set(
      (existing ?? []).map(r => r.system_key as string | null).filter((k): k is string => !!k),
    )
    const seeds = planSystemSeeds(existingKeys, id => isModuleVisible(id, modules))
    if (seeds.length > 0) {
      await g.authedClient
        .from('compliance_obligations')
        .upsert(
          seeds.map(s => ({
            tenant_id: g.tenantId, title: s.title, description: s.description,
            regulatory_ref: s.regulatoryRef, category: s.category, cadence: s.cadence,
            next_due_at: s.nextDueAt, source: 'system', system_key: s.systemKey, status: 'open',
          })),
          { onConflict: 'tenant_id,system_key', ignoreDuplicates: true },
        )
    }

    const { data, error } = await g.authedClient
      .from('compliance_obligations')
      .select('*')
      .order('next_due_at', { ascending: true })
    if (error) return sanitizeError(error, 'GET /api/compliance/obligations')
    return Response.json({ obligations: data ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/compliance/obligations')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const nextDueAt = typeof body.next_due_at === 'string' ? body.next_due_at.slice(0, 10) : ''
  const cadence = typeof body.cadence === 'string' ? body.cadence : 'annual'

  if (!title) return Response.json({ error: 'title_required' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDueAt)) return Response.json({ error: 'next_due_at_required' }, { status: 400 })
  if (!CADENCES.includes(cadence as (typeof CADENCES)[number])) return Response.json({ error: 'invalid_cadence' }, { status: 400 })

  const cadenceDays = typeof body.cadence_days === 'number' ? Math.floor(body.cadence_days) : null
  if (cadence === 'custom_days' && (!cadenceDays || cadenceDays <= 0)) {
    return Response.json({ error: 'cadence_days_required' }, { status: 400 })
  }

  try {
    const { data, error } = await g.authedClient
      .from('compliance_obligations')
      .insert({
        tenant_id:      g.tenantId,
        title,
        description:    typeof body.description === 'string' ? body.description : null,
        regulatory_ref: typeof body.regulatory_ref === 'string' ? body.regulatory_ref : null,
        category:       typeof body.category === 'string' && body.category ? body.category : 'general',
        cadence,
        cadence_days:   cadence === 'custom_days' ? cadenceDays : null,
        next_due_at:    nextDueAt,
        owner_user_id:  typeof body.owner_user_id === 'string' ? body.owner_user_id : null,
        site_label:     typeof body.site_label === 'string' ? body.site_label : null,
        source:         'tenant',
        created_by:     g.userId,
      })
      .select('*')
      .single()
    if (error) return sanitizeError(error, 'POST /api/compliance/obligations')
    return Response.json({ obligation: data }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/compliance/obligations')
  }
}
