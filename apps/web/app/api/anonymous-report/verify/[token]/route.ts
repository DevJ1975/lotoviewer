import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PUBLIC GET /api/anonymous-report/verify/[token]
//
// The /report/[token] page hits this on mount to confirm the token
// is valid + fetch the location label + tenant name to show the
// worker. Returns 404 / 403 for invalid / disabled tokens with a
// consistent error message so unauthorised callers can't probe
// which tokens exist.

const TOKEN_RE = /^[0-9a-f]{64}$/i

interface RouteContext {
  params: Promise<{ token: string }>
}

export async function GET(_req: Request, ctx: RouteContext) {
  const { token } = await ctx.params
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incident_anon_intake_tokens')
      .select('label, enabled, tenant:tenants!inner(name)')
      .eq('token', token)
      .maybeSingle()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'anonymous-report/verify' } })
      return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
    }
    if (!data || !(data as { enabled: boolean }).enabled) {
      // Same response for unknown vs disabled — don't leak existence.
      return NextResponse.json({ error: 'This link is invalid or no longer active.' }, { status: 410 })
    }
    type Row = {
      label: string
      enabled: boolean
      tenant: { name: string | null } | { name: string | null }[] | null
    }
    const r = data as Row
    const tenantBlock = r.tenant
    const tenant = (Array.isArray(tenantBlock) ? tenantBlock[0] : tenantBlock) as { name: string | null } | null
    return NextResponse.json({
      label:       r.label,
      tenant_name: tenant?.name ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'anonymous-report/verify' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
