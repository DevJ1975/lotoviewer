import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/superadmin/queries/run
//   Body: { sql: string, max_rows?: number }
//
// Executes a read-only SQL query via public.exec_readonly_sql() and
// returns the rows. Three independent guard rails:
//   1. requireSuperadmin (route-level).
//   2. Regex check below: must start with WITH/SELECT/EXPLAIN.
//   3. exec_readonly_sql sets transaction_read_only = on + a 10s
//      statement_timeout. The DB refuses writes even if we slip
//      something past the regex.
//
// Hard caps: sql ≤ 8000 chars; max_rows ≤ 5000 (mirrors the function).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_LEAD = /^\s*(with\s|select\s|explain\s)/i

export interface RunResponse {
  rows:        Array<Record<string, unknown>>
  rowCount:    number
  durationMs:  number
  truncated:   boolean
  maxRows:     number
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { sql?: string; max_rows?: number }
  try { body = (await req.json()) as typeof body }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const sql = (body.sql ?? '').trim()
  if (sql.length === 0)     return NextResponse.json({ error: 'sql is required' }, { status: 400 })
  if (sql.length > 8000)    return NextResponse.json({ error: 'sql exceeds 8000 chars' }, { status: 400 })
  if (!ALLOWED_LEAD.test(sql)) {
    return NextResponse.json(
      { error: 'Only SELECT, WITH, or EXPLAIN statements are allowed' },
      { status: 400 },
    )
  }

  const maxRowsRaw = Number(body.max_rows ?? 1000)
  const maxRows = Number.isFinite(maxRowsRaw) ? Math.min(Math.max(Math.floor(maxRowsRaw), 1), 5000) : 1000

  const admin = supabaseAdmin()
  const startedAt = Date.now()
  const { data, error } = await admin.rpc('exec_readonly_sql', { sql_text: sql, max_rows: maxRows })
  const durationMs = Date.now() - startedAt

  if (error) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details ?? null, durationMs },
      { status: 400 },
    )
  }

  const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : []
  const truncated = rows.length >= maxRows
  return NextResponse.json({
    rows,
    rowCount: rows.length,
    durationMs,
    truncated,
    maxRows,
  } as RunResponse)
}
