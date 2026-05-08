import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/safety-boards/entity-search?type=incident&q=foo
//
// Backs the "link this thread to an entity" picker. Returns up to 20
// matches in the given entity type for the active tenant. Each entry:
//   { id, label, sub }
// The shape is consistent across types so the picker UI can render a
// single search dropdown regardless of the underlying table.
//
// Type-to-table-and-fields mapping is enumerated explicitly here so a
// caller can't talk to arbitrary tables — only the link types we
// allow on safety_board_threads.linked_entity_type.

const LINK_TYPES = [
  'incident', 'near_miss', 'equipment', 'hot_work_permit',
  'confined_space', 'incident_action', 'jha', 'toolbox_talk',
] as const
type LinkType = typeof LINK_TYPES[number]

interface Plan {
  table:        string
  idCol:        string
  labelCols:    string[]      // first non-null wins for the row label
  subCols:      string[]      // joined with ' · ' for the secondary line
  searchCols:   string[]      // ILIKE candidates
  // Some tables (incidents, near_miss) have a tenant_id column;
  // others (equipment) do too. We always filter by tenant_id but the
  // column is named consistently.
}

const PLANS: Record<LinkType, Plan> = {
  incident:        { table: 'incidents',         idCol: 'id', labelCols: ['report_number', 'title'], subCols: ['occurred_at'], searchCols: ['report_number','title','description'] },
  near_miss:       { table: 'near_miss_reports', idCol: 'id', labelCols: ['title'],                 subCols: ['observed_at'],  searchCols: ['title','description'] },
  equipment:       { table: 'loto_equipment',    idCol: 'id', labelCols: ['equipment_id','name'],   subCols: ['department'],   searchCols: ['equipment_id','name','department'] },
  hot_work_permit: { table: 'hot_work_permits',  idCol: 'id', labelCols: ['permit_number'],         subCols: ['location','status'], searchCols: ['permit_number','location'] },
  confined_space:  { table: 'confined_spaces',   idCol: 'id', labelCols: ['space_id','name'],       subCols: ['location'],     searchCols: ['space_id','name','location'] },
  incident_action: { table: 'incident_actions',  idCol: 'id', labelCols: ['description'],           subCols: ['status','due_at'], searchCols: ['description'] },
  jha:             { table: 'jhas',              idCol: 'id', labelCols: ['title'],                 subCols: ['department'],   searchCols: ['title','department'] },
  toolbox_talk:    { table: 'toolbox_talks',     idCol: 'id', labelCols: ['title'],                 subCols: ['scheduled_for'], searchCols: ['title'] },
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const type = url.searchParams.get('type') ?? ''
  const q    = (url.searchParams.get('q') ?? '').trim()
  if (!(LINK_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: `type must be one of ${LINK_TYPES.join(', ')}` }, { status: 400 })
  }
  const plan = PLANS[type as LinkType]
  if (!q) return NextResponse.json({ items: [] })

  try {
    const admin = supabaseAdmin()
    const cols = Array.from(new Set([plan.idCol, ...plan.labelCols, ...plan.subCols, ...plan.searchCols])).join(', ')
    let query = admin.from(plan.table).select(cols).eq('tenant_id', gate.tenantId).limit(20)
    // OR-of-ILIKEs across the search columns. Supabase encodes this
    // as `or=(col.ilike.*,col.ilike.*)` which it builds via the
    // .or() helper.
    const orParts = plan.searchCols
      .map(c => `${c}.ilike.%${q.replace(/[%,]/g, '')}%`)
      .join(',')
    query = query.or(orParts)

    const { data, error } = await query
    if (error) {
      // Some tables (e.g. jhas) may not exist in every deployment;
      // surface a friendly empty list rather than 500.
      if (error.code === '42P01') return NextResponse.json({ items: [] })
      throw new Error(error.message)
    }

    type Row = Record<string, unknown>
    const items = (((data as unknown) as Row[] | null) ?? []).map(r => {
      const id = String(r[plan.idCol] ?? '')
      const label = plan.labelCols.map(c => r[c]).find(v => v != null && String(v).trim() !== '') ?? id
      const sub = plan.subCols.map(c => r[c]).filter(v => v != null && String(v).trim() !== '').join(' · ')
      return { id, label: String(label), sub }
    })
    return NextResponse.json({ items })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-entity-search/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
