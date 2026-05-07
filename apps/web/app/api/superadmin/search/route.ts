import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/search?q=<term>
//
// Find anything across every tenant: equipment ID/description,
// confined-space permit serial, hot-work permit serial, worker
// name/employee_id, profile email/full_name, support ticket
// subject. Each query is bounded by limit + scoped to the relevant
// columns. Service role bypasses RLS so all tenants are searched.
//
// Used by /superadmin/search and (potentially) the global header
// command palette later.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PER_TYPE_LIMIT = 20    // results per resource bucket
const MIN_QUERY_LEN  = 2

export interface SearchHit {
  kind:        'equipment' | 'cs_permit' | 'hot_work_permit' | 'worker' | 'profile' | 'ticket'
  id:          string
  tenant_id:   string | null
  tenant_name: string | null
  title:       string
  subtitle:    string | null
  href:        string  // tenant-scoped link to the resource
}

export interface SearchResponse {
  query: string
  hits:  SearchHit[]
  /** Per-bucket counts so the UI can show "X equipment / Y permits / ..." chips. */
  counts: Record<SearchHit['kind'], number>
  truncated: boolean   // true if any bucket hit its per-type limit
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  if (q.length < MIN_QUERY_LEN) {
    return NextResponse.json({
      query: q,
      hits:  [],
      counts: { equipment: 0, cs_permit: 0, hot_work_permit: 0, worker: 0, profile: 0, ticket: 0 },
      truncated: false,
    } as SearchResponse)
  }

  // Sanitize the query before embedding it inside .or() filter strings.
  // PostgREST's .or() expression is comma-delimited; a literal comma in
  // the value breaks the parser. Parentheses + slashes are also reserved
  // in some PostgREST versions. Stripping these means the user can
  // search for "foo, bar" and get hits for "foo bar" instead of an
  // error. The % wildcard is allowed because it's the ilike wildcard.
  const sanitized = q.replace(/[,()/]/g, ' ').replace(/\s+/g, ' ').trim()
  const ilike = `%${sanitized}%`
  const admin = supabaseAdmin()

  const [equip, csp, hwp, workers, profiles, tickets, tenantRows] = await Promise.all([
    admin.from('loto_equipment')
      .select('equipment_id, description, department, tenant_id')
      .or(`equipment_id.ilike.${ilike},description.ilike.${ilike}`)
      .eq('decommissioned', false)
      .limit(PER_TYPE_LIMIT),
    admin.from('loto_confined_space_permits')
      .select('id, serial, space_id, purpose, tenant_id')
      .or(`serial.ilike.${ilike},purpose.ilike.${ilike}`)
      .limit(PER_TYPE_LIMIT),
    admin.from('loto_hot_work_permits')
      .select('id, serial, work_description, tenant_id')
      .or(`serial.ilike.${ilike},work_description.ilike.${ilike}`)
      .limit(PER_TYPE_LIMIT),
    admin.from('loto_workers')
      .select('id, full_name, employee_id, email, tenant_id')
      .or(`full_name.ilike.${ilike},employee_id.ilike.${ilike},email.ilike.${ilike}`)
      .limit(PER_TYPE_LIMIT),
    admin.from('profiles')
      .select('id, email, full_name')
      .or(`email.ilike.${ilike},full_name.ilike.${ilike}`)
      .limit(PER_TYPE_LIMIT),
    admin.from('support_tickets')
      .select('id, subject, summary, tenant_id')
      .or(`subject.ilike.${ilike},summary.ilike.${ilike}`)
      .limit(PER_TYPE_LIMIT),
    admin.from('tenants').select('id, name'),
  ])

  const tenantNameById = new Map<string, string>()
  for (const t of (tenantRows.data ?? []) as Array<{ id: string; name: string }>) {
    tenantNameById.set(t.id, t.name)
  }

  const tenantNumberByIdPromise = admin
    .from('tenants').select('id, tenant_number')
    .then(r => {
      const m = new Map<string, string>()
      for (const t of (r.data ?? []) as Array<{ id: string; tenant_number: string }>) {
        m.set(t.id, t.tenant_number)
      }
      return m
    })
  const tenantNumberById = await tenantNumberByIdPromise

  const hits: SearchHit[] = []
  const counts: Record<SearchHit['kind'], number> = {
    equipment: 0, cs_permit: 0, hot_work_permit: 0, worker: 0, profile: 0, ticket: 0,
  }

  for (const r of (equip.data ?? []) as Array<{ equipment_id: string; description: string | null; department: string | null; tenant_id: string }>) {
    hits.push({
      kind: 'equipment',
      id:   r.equipment_id,
      tenant_id:   r.tenant_id,
      tenant_name: tenantNameById.get(r.tenant_id) ?? null,
      title:       r.equipment_id,
      subtitle:    [r.description, r.department].filter(Boolean).join(' · ') || null,
      href:        `/equipment/${encodeURIComponent(r.equipment_id)}`,
    })
    counts.equipment++
  }

  for (const r of (csp.data ?? []) as Array<{ id: string; serial: string; space_id: string; purpose: string | null; tenant_id: string }>) {
    hits.push({
      kind: 'cs_permit',
      id:   r.id,
      tenant_id:   r.tenant_id,
      tenant_name: tenantNameById.get(r.tenant_id) ?? null,
      title:       r.serial,
      subtitle:    [r.space_id, r.purpose].filter(Boolean).join(' · ') || null,
      href:        `/confined-spaces/${encodeURIComponent(r.space_id)}/permits/${r.id}`,
    })
    counts.cs_permit++
  }

  for (const r of (hwp.data ?? []) as Array<{ id: string; serial: string; work_description: string | null; tenant_id: string }>) {
    hits.push({
      kind: 'hot_work_permit',
      id:   r.id,
      tenant_id:   r.tenant_id,
      tenant_name: tenantNameById.get(r.tenant_id) ?? null,
      title:       r.serial,
      subtitle:    r.work_description,
      href:        `/hot-work/${r.id}`,
    })
    counts.hot_work_permit++
  }

  for (const r of (workers.data ?? []) as Array<{ id: string; full_name: string; employee_id: string | null; email: string | null; tenant_id: string }>) {
    hits.push({
      kind: 'worker',
      id:   r.id,
      tenant_id:   r.tenant_id,
      tenant_name: tenantNameById.get(r.tenant_id) ?? null,
      title:       r.full_name,
      subtitle:    [r.employee_id, r.email].filter(Boolean).join(' · ') || null,
      href:        '/admin/workers',
    })
    counts.worker++
  }

  for (const r of (profiles.data ?? []) as Array<{ id: string; email: string | null; full_name: string | null }>) {
    hits.push({
      kind: 'profile',
      id:   r.id,
      tenant_id:   null,
      tenant_name: null,
      title:       r.full_name ?? r.email ?? r.id.slice(0, 8),
      subtitle:    r.email,
      href:        `/superadmin/users`,
    })
    counts.profile++
  }

  for (const r of (tickets.data ?? []) as Array<{ id: string; subject: string; summary: string | null; tenant_id: string | null }>) {
    hits.push({
      kind: 'ticket',
      id:   r.id,
      tenant_id:   r.tenant_id,
      tenant_name: r.tenant_id ? (tenantNameById.get(r.tenant_id) ?? null) : null,
      title:       r.subject,
      subtitle:    r.summary,
      href:        `/superadmin/support`,
    })
    counts.ticket++
  }

  // Append tenant-number badges to subtitles where applicable so the
  // results are scannable without an extra column.
  for (const h of hits) {
    if (!h.tenant_id) continue
    const num = tenantNumberById.get(h.tenant_id)
    if (num) {
      h.subtitle = h.subtitle ? `${h.subtitle} · #${num}` : `#${num}`
    }
  }

  const truncated = Object.values(counts).some(n => n === PER_TYPE_LIMIT)

  return NextResponse.json({ query: q, hits, counts, truncated } as SearchResponse)
}
