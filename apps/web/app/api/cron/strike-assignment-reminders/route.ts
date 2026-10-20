import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { loadSuppressedEmails } from '@/lib/email/suppression'
import { buildUnsubscribe } from '@/lib/email/unsubscribe'
import { sendStrikeAssignmentReminder, type StrikeReminderItem } from '@/lib/email/sendStrikeAssignmentReminder'
import { buildComplianceCells, type ComplianceAssignment, type ComplianceMember } from '@soteria/core/strikeCompliance'
import { strikeReminderFor } from '@soteria/core/strikeSchedule'
import type { StrikeVersionLineage } from '@soteria/core/strike'

// Daily STRIKE reminders to learners: one email per person listing what is
// due soon or overdue for them. Cadence lives in strikeReminderFor (3 and 1
// days before, then the day after and weekly while overdue), so a daily run
// never repeats itself. Learners without an email (roster-only contractors)
// are reached through Train now on their permits instead.
//
// Auth: Bearer CRON_SECRET or x-internal-secret INTERNAL_PUSH_SECRET, like
// every route under /api/cron/.

export const runtime = 'nodejs'
export const maxDuration = 300

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret && bearer && safeEqual(bearer, cronSecret)) return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer && safeEqual(bearer, internalSecret)) return true
  return false
}

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  return host ? `https://${host}` : 'https://soteriafield.app'
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}

export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const now = new Date()
  const appUrl = publicAppUrl(req)

  try {
    const { data: assignmentRows, error } = await admin
      .from('strike_assignments')
      .select('id,tenant_id,module_id,target_type,target_id,starts_at,due_at')
      .eq('status', 'active')
      .not('due_at', 'is', null)
      .limit(5000)
    if (error) throw new Error(error.message)

    const byTenant = new Map<string, typeof assignmentRows>()
    for (const row of assignmentRows ?? []) {
      if (row.starts_at && new Date(row.starts_at) > now) continue
      const list = byTenant.get(row.tenant_id) ?? []
      list.push(row)
      byTenant.set(row.tenant_id, list)
    }

    const suppressed = await loadSuppressedEmails(admin, 'reminders')
    let sent = 0
    for (const [tenantId, rows] of byTenant) {
      sent += await remindTenant(admin, { tenantId, rows: rows ?? [], now, appUrl, suppressed })
    }
    return NextResponse.json({ tenants: byTenant.size, emails_sent: sent })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/strike-assignment-reminders' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}

async function remindTenant(
  admin: ReturnType<typeof supabaseAdmin>,
  ctx: {
    tenantId: string
    rows: { id: string; module_id: string; target_type: string; target_id: string | null; starts_at: string | null; due_at: string | null }[]
    now: Date
    appUrl: string
    suppressed: Set<string>
  },
): Promise<number> {
  const moduleIds = [...new Set(ctx.rows.map(r => r.module_id))]
  const [tenantRes, membersRes, membershipsRes, modulesRes, versionsRes, completionsRes] = await Promise.all([
    admin.from('tenants').select('name,modules,disabled_at').eq('id', ctx.tenantId).maybeSingle(),
    admin.from('members').select('id,display_name,preferred_name,email,profile_id,department,site_label').eq('tenant_id', ctx.tenantId).eq('status', 'active'),
    admin.from('tenant_memberships').select('user_id,role').eq('tenant_id', ctx.tenantId),
    admin.from('strike_modules').select('id,title,slug,estimated_minutes').in('id', moduleIds),
    admin.from('strike_module_versions').select('id,module_id,version_number,supersedes_completions').in('module_id', moduleIds).in('status', ['published', 'superseded']),
    admin.from('strike_completions').select('module_id,module_version_id,member_id,user_id,completed_at,expires_at').eq('tenant_id', ctx.tenantId).eq('passed', true).in('module_id', moduleIds),
  ])
  const failed = [tenantRes, membersRes, membershipsRes, modulesRes, versionsRes, completionsRes].find(r => r.error)
  if (failed?.error) throw new Error(failed.error.message)
  const tenant = tenantRes.data
  if (!tenant || tenant.disabled_at || (tenant.modules as Record<string, boolean> | null)?.strike === false) return 0

  const roleByUser = new Map((membershipsRes.data ?? []).map(m => [m.user_id as string, m.role as string]))
  const members: (ComplianceMember & { email: string | null; firstName: string | null })[] = (membersRes.data ?? []).map(m => ({
    id: m.id, displayName: m.display_name, profileId: m.profile_id,
    role: m.profile_id ? roleByUser.get(m.profile_id) ?? null : null,
    department: m.department, site: m.site_label,
    email: m.email, firstName: m.preferred_name ?? m.display_name,
  }))

  // Members linked to a login may have no roster email; fall back to the profile.
  const missingEmail = members.filter(m => !m.email && m.profileId).map(m => m.profileId as string)
  if (missingEmail.length > 0) {
    const { data: profiles } = await admin.from('profiles').select('id,email').in('id', missingEmail)
    const emailByProfile = new Map((profiles ?? []).map(p => [p.id as string, p.email as string | null]))
    for (const m of members) if (!m.email && m.profileId) m.email = emailByProfile.get(m.profileId) ?? null
  }

  const lineageByModule = new Map<string, StrikeVersionLineage[]>()
  for (const v of versionsRes.data ?? []) {
    const list = lineageByModule.get(v.module_id) ?? []
    list.push({ id: v.id, versionNumber: v.version_number, supersedesCompletions: v.supersedes_completions })
    lineageByModule.set(v.module_id, list)
  }
  const assignments: ComplianceAssignment[] = ctx.rows.map(r => ({
    id: r.id, moduleId: r.module_id, targetType: r.target_type, targetId: r.target_id, startsAt: r.starts_at, dueAt: r.due_at,
  }))
  const cells = buildComplianceCells({
    members,
    assignments,
    completions: (completionsRes.data ?? []).map(c => ({
      moduleId: c.module_id, moduleVersionId: c.module_version_id, memberId: c.member_id, userId: c.user_id,
      completedAt: c.completed_at, expiresAt: c.expires_at,
    })),
    lineageByModule,
    now: ctx.now,
  })

  const modules = new Map((modulesRes.data ?? []).map(m => [m.id as string, m]))
  const itemsByMember = new Map<string, StrikeReminderItem[]>()
  for (const cell of cells) {
    if (cell.standing === 'complete' || cell.standing === 'upcoming') continue
    const kind = strikeReminderFor(cell.dueAt, ctx.now)
    const strikeModule = modules.get(cell.moduleId)
    if (!kind || !strikeModule || !cell.dueAt) continue
    const list = itemsByMember.get(cell.memberId) ?? []
    list.push({ title: strikeModule.title, slug: strikeModule.slug, dueAt: cell.dueAt, kind, minutes: strikeModule.estimated_minutes })
    itemsByMember.set(cell.memberId, list)
  }

  const results = await Promise.allSettled([...itemsByMember].map(async ([memberId, items]) => {
    const member = members.find(m => m.id === memberId)
    if (!member?.email || ctx.suppressed.has(member.email.toLowerCase())) return false
    const unsubscribe = buildUnsubscribe(ctx.appUrl, member.email, 'reminders')
    return sendStrikeAssignmentReminder({
      to: member.email,
      recipientName: member.firstName,
      tenantId: ctx.tenantId,
      tenantName: tenant.name as string,
      appUrl: ctx.appUrl,
      items,
      unsubscribeUrl: unsubscribe?.url ?? null,
      unsubscribeHeaders: unsubscribe?.headers,
    })
  }))
  return results.filter(r => r.status === 'fulfilled' && r.value).length
}
