import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import {
  buildNwsAlertsUrl,
  isWithinUsBounds,
  normalizeNwsAlerts,
  NWS_USER_AGENT,
  type NwsAlertsResponse,
} from '@soteria/core/nwsAlerts'

// GET /api/weather/alerts?lat=&lon=
//
// Server-side proxy to the NWS active-alerts endpoint. Open-Meteo carries no
// official government watches/warnings, so the board pulls them here. The
// tenant gate keeps this from being an open proxy; the NWS fetch is best-effort
// and degrades to an empty list so a flaky upstream never blocks the board.

export const runtime = 'nodejs'

const NWS_TIMEOUT_MS = 6_000

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const lat = Number(url.searchParams.get('lat'))
  const lon = Number(url.searchParams.get('lon'))
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return NextResponse.json({ error: 'lat and lon must be finite numbers' }, { status: 400 })
  }

  // NWS only covers US points; outside the bounding box there is nothing to
  // fetch, so we tell the caller rather than spending a request.
  if (!isWithinUsBounds(lat, lon)) {
    return NextResponse.json({ alerts: [], outOfBounds: true })
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), NWS_TIMEOUT_MS)
  try {
    const resp = await fetch(buildNwsAlertsUrl(lat, lon), {
      signal: ctrl.signal,
      headers: {
        'User-Agent': NWS_USER_AGENT,
        Accept: 'application/geo+json',
      },
    })
    if (!resp.ok) {
      Sentry.captureException(new Error(`NWS responded ${resp.status}`), {
        tags: { route: 'weather/alerts', stage: 'fetch' },
      })
      return NextResponse.json({ alerts: [], error: 'unavailable' })
    }
    const json = (await resp.json()) as NwsAlertsResponse
    return NextResponse.json({ alerts: normalizeNwsAlerts(json) })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'weather/alerts', stage: 'fetch' } })
    return NextResponse.json({ alerts: [], error: 'unavailable' })
  } finally {
    clearTimeout(timer)
  }
}
