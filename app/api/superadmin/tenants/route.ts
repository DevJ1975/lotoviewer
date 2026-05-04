import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getModules } from '@/lib/features'
import { isValidSlug, normalizeName } from '@/lib/validation/tenants'

// POST /api/superadmin/tenants
//
// Creates a new tenant row. The 4-digit tenant_number is allocated by the
// next_tenant_number() SQL function so the sequence is monotonic and never
// reused. Owner invitation lives in a separate route (slice 6.4) so this
// stays small and idempotent.
//
// Body:
//   { name:    string,                 // required, 1–200 chars after trim
//     slug:    string,                 // required, ^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$
//     is_demo: boolean,                // optional, default false
//     modules: Record<string, boolean> // optional; missing keys default to false }
//
// Response:
//   201 → { tenant: Tenant }
//   400 → { error } for validation failures
//   409 → { error } when the slug is already taken
//   401/403 from requireSuperadmin

function validModuleKeys(): Set<string> {
  // The set of legitimate top-level module ids the form may post. Children
  // inherit their parent's flag, so they're not togglable; coming-soon
  // entries are global, not tenant-controlled.
  return new Set(
    (['safety', 'reports', 'admin'] as const).flatMap(cat =>
      getModules(cat).filter(m => !m.comingSoon).map(m => m.id),
    ),
  )
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { name?: unknown; slug?: unknown; is_demo?: unknown; modules?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const name = normalizeName(body.name)
  if (!name) {
    return NextResponse.json({ error: 'Name is required (1–200 characters)' }, { status: 400 })
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  if (!isValidSlug(slug)) {
    return NextResponse.json({
      error: 'Slug must be lowercase letters, digits, and hyphens (3–64 chars, no leading/trailing hyphen)',
    }, { status: 400 })
  }

  const isDemo = body.is_demo === true

  // Validate modules object — only known top-level keys, only booleans.
  const validKeys = validModuleKeys()
  const modulesIn = (body.modules && typeof body.modules === 'object' && !Array.isArray(body.modules))
    ? body.modules as Record<string, unknown>
    : {}
  const modules: Record<string, boolean> = {}
  for (const key of validKeys) {
    modules[key] = modulesIn[key] === true
  }

  const admin = supabaseAdmin()

  // Allocate the next tenant_number via the SQL helper so allocation is
  // atomic with the insert. Read it first so we can return it cleanly even
  // if the insert path doesn't return all columns by default.
  const { data: numRow, error: numErr } = await admin.rpc('next_tenant_number')
  if (numErr || typeof numRow !== 'string') {
    Sentry.captureException(numErr ?? new Error('next_tenant_number returned non-string'))
    return NextResponse.json({ error: 'Could not allocate tenant number' }, { status: 500 })
  }
  const tenantNumber = numRow

  const { data: tenant, error: insertErr } = await admin
    .from('tenants')
    .insert({
      tenant_number: tenantNumber,
      slug,
      name,
      status: isDemo ? 'trial' : 'active',
      is_demo: isDemo,
      modules,
      settings: {},
    })
    .select('*')
    .single()

  if (insertErr) {
    // Postgres unique-violation is 23505. Slug or custom_domain conflict.
    const code = (insertErr as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({
        error: `Slug "${slug}" is already taken`,
      }, { status: 409 })
    }
    Sentry.captureException(insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ tenant }, { status: 201 })
}
