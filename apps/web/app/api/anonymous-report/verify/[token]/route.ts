import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { clientIp, hashIp, recordAttempt } from '@/lib/anonReport/ipThrottle'

// PUBLIC GET /api/anonymous-report/verify/[token]
//
// The /report/[token] page hits this on mount to confirm the token
// is valid and fetch:
//   - the location label
//   - the tenant name
//   - the tenant's default report locale + retaliation override
//   - whether captcha is required (so the form lazy-loads Turnstile)
//
// Returns 410 Gone for invalid / disabled tokens with a consistent
// error message so unauthorised callers can't probe which tokens
// exist. Probes count against the IP throttle (verify_invalid).

const TOKEN_RE = /^[0-9a-f]{64}$/i

interface RouteContext {
  params: Promise<{ token: string }>
}

export async function GET(req: Request, ctx: RouteContext) {
  const { token } = await ctx.params
  const ipHash = hashIp(clientIp(req))

  if (!TOKEN_RE.test(token)) {
    void recordAttempt(ipHash, 'verify_invalid')
    return NextResponse.json({ error: 'Invalid link' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incident_anon_intake_tokens')
      .select(`
        id, label, enabled, require_captcha,
        tenant:tenants!inner(name, default_report_locale, retaliation_statement_override)
      `)
      .eq('token', token)
      .maybeSingle()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'anonymous-report/verify' } })
      return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
    }
    if (!data || !(data as unknown as { enabled: boolean }).enabled) {
      void recordAttempt(ipHash, 'verify_invalid', null)
      return NextResponse.json(
        { error: 'This link is invalid or no longer active.' },
        { status: 410 },
      )
    }
    type Row = {
      id: string
      label: string
      enabled: boolean
      require_captcha: boolean
      tenant: {
        name: string | null
        default_report_locale: string | null
        retaliation_statement_override: string | null
      } | Array<{
        name: string | null
        default_report_locale: string | null
        retaliation_statement_override: string | null
      }> | null
    }
    const r = data as unknown as Row
    const tenantBlock = r.tenant
    const tenant = (Array.isArray(tenantBlock) ? tenantBlock[0] : tenantBlock) ?? {
      name: null, default_report_locale: 'en', retaliation_statement_override: null,
    }
    void recordAttempt(ipHash, 'verify_ok', r.id)
    return NextResponse.json({
      label:                r.label,
      tenant_name:          tenant.name ?? null,
      default_locale:       tenant.default_report_locale ?? 'en',
      retaliation_statement:tenant.retaliation_statement_override ?? null,
      require_captcha:      r.require_captcha === true,
      turnstile_site_key:   process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'anonymous-report/verify' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
