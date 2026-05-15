import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getMemberForProfile, toMemberSummary } from '@/lib/members/server'
import type { EmploymentType, MemberReadinessStatus, MemberStatus } from '@/lib/members/types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES: ReadonlySet<MemberStatus> = new Set(['active', 'suspended', 'terminated', 'archived'])
const READINESS: ReadonlySet<MemberReadinessStatus> = new Set(['ready', 'attention', 'restricted', 'setup_needed', 'inactive'])
const EMPLOYMENT: ReadonlySet<EmploymentType> = new Set(['employee', 'contractor', 'temp', 'vendor', 'visitor', 'other'])
const DISPLAY_NAME_SOURCES = new Set(['system', 'self', 'admin'])

interface RouteContext { params: Promise<{ memberId: string }> }

const ADMIN_FIELDS = [
  'legal_name',
  'display_name',
  'display_name_source',
  'preferred_name',
  'pronouns',
  'email',
  'phone',
  'employee_id',
  'badge_id',
  'external_hris_id',
  'employment_type',
  'vendor_company',
  'department',
  'site_label',
  'position_title',
  'shift_label',
  'supervisor_member_id',
  'hire_date',
  'start_date',
  'language',
  'emergency_contact_name',
  'emergency_contact_phone',
  'readiness_status',
  'status',
  'status_reason',
  'notes',
] as const

export async function PATCH(req: Request, ctx: RouteContext) {
  const { memberId } = await ctx.params
  if (!UUID_RE.test(memberId)) return NextResponse.json({ error: 'Invalid member id' }, { status: 400 })

  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = { updated_by: gate.userId }
  for (const key of ADMIN_FIELDS) {
    if (key in body) patch[key] = body[key]
  }

  if (typeof patch.status === 'string' && !STATUSES.has(patch.status as MemberStatus)) {
    return NextResponse.json({ error: 'Invalid member status.' }, { status: 400 })
  }
  if (typeof patch.readiness_status === 'string' && !READINESS.has(patch.readiness_status as MemberReadinessStatus)) {
    return NextResponse.json({ error: 'Invalid readiness status.' }, { status: 400 })
  }
  if (typeof patch.employment_type === 'string' && !EMPLOYMENT.has(patch.employment_type as EmploymentType)) {
    return NextResponse.json({ error: 'Invalid employment type.' }, { status: 400 })
  }
  if (typeof patch.display_name_source === 'string' && !DISPLAY_NAME_SOURCES.has(patch.display_name_source)) {
    return NextResponse.json({ error: 'Invalid display name source.' }, { status: 400 })
  }
  if (patch.supervisor_member_id && typeof patch.supervisor_member_id === 'string' && !UUID_RE.test(patch.supervisor_member_id)) {
    return NextResponse.json({ error: 'Invalid supervisor member id.' }, { status: 400 })
  }
  if (typeof patch.display_name === 'string') {
    const displayName = patch.display_name.trim()
    if (!displayName || displayName.length > 160) {
      return NextResponse.json({ error: 'Display name must be 1-160 characters.' }, { status: 400 })
    }
    patch.display_name = displayName
    patch.display_name_source ??= 'admin'
  }

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('members')
      .select('id, profile_id')
      .eq('id', memberId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })

    const { data: updated, error } = await admin
      .from('members')
      .update(patch)
      .eq('id', memberId)
      .eq('tenant_id', gate.tenantId)
      .select('profile_id')
      .single()
    if (error) throw error

    const profileId = (updated as { profile_id: string | null }).profile_id
    if (profileId) {
      const member = await getMemberForProfile(admin, gate.tenantId, profileId)
      if (member) return NextResponse.json({ member })
    }

    const { data: roster, error: rosterErr } = await admin
      .from('v_member_roster')
      .select('*')
      .eq('member_id', memberId)
      .eq('tenant_id', gate.tenantId)
      .single()
    if (rosterErr) throw rosterErr
    return NextResponse.json({ member: toMemberSummary(roster as Parameters<typeof toMemberSummary>[0]) })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'admin-members/PATCH' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
