import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { buildWeatherReportData } from '@/lib/weatherReportData'
import { renderWeatherReportHtml } from '@/lib/email/sendScorecardWeatherReport'

// Admin preview of the weekly "weather report" email — renders the exact HTML
// body, on demand, so a client can see what will go out before it sends.
// Same data builder the cron uses, so the preview matches the real email.

export const runtime = 'nodejs'

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  return host ? `https://${host}` : 'https://soteriafield.app'
}

export async function GET(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  try {
    const admin = supabaseAdmin()
    const data = await buildWeatherReportData(admin, g.tenantId)
    const { data: tenant } = await g.authedClient
      .from('tenants').select('name').eq('id', g.tenantId).maybeSingle()
    const html = renderWeatherReportHtml({
      to:            g.userEmail ?? 'preview@soteriafield.app',
      recipientName: null,
      weekStart:     data.weekStart,
      rows:          data.rows,
      trir:          data.trir,
      dart:          data.dart,
      appUrl:        publicAppUrl(req),
      tenantName:    (tenant?.name as string | undefined) ?? null,
      tenantId:      g.tenantId,
      risk:          data.risk,
      unsubscribeUrl: null, // preview — no live unsubscribe link
    })
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  } catch (e) {
    return sanitizeError(e, 'GET /api/scorecard/weather-preview')
  }
}
