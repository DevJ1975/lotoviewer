import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { VERSION_LINE } from '@/lib/version'

// GET /api/superadmin/tenants/[number]/export
//
// Bundle every tenant-scoped table's rows for the named tenant into
// a single JSON download. v1 ships the data only — photos in
// loto-photos/ Storage are NOT included; an admin can mirror those
// separately via Supabase Storage UI if needed.
//
// Response shape:
//   {
//     exported_at: ISO timestamp,
//     app_version: 'v1.9.0 (sha)',
//     tenant: { id, tenant_number, name, status, settings, modules },
//     tables: {
//       loto_equipment: [...],
//       loto_workers:   [...],
//       ...
//     },
//     row_counts: { loto_equipment: N, loto_workers: M, ... }
//   }
//
// Why not ZIP/CSV: single-file JSON has zero new deps, is trivially
// re-importable, and validates with a single parse. A separate
// "export-csv-per-table" endpoint can land later if Excel-friendly
// output is needed.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Table list is hardcoded so the export shape is stable + reviewable.
// New tables added in future migrations need an entry here, otherwise
// the export silently misses them.
const TENANT_SCOPED_TABLES = [
  'loto_equipment',
  'loto_energy_steps',
  'loto_workers',
  'loto_devices',
  'loto_device_checkouts',
  'loto_gas_meters',
  'loto_meter_alerts',
  'loto_training_records',
  'loto_confined_spaces',
  'loto_confined_space_permits',
  'loto_confined_space_entries',
  'loto_atmospheric_tests',
  'loto_hot_work_permits',
  'loto_webhook_subscriptions',
  'loto_push_subscriptions',
  'loto_hygiene_log',
  'risks',
  'risk_controls',
  'risk_reviews',
  'risk_audit_log',
  'jhas',
  'jha_steps',
  'jha_hazards',
  'jha_controls',
  'near_misses',
  'near_miss_attachments',
  'support_tickets',
  'support_conversations',
  'support_messages',
  'support_message_feedback',
  'ai_invocations',
  'email_log',
] as const

export async function GET(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!/^\d{4}$/.test(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: tenantRow, error: tenantErr } = await admin
    .from('tenants')
    .select('id, tenant_number, name, slug, status, is_demo, settings, modules, created_at')
    .eq('tenant_number', number)
    .maybeSingle()
  if (tenantErr) return NextResponse.json({ error: tenantErr.message }, { status: 500 })
  if (!tenantRow) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Fan out one query per table. PostgREST can't do "give me all tables
  // matching a column predicate" — has to be one round-trip per table.
  // Done in parallel; total time is bounded by the slowest table.
  const tenantId = tenantRow.id as string
  const results = await Promise.all(
    TENANT_SCOPED_TABLES.map(async (table) => {
      const { data, error } = await admin.from(table).select('*').eq('tenant_id', tenantId)
      // A table the operator hasn't migrated yet (or that doesn't exist
      // in this schema) returns an error. Skip it but record so the
      // exporter doesn't silently drop data the operator expected.
      if (error) {
        return { table, rows: null as null, error: error.message }
      }
      return { table, rows: (data ?? []) as Array<Record<string, unknown>>, error: null }
    }),
  )

  const tables: Record<string, Array<Record<string, unknown>>> = {}
  const rowCounts: Record<string, number> = {}
  const skipped: Array<{ table: string; reason: string }> = []
  for (const r of results) {
    if (r.rows === null) {
      skipped.push({ table: r.table, reason: r.error })
      continue
    }
    tables[r.table] = r.rows
    rowCounts[r.table] = r.rows.length
  }

  const payload = {
    exported_at: new Date().toISOString(),
    app_version: VERSION_LINE,
    exported_by: gate.userId,
    tenant:      tenantRow,
    row_counts:  rowCounts,
    skipped,                        // tables that errored (typically: not-yet-migrated)
    tables,
  }

  // Stream as a download attachment so the browser saves the file
  // rather than rendering JSON inline.
  const filename = `tenant-${number}-export-${new Date().toISOString().slice(0, 10)}.json`
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status:  200,
    headers: {
      'content-type':         'application/json',
      'content-disposition':  `attachment; filename="${filename}"`,
    },
  })
}
