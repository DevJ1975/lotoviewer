import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { isMissingMembersSchema, listMembersForTenant } from '@/lib/members/server'
import { resolveLegacyRoster } from '@/lib/notifications/mentions'

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const includeArchived = url.searchParams.get('includeArchived') === '1'
  const limit = Number(url.searchParams.get('limit') ?? '80')

  try {
    const members = await listMembersForTenant(gate.authedClient, gate.tenantId, {
      q,
      includeArchived,
      limit: Number.isFinite(limit) ? limit : 80,
    })
    return NextResponse.json({ members })
  } catch (error) {
    if (isMissingMembersSchema(error)) {
      const legacy = await resolveLegacyRoster(gate.authedClient, gate.tenantId)
      return NextResponse.json({
        members: legacy.map(m => ({
          member_id: m.user_id,
          tenant_id: gate.tenantId,
          profile_id: m.user_id,
          user_id: m.user_id,
          handle: m.handle,
          member_code: `M-${m.user_id.slice(0, 6).toUpperCase()}`,
          display_name: m.full_name || m.email || m.handle,
          display_name_source: 'system',
          legal_name: m.full_name,
          preferred_name: m.full_name,
          pronouns: null,
          email: m.email,
          phone: null,
          employee_id: null,
          badge_id: null,
          employment_type: 'employee',
          vendor_company: null,
          department: null,
          site_label: null,
          position_title: null,
          shift_label: null,
          supervisor_member_id: null,
          supervisor_name: null,
          language: null,
          emergency_contact_name: null,
          emergency_contact_phone: null,
          notification_preferences: null,
          readiness_status: 'setup_needed',
          status: 'active',
          avatar_url: m.avatar_url,
          tenant_role: null,
          is_admin: null,
          is_superadmin: null,
          created_at: '',
          updated_at: '',
          mention_label: m.full_name || m.email || m.handle,
          mention_subtitle: m.email ?? '',
        })),
      })
    }
    Sentry.captureException(error, { tags: { route: 'members-search/GET' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
