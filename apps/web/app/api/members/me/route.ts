import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getMemberForProfile, getOrCreateMemberForProfile, isMissingMembersSchema } from '@/lib/members/server'
import { SELF_EDITABLE_MEMBER_FIELDS, type MemberProfilePatch } from '@/lib/members/types'

const FIELD_LIMITS: Partial<Record<keyof MemberProfilePatch, number>> = {
  preferred_name: 120,
  pronouns: 40,
  phone: 60,
  language: 40,
  emergency_contact_name: 120,
  emergency_contact_phone: 60,
}

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const member = await getOrCreateMemberForProfile(supabaseAdmin(), gate.tenantId, gate.userId)
    return NextResponse.json({ member })
  } catch (error) {
    if (isMissingMembersSchema(error)) return NextResponse.json({ member: null })
    Sentry.captureException(error, { tags: { route: 'members-me/GET' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: MemberProfilePatch
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const key of SELF_EDITABLE_MEMBER_FIELDS) {
    if (!(key in body)) continue
    const value = body[key]
    if (typeof value === 'string') {
      const normalized = value.trim()
      const limit = FIELD_LIMITS[key]
      if (limit && normalized.length > limit) {
        return NextResponse.json({ error: `${fieldLabel(key)} is too long.` }, { status: 400 })
      }
      patch[key] = normalized || null
    } else if (key === 'notification_preferences') {
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
        return NextResponse.json({ error: 'Notification preferences must be an object.' }, { status: 400 })
      }
      patch[key] = value ?? null
    } else {
      patch[key] = value ?? null
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No editable member fields supplied.' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const member = await getOrCreateMemberForProfile(admin, gate.tenantId, gate.userId)
    if (!member) {
      return NextResponse.json({
        error: 'Your profile is still being set up for this tenant. Ask an administrator to open Member Management and refresh your roster.',
      }, { status: 404 })
    }

    const updatePatch: Record<string, unknown> = { ...patch, updated_by: gate.userId }
    if ('preferred_name' in patch && member.display_name_source !== 'admin') {
      updatePatch.display_name = (patch.preferred_name as string | null)
        || member.legal_name
        || member.email
        || member.display_name
      updatePatch.display_name_source = patch.preferred_name ? 'self' : 'system'
    }

    const { error } = await admin
      .from('members')
      .update(updatePatch)
      .eq('id', member.member_id)
      .eq('tenant_id', gate.tenantId)
    if (error) throw error

    const { error: eventErr } = await admin.from('member_status_events').insert({
      tenant_id: gate.tenantId,
      member_id: member.member_id,
      event_type: 'updated',
      actor_user_id: gate.userId,
      reason: 'self_profile_updated',
      old_values: {
        preferred_name: member.preferred_name,
        pronouns: member.pronouns,
        phone: member.phone,
        language: member.language,
        emergency_contact_name: member.emergency_contact_name,
        emergency_contact_phone: member.emergency_contact_phone,
        notification_preferences: member.notification_preferences,
      },
      new_values: patch,
    })
    if (eventErr) throw eventErr

    const reloaded = await getMemberForProfile(admin, gate.tenantId, gate.userId)
    return NextResponse.json({
      member: reloaded,
    })
  } catch (error) {
    if (isMissingMembersSchema(error)) {
      return NextResponse.json({
        error: 'Your profile is still being set up for this tenant. Ask an administrator to open Member Management and refresh your roster.',
      }, { status: 503 })
    }
    Sentry.captureException(error, { tags: { route: 'members-me/PATCH' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}

function fieldLabel(key: keyof MemberProfilePatch): string {
  return key.replaceAll('_', ' ').replace(/^\w/, c => c.toUpperCase())
}
