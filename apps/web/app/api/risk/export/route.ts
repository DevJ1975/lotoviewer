import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/risk/export?format=json
//
// Returns the active tenant's full risk register as a structured
// JSON document, packaged with Content-Disposition: attachment so
// the browser downloads instead of rendering. Audit-friendly format
// for ISO 45001 inspectors who want machine-readable evidence.
//
// Includes per risk:
//   - Risk fields (every column from the risks table)
//   - Linked controls with hierarchy_level + library name + status
//   - Review history (every risk_reviews row)
//   - Audit timeline (every risk_audit_log entry, with before/after
//     row JSON intact)
//
// The Cal/OSHA IIPP printable layout is a separate page at
// /risk/export/iipp that uses the same data but renders as a
// browser-printable HTML view (Cmd-P → Save as PDF).
//
// Auth: any tenant member.

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'json'
  if (format !== 'json' && format !== 'pdf') {
    return NextResponse.json({ error: 'Unsupported format. Use ?format=json or ?format=pdf' }, { status: 400 })
  }
  if (format === 'pdf') return handlePdf(req, gate)

  try {
    const admin = supabaseAdmin()

    // ─── Tenant header for the export ──────────────────────────────────
    const { data: tenantRow } = await admin
      .from('tenants')
      .select('id, name, tenant_number, slug')
      .eq('id', gate.tenantId)
      .maybeSingle()

    // ─── Risks + controls + reviews + audit, all tenant-scoped ─────────
    const [risksRes, controlsRes, reviewsRes, auditRes] = await Promise.all([
      admin
        .from('risks')
        .select('*')
        .eq('tenant_id', gate.tenantId)
        .order('risk_number', { ascending: true }),
      admin
        .from('risk_controls')
        .select('id, risk_id, hierarchy_level, control_id, custom_name, status, notes, implemented_at, verified_at, created_at, controls_library(name, regulatory_ref)')
        .eq('tenant_id', gate.tenantId),
      admin
        .from('risk_reviews')
        .select('id, risk_id, reviewed_at, reviewed_by, trigger, inherent_score_at_review, residual_score_at_review, outcome, notes')
        .eq('tenant_id', gate.tenantId)
        .order('reviewed_at', { ascending: false }),
      admin
        .from('risk_audit_log')
        .select('id, risk_id, event_type, actor_id, actor_email, context, occurred_at, before_row, after_row')
        .eq('tenant_id', gate.tenantId)
        .order('occurred_at', { ascending: true }),
    ])
    if (risksRes.error)    throw new Error(risksRes.error.message)
    if (controlsRes.error) throw new Error(controlsRes.error.message)
    if (reviewsRes.error)  throw new Error(reviewsRes.error.message)
    if (auditRes.error)    throw new Error(auditRes.error.message)

    // ─── Group children by risk_id for embedding ───────────────────────
    type ControlRow = {
      id: string; risk_id: string; hierarchy_level: string;
      control_id: string | null; custom_name: string | null;
      status: string; notes: string | null;
      implemented_at: string | null; verified_at: string | null;
      created_at: string;
      controls_library?: { name?: string; regulatory_ref?: string } | null
    }
    const controlsByRisk = new Map<string, ControlRow[]>()
    for (const c of (controlsRes.data ?? []) as unknown as ControlRow[]) {
      if (!controlsByRisk.has(c.risk_id)) controlsByRisk.set(c.risk_id, [])
      controlsByRisk.get(c.risk_id)!.push(c)
    }

    type ReviewRow = { id: string; risk_id: string; [k: string]: unknown }
    const reviewsByRisk = new Map<string, ReviewRow[]>()
    for (const r of (reviewsRes.data ?? []) as unknown as ReviewRow[]) {
      if (!reviewsByRisk.has(r.risk_id)) reviewsByRisk.set(r.risk_id, [])
      reviewsByRisk.get(r.risk_id)!.push(r)
    }

    type AuditRow = { id: number; risk_id: string; [k: string]: unknown }
    const auditByRisk = new Map<string, AuditRow[]>()
    for (const a of (auditRes.data ?? []) as unknown as AuditRow[]) {
      if (!auditByRisk.has(a.risk_id)) auditByRisk.set(a.risk_id, [])
      auditByRisk.get(a.risk_id)!.push(a)
    }

    // ─── Assemble the export envelope ──────────────────────────────────
    const exported_at = new Date().toISOString()
    const risks = (risksRes.data ?? []).map(r => ({
      ...r,
      controls: (controlsByRisk.get(r.id) ?? []).map(c => ({
        id:                c.id,
        hierarchy_level:   c.hierarchy_level,
        control_id:        c.control_id,
        library_name:      c.controls_library?.name ?? null,
        regulatory_ref:    c.controls_library?.regulatory_ref ?? null,
        custom_name:       c.custom_name,
        status:            c.status,
        notes:             c.notes,
        implemented_at:    c.implemented_at,
        verified_at:       c.verified_at,
        created_at:        c.created_at,
      })),
      reviews: reviewsByRisk.get(r.id) ?? [],
      audit:   auditByRisk.get(r.id) ?? [],
    }))

    const envelope = {
      schema:       'soteria-field.risk-register.v1',
      generated_at: exported_at,
      generator:    'soteria-field/risk-export',
      standards:    ['ISO 45001:2018 6.1', 'OSHA 29 CFR 1910', 'Cal/OSHA T8 §3203 IIPP'],
      tenant: {
        id:            tenantRow?.id ?? gate.tenantId,
        name:          tenantRow?.name ?? null,
        tenant_number: tenantRow?.tenant_number ?? null,
        slug:          tenantRow?.slug ?? null,
      },
      counts: {
        risks:    (risksRes.data    ?? []).length,
        controls: (controlsRes.data ?? []).length,
        reviews:  (reviewsRes.data  ?? []).length,
        audit:    (auditRes.data    ?? []).length,
      },
      risks,
    }

    const slug = (tenantRow?.slug ?? gate.tenantId).replace(/[^a-z0-9-]/gi, '-')
    const date = exported_at.slice(0, 10)
    const filename = `risk-register-${slug}-${date}.json`

    return new NextResponse(JSON.stringify(envelope, null, 2), {
      status: 200,
      headers: {
        'Content-Type':        'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/export/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// ───────────────────────────────────────────────────────────────────────────
// PDF branch — concise tabular register, one row per risk.
// ───────────────────────────────────────────────────────────────────────────

async function handlePdf(_req: Request, gate: { ok: true; userId: string; userEmail: string | null; tenantId: string; role: string }) {
  try {
    const { buildRiskRegisterPdf } = await import('@/lib/pdfRiskRegister')
    type RiskRegisterRow = Parameters<typeof buildRiskRegisterPdf>[1][number]
    const admin = supabaseAdmin()

    const { data: tenantRow } = await admin
      .from('tenants')
      .select('id, name, tenant_number, slug')
      .eq('id', gate.tenantId)
      .maybeSingle()

    const { data: risksRes, error: risksErr } = await admin
      .from('risks')
      .select('risk_number, title, hazard_category, status, inherent_band, inherent_score, residual_band, residual_score, next_review_date')
      .eq('tenant_id', gate.tenantId)
      .order('risk_number', { ascending: true })
    if (risksErr) throw new Error(risksErr.message)

    const generatedAt = new Date().toISOString()
    const meta = {
      tenantName:    tenantRow?.name ?? 'Tenant',
      tenantNumber:  tenantRow?.tenant_number ?? '',
      generatedAt,
      generatedBy:   gate.userEmail,
      totalRisks:    risksRes?.length ?? 0,
    }

    const bytes = await buildRiskRegisterPdf(meta, (risksRes ?? []) as RiskRegisterRow[])

    const slug = (tenantRow?.slug ?? gate.tenantId).replace(/[^a-z0-9-]/gi, '-')
    const filename = `risk-register-${slug}-${generatedAt.slice(0, 10)}.pdf`

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type':        'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control':       'no-store',
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/export/GET', format: 'pdf' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
