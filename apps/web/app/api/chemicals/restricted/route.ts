import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  RESTRICTION_SEVERITIES,
  isValidCas,
  type RestrictionSeverity,
} from '@soteria/core/chemicals'

// GET  /api/chemicals/restricted   List the tenant's restricted-list rules.
// POST /api/chemicals/restricted   Add a rule (CAS or name pattern).

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_restricted_list')
      .select('*')
      .eq('tenant_id', gate.tenantId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rules: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const cas = typeof body.cas_number === 'string' && body.cas_number.trim()
    ? body.cas_number.trim()
    : null
  const namePattern = typeof body.name_pattern === 'string' && body.name_pattern.trim()
    ? body.name_pattern.trim()
    : null

  if (!cas && !namePattern) {
    return NextResponse.json({ error: 'Provide either cas_number or name_pattern' }, { status: 400 })
  }
  if (cas && namePattern) {
    return NextResponse.json({ error: 'Set cas_number OR name_pattern, not both' }, { status: 400 })
  }
  if (cas && !isValidCas(cas)) {
    return NextResponse.json({ error: `Invalid CAS number: ${cas}` }, { status: 400 })
  }
  if (namePattern && namePattern.length > 200) {
    return NextResponse.json({ error: 'name_pattern too long (max 200)' }, { status: 400 })
  }

  const sevRaw = typeof body.severity === 'string' ? body.severity : 'restricted'
  const severity: RestrictionSeverity = (RESTRICTION_SEVERITIES as readonly string[]).includes(sevRaw)
    ? (sevRaw as RestrictionSeverity)
    : 'restricted'

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_restricted_list')
      .insert({
        tenant_id:    gate.tenantId,
        cas_number:   cas,
        name_pattern: namePattern,
        severity,
        reason:       typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null,
        alternative:  typeof body.alternative === 'string' && body.alternative.trim() ? body.alternative.trim() : null,
        reference:    typeof body.reference === 'string' && body.reference.trim() ? body.reference.trim() : null,
        created_by:   gate.userId,
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ rule: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
