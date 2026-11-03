import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getModules } from '@soteria/core/features'
import { isValidStatus, isValidTenantNumber, normalizeName } from '@/lib/validation/tenants'
import { isToolboxTalkIndustry } from '@/lib/toolboxTalkPacks'
import {
  applyTenantApiKeyChange,
  parseKeyChange,
  readTenantApiKeyHint,
} from '@/lib/ai/tenantApiKeyAdmin'
import type { TenantStatus } from '@soteria/core/types'

// PATCH /api/superadmin/tenants/[number]
//
// Updates a tenant's mutable fields. tenant_number and slug are NOT
// editable — both are stable identifiers that downstream systems
// (support tickets, audit_log, storage paths) may reference.
//
// Body (all optional; only provided fields update):
//   { name?:    string,
//     status?:  'active' | 'trial' | 'disabled' | 'archived',
//     is_demo?: boolean,
//     modules?: Record<string, boolean>,
//     settings?:Record<string, unknown>,
//     anthropic_api_key?: string | null }   // string sets, null removes, omitted keeps
//
// The tenant's own Anthropic key is a secret, so it is stored in tenant_secrets
// (service role only) and has its own field. It is rejected inside `settings`,
// which every member of the tenant can read.
//
// Disabling a tenant via status='disabled' or setting disabled_at is
// handled by the same path: pass status='disabled' and the tenant is
// excluded from current_user_tenant_ids() (RLS hides their data) but
// the row stays for audit. Hard delete is intentionally not supported.

function validModuleKeys(): Set<string> {
  return new Set(
    (['safety', 'reports', 'admin'] as const).flatMap(cat =>
      getModules(cat).filter(m => !m.comingSoon).map(m => m.id),
    ),
  )
}

// GET /api/superadmin/tenants/[number]
//
// Returns whether the tenant has its own Anthropic key and its last four
// characters, never the key. The edit form shows this in place of the value.
export async function GET(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!isValidTenantNumber(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: tenant, error } = await admin
    .from('tenants').select('id').eq('tenant_number', number).maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: '/api/superadmin/tenants/[number]', stage: 'lookup' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: `No tenant with number ${number}` }, { status: 404 })

  try {
    return NextResponse.json({ anthropic_key: await readTenantApiKeyHint(tenant.id as string) })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: '/api/superadmin/tenants/[number]', stage: 'key-hint' } })
    return NextResponse.json({ error: 'Could not read the API key status' }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!isValidTenantNumber(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}

  if ('name' in body) {
    const name = normalizeName(body.name)
    if (!name) {
      return NextResponse.json({ error: 'Name must be 1–200 characters' }, { status: 400 })
    }
    patch.name = name
  }

  if ('status' in body) {
    if (!isValidStatus(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const status = body.status as TenantStatus
    patch.status = status
    // Mirror disabled_at so current_user_tenant_ids() excludes it consistently.
    patch.disabled_at = status === 'disabled' ? new Date().toISOString() : null
  }

  if ('is_demo' in body) {
    if (typeof body.is_demo !== 'boolean') {
      return NextResponse.json({ error: 'is_demo must be boolean' }, { status: 400 })
    }
    patch.is_demo = body.is_demo
  }

  if ('modules' in body) {
    if (!body.modules || typeof body.modules !== 'object' || Array.isArray(body.modules)) {
      return NextResponse.json({ error: 'modules must be an object' }, { status: 400 })
    }
    const validKeys = validModuleKeys()
    const incoming  = body.modules as Record<string, unknown>
    const modules: Record<string, boolean> = {}
    for (const key of validKeys) {
      modules[key] = incoming[key] === true
    }
    patch.modules = modules
  }

  if ('settings' in body) {
    if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
      return NextResponse.json({ error: 'settings must be an object' }, { status: 400 })
    }
    const settings = body.settings as Record<string, unknown>
    if ('anthropic_api_key' in settings) {
      return NextResponse.json(
        { error: 'Send anthropic_api_key as its own field, not inside settings' },
        { status: 400 },
      )
    }
    if ('toolbox_industry' in settings && !isToolboxTalkIndustry(settings.toolbox_industry)) {
      return NextResponse.json({ error: 'toolbox_industry must be "general" or "construction"' }, { status: 400 })
    }
    patch.settings = body.settings
  }

  let keyChange: Extract<ReturnType<typeof parseKeyChange>, { ok: true }>['change'] | null = null
  if ('anthropic_api_key' in body) {
    const parsed = parseKeyChange(body.anthropic_api_key)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    keyChange = parsed.change
  }

  if (Object.keys(patch).length === 0 && !keyChange) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  // A key-only change has no tenants columns to update, so just look the row up.
  const { data, error } = Object.keys(patch).length > 0
    ? await admin.from('tenants').update(patch).eq('tenant_number', number).select('*').maybeSingle()
    : await admin.from('tenants').select('*').eq('tenant_number', number).maybeSingle()

  if (error) {
    Sentry.captureException(error,
      { tags: { route: '/api/superadmin/tenants/[number]', stage: 'update' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: `No tenant with number ${number}` }, { status: 404 })
  }

  if (keyChange) {
    try {
      await applyTenantApiKeyChange(data.id as string, keyChange, gate.userId)
    } catch (e) {
      Sentry.captureException(e, { tags: { route: '/api/superadmin/tenants/[number]', stage: 'key-write' } })
      return NextResponse.json({ error: 'The tenant was updated but its API key could not be saved' }, { status: 500 })
    }
  }

  return NextResponse.json({ tenant: data })
}
