import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { obligationIdsOf, planReminders, type ReminderObligation, type TenantPeople } from '@soteria/core/environmental/reminders'
import { sendComplianceReminder } from '@/lib/email/sendComplianceReminder'
import { loadSuppressedEmails } from '@/lib/email/suppression'
import { buildUnsubscribe } from '@/lib/email/unsubscribe'

// Daily environmental compliance reminders.
//
// Finds open environmental deadlines that are overdue or inside their reminder
// window and have not been reminded about in the last week, and emails each person
// responsible (the deadline's owner, or the tenant's admins when it has none) one
// digest per tenant. A deadline is stamped as reminded only after an email that
// carried it was actually sent, so a missing email key or a provider outage means
// it is tried again tomorrow rather than silently skipped for a week.
//
// Same auth and logging posture as the other crons under /api/cron/.

export const runtime = 'nodejs'
export const maxDuration = 300

// The longest reminder window is a year (lead_days <= 365); anything due later cannot be inside one.
const HORIZON_DAYS = 366
// A ceiling, not a page size: most urgent first, so a runaway tenant cannot starve the rest.
const MAX_ROWS = 5000

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
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
  const today = now.toISOString().slice(0, 10)
  const horizon = new Date(now.getTime() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10)
  const appUrl = publicAppUrl(req)

  try {
    const { data: rows, error } = await admin.from('compliance_calendar_obligations')
      .select('id, tenant_id, facility_id, title, regulatory_ref, status, next_due_at, lead_days, last_reminded_on, owner_user_id')
      .eq('status', 'open').eq('category', 'environmental').lte('next_due_at', horizon)
      .order('next_due_at', { ascending: true }).limit(MAX_ROWS)
    if (error) {
      Sentry.captureException(error, { tags: { route: '/api/cron/compliance-calendar-reminders', stage: 'obligations' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const obligations = (rows ?? []) as ReminderObligation[]
    if (obligations.length === 0) return NextResponse.json({ tenants_scanned: 0, emails_sent: 0, message: 'No open environmental deadlines.' })

    // Only tenants that still have the module, and are not disabled.
    const tenantIds = [...new Set(obligations.map(o => o.tenant_id))]
    const { data: tenantRows } = await admin.from('tenants').select('id, name, modules, disabled_at').in('id', tenantIds)
    const tenantName = new Map<string, string>()
    const enabled = new Set<string>()
    for (const t of tenantRows ?? []) {
      tenantName.set(t.id as string, t.name as string)
      if (!t.disabled_at && isModuleVisible('environmental', (t.modules ?? null) as Record<string, boolean> | null)) enabled.add(t.id as string)
    }

    const { data: memberships } = await admin.from('tenant_memberships')
      .select('tenant_id, user_id, role, invite_cancelled_at').in('tenant_id', [...enabled]).is('invite_cancelled_at', null)
    const people = new Map<string, { memberIds: Set<string>; adminIds: string[] }>()
    for (const m of memberships ?? []) {
      const entry = people.get(m.tenant_id as string) ?? { memberIds: new Set<string>(), adminIds: [] }
      entry.memberIds.add(m.user_id as string)
      if (m.role === 'owner' || m.role === 'admin') entry.adminIds.push(m.user_id as string)
      people.set(m.tenant_id as string, entry)
    }

    const digests = planReminders(obligations.filter(o => enabled.has(o.tenant_id)), people as ReadonlyMap<string, TenantPeople>, now)
    if (digests.length === 0) {
      return NextResponse.json({ tenants_scanned: enabled.size, digests: 0, emails_sent: 0, message: 'Nothing is due a reminder today.' })
    }

    const userIds = [...new Set(digests.map(d => d.userId))]
    const [{ data: profiles }, { data: sites }, suppressed] = await Promise.all([
      admin.from('profiles').select('id, email, full_name').in('id', userIds),
      admin.from('facilities').select('id, name').in('tenant_id', [...new Set(digests.map(d => d.tenantId))]),
      loadSuppressedEmails(admin, 'reminders'),
    ])
    const profileById = new Map((profiles ?? []).map(p => [p.id as string, { email: p.email as string | null, name: (p.full_name as string | null) ?? '' }]))
    const siteName = new Map((sites ?? []).map(s => [s.id as string, s.name as string]))

    const sentDigests: typeof digests = []
    let skipped = 0
    const results = await Promise.allSettled(digests.map(async digest => {
      const profile = profileById.get(digest.userId)
      if (!profile?.email || suppressed.has(profile.email.toLowerCase())) { skipped += 1; return null }
      const outcome = await sendComplianceReminder({
        to: profile.email,
        recipientName: profile.name,
        tenantName: tenantName.get(digest.tenantId) ?? 'your account',
        items: digest.items.map(i => ({
          title: i.title, regulatoryRef: i.regulatoryRef, dueOn: i.dueOn, days: i.days, overdue: i.overdue,
          site: i.facilityId ? siteName.get(i.facilityId) ?? 'A site' : 'All sites',
        })),
        calendarUrl: `${appUrl}/environmental/compliance/calendar`,
        unsubscribeUrl: buildUnsubscribe(appUrl, profile.email, 'reminders')?.url ?? null,
      })
      if (outcome.sent) sentDigests.push(digest)
      return outcome
    }))

    // Stamp only what was actually told to someone, so a failed send is tried again tomorrow.
    const toStamp = obligationIdsOf(sentDigests)
    if (toStamp.length > 0) {
      const { error: stampError } = await admin.from('compliance_calendar_obligations').update({ last_reminded_on: today }).in('id', toStamp)
      if (stampError) Sentry.captureException(stampError, { tags: { route: '/api/cron/compliance-calendar-reminders', stage: 'stamp' } })
    }

    return NextResponse.json({
      tenants_scanned: enabled.size,
      digests:         digests.length,
      emails_sent:     sentDigests.length,
      emails_failed:   results.length - sentDigests.length - skipped,
      skipped_no_email_or_suppressed: skipped,
      deadlines_stamped: toStamp.length,
      truncated:       obligations.length === MAX_ROWS,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/compliance-calendar-reminders' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
