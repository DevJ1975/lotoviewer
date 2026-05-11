import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const equipmentId = url.searchParams.get('equipment_id')?.trim() ?? ''

  try {
    const admin = supabaseAdmin()
    let inspectionQuery = admin
      .from('equipment_inspections')
      .select('id,equipment_id,submitted_at,readiness_result,failed_critical_count,failed_item_count,signature_name,shift_label,hour_meter')
      .eq('tenant_id', gate.tenantId)
      .order('submitted_at', { ascending: false })
      .limit(100)
    if (equipmentId) inspectionQuery = inspectionQuery.ilike('equipment_id', equipmentId.replace(/[\\%_]/g, m => '\\' + m))

    const [{ data: tenant }, { data: inspections, error: inspectionErr }, { data: defects, error: defectErr }] = await Promise.all([
      admin.from('tenants').select('name,tenant_number').eq('id', gate.tenantId).maybeSingle(),
      inspectionQuery,
      admin
        .from('equipment_defects')
        .select('description,severity,status,out_of_service,last_seen_at')
        .eq('tenant_id', gate.tenantId)
        .order('last_seen_at', { ascending: false })
        .limit(100),
    ])
    if (inspectionErr) throw inspectionErr
    if (defectErr) throw defectErr

    const pdf = await PDFDocument.create()
    const page = pdf.addPage([612, 792])
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
    let y = 744
    page.drawText('Equipment Readiness Audit Export', { x: 48, y, size: 18, font: bold, color: rgb(0.05, 0.1, 0.15) })
    y -= 22
    page.drawText(`${tenant?.name ?? 'Tenant'} #${tenant?.tenant_number ?? ''} · ${new Date().toLocaleString()}`, { x: 48, y, size: 10, font, color: rgb(0.35, 0.39, 0.45) })
    y -= 30

    page.drawText('Recent inspections', { x: 48, y, size: 13, font: bold })
    y -= 18
    for (const row of inspections ?? []) {
      if (y < 90) break
      page.drawText(`${row.equipment_id} · ${row.readiness_result} · ${new Date(row.submitted_at as string).toLocaleString()}`, { x: 54, y, size: 9, font })
      y -= 13
      page.drawText(`Failed: ${row.failed_item_count} · Critical: ${row.failed_critical_count} · Shift: ${row.shift_label ?? '-'} · Meter: ${row.hour_meter ?? '-'}`, { x: 64, y, size: 8, font, color: rgb(0.35, 0.39, 0.45) })
      y -= 14
    }

    y -= 12
    page.drawText('Recent defects', { x: 48, y, size: 13, font: bold })
    y -= 18
    for (const row of defects ?? []) {
      if (y < 60) break
      page.drawText(`${row.severity} · ${row.status} · ${row.out_of_service ? 'out of service' : 'tracked'}`, { x: 54, y, size: 9, font: bold })
      y -= 12
      page.drawText(String(row.description).slice(0, 105), { x: 64, y, size: 8, font })
      y -= 15
    }

    const bytes = await pdf.save()
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="equipment-readiness-${new Date().toISOString().slice(0, 10)}.pdf"`,
      },
    })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'equipment-readiness/export' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Export failed.' }, { status: 500 })
  }
}
