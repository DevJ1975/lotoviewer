import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { evaluationsToSchedule, type EvaluationRecord } from '@soteria/core/complianceEvaluation'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { loadSuppressedEmails } from '@/lib/email/suppression'
import { buildUnsubscribe } from '@/lib/email/unsubscribe'
import { sendComplianceEvaluationDue, type DueEvaluationRow } from '@/lib/email/sendComplianceEvaluationDue'
import { EMS_DISCIPLINES, todayUtc } from '@/lib/environmental/registerApi'

// Nightly compliance-evaluation scheduler (clause 9.1.2, plan D5).
//
// For every tenant with the Environmental module on, opens an evaluation for
// each obligation whose evaluation cadence comes due within the next 30 days
// (evaluationsToSchedule in packages/core), then emails whoever must do it:
// the obligation's owner while they are still a member of the tenant,
// otherwise the tenant's owners and admins.
//
// Safe to re-run: an obligation with an open evaluation is skipped, and the
// one-open-evaluation index refuses a duplicate if two runs overlap.
//
// Auth: Bearer CRON_SECRET (Vercel) or x-internal-secret INTERNAL_PUSH_SECRET,
// as for every route under /api/cron. Vercel schedule: 45 13 * * *.

export const runtime = 'nodejs'
// One paged register read per 100 tenants, one insert per due evaluation, and
// one email per recipient: the fan-out sets the runtime.
export const maxDuration = 300

/** Ids per .in() filter: they travel in the query string. */
const ID_CHUNK = 100
/** Rows per read; PostgREST never returns more than its max-rows setting (1000 on Supabase). */
const PAGE_SIZE = 1000

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
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface RegisterRow {
  id:                      string
  tenant_id:               string
  facility_id:             string | null
  discipline:              string
  status:                  string
  title:                   string
  evaluation_cadence_days: number
  owner_user_id:           string | null
  last_evaluated_at:       string | null
  open_evaluation_id:      string | null
}

interface CronResponse {
  tenantsScanned:   number
  scheduled:        number
  alreadyScheduled: number
  failed:           number
  emailsSent:       number
  emailsSkipped:    number
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => run(req))
}

export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => run(req))
}

function failure(error: unknown, stage: string): NextResponse {
  Sentry.captureException(error, { tags: { route: 'cron/compliance-evaluations', stage } })
  return NextResponse.json({ error: `Failed while reading ${stage}` }, { status: 500 })
}

async function run(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const today = todayUtc()
  const result: CronResponse = {
    tenantsScanned: 0, scheduled: 0, alreadyScheduled: 0, failed: 0, emailsSent: 0, emailsSkipped: 0,
  }

  // ── 1. Tenants with the module on ────────────────────────────────────
  const { data: tenantRows, error: tenantError } = await admin
    .from('tenants')
    .select('id, name, modules')
    .is('disabled_at', null)
  if (tenantError) return failure(tenantError, 'tenants')
  const tenants = (tenantRows ?? []).filter(t => isModuleVisible('environmental', t.modules as Record<string, boolean> | null))
  result.tenantsScanned = tenants.length
  if (tenants.length === 0) return NextResponse.json(result)
  const tenantName = new Map(tenants.map(t => [t.id as string, t.name as string]))

  // ── 2. Their obligations that have an evaluation cadence ─────────────
  const register: RegisterRow[] = []
  for (const tenantIds of chunks(tenants.map(t => t.id as string), ID_CHUNK)) {
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await admin
        .from('ms_obligation_register')
        .select('id, tenant_id, facility_id, discipline, status, title, evaluation_cadence_days, owner_user_id, last_evaluated_at, open_evaluation_id')
        .in('tenant_id', tenantIds)
        .in('discipline', EMS_DISCIPLINES)
        .not('evaluation_cadence_days', 'is', null)
        .order('id')
        .range(from, from + PAGE_SIZE - 1)
      if (error) return failure(error, 'obligations')
      register.push(...((data ?? []) as RegisterRow[]))
      if ((data ?? []).length < PAGE_SIZE) break
    }
  }

  // ── 3. What falls due ────────────────────────────────────────────────
  const evaluations: EvaluationRecord[] = register.flatMap(row => [
    ...(row.open_evaluation_id ? [{ obligationId: row.id, completedAt: null }] : []),
    ...(row.last_evaluated_at ? [{ obligationId: row.id, completedAt: row.last_evaluated_at }] : []),
  ])
  const due = evaluationsToSchedule(
    register.map(row => ({ id: row.id, evaluationCadenceDays: row.evaluation_cadence_days, active: row.status === 'open' })),
    evaluations,
    today,
  )
  if (due.length === 0) return NextResponse.json(result)
  const obligationById = new Map(register.map(row => [row.id, row]))

  // ── 4. Who does each one: the owner while still a member, else the tenant's admins ──
  const dueTenantIds = [...new Set(due.map(d => obligationById.get(d.obligationId)!.tenant_id))]
  const ownerIds = [...new Set(due.map(d => obligationById.get(d.obligationId)!.owner_user_id).filter((id): id is string => id !== null))]
  const activeMember = new Set<string>()          // `${tenantId}:${userId}`
  const adminsByTenant = new Map<string, string[]>()
  for (const tenantIds of chunks(dueTenantIds, ID_CHUNK)) {
    for (const userIds of chunks(ownerIds, ID_CHUNK)) {
      const { data, error } = await admin
        .from('tenant_memberships')
        .select('tenant_id, user_id')
        .in('tenant_id', tenantIds)
        .in('user_id', userIds)
        .is('invite_cancelled_at', null)
      if (error) return failure(error, 'owner memberships')
      for (const m of data ?? []) activeMember.add(`${m.tenant_id}:${m.user_id}`)
    }
    const { data, error } = await admin
      .from('tenant_memberships')
      .select('tenant_id, user_id')
      .in('tenant_id', tenantIds)
      .in('role', ['owner', 'admin'])
      .is('invite_cancelled_at', null)
    if (error) return failure(error, 'admin memberships')
    for (const m of data ?? []) {
      adminsByTenant.set(m.tenant_id as string, [...(adminsByTenant.get(m.tenant_id as string) ?? []), m.user_id as string])
    }
  }

  // ── 5. Open the evaluations ──────────────────────────────────────────
  const baseUrl = publicAppUrl(req)
  const inbox = new Map<string, DueEvaluationRow[]>()    // `${tenantId}:${userId}` → their new evaluations
  for (const item of due) {
    const obligation = obligationById.get(item.obligationId)!
    const owner = obligation.owner_user_id
    const assignee = owner && activeMember.has(`${obligation.tenant_id}:${owner}`) ? owner : null

    const { error } = await admin.from('ms_compliance_evaluations').insert({
      tenant_id:     obligation.tenant_id,
      facility_id:   obligation.facility_id,
      discipline:    obligation.discipline,
      obligation_id: obligation.id,
      scheduled_for: item.scheduledFor,
      assigned_to:   assignee,
    })
    if ((error as { code?: string } | null)?.code === '23505') { result.alreadyScheduled += 1; continue }
    if (error) {
      result.failed += 1
      Sentry.captureException(error, { tags: { route: 'cron/compliance-evaluations', stage: 'schedule' } })
      continue
    }
    result.scheduled += 1

    const row: DueEvaluationRow = {
      obligationTitle: obligation.title,
      scheduledFor:    item.scheduledFor,
      url:             `${baseUrl}/environmental/obligations/${obligation.id}`,
    }
    for (const userId of assignee ? [assignee] : adminsByTenant.get(obligation.tenant_id) ?? []) {
      const key = `${obligation.tenant_id}:${userId}`
      inbox.set(key, [...(inbox.get(key) ?? []), row])
    }
  }
  if (inbox.size === 0) return NextResponse.json(result)

  // ── 6. Tell them ─────────────────────────────────────────────────────
  const recipientIds = [...new Set([...inbox.keys()].map(key => key.split(':')[1]))]
  const profileById = new Map<string, { email: string | null; full_name: string | null }>()
  for (const ids of chunks(recipientIds, ID_CHUNK)) {
    const { data, error } = await admin.from('profiles').select('id, email, full_name').in('id', ids)
    if (error) return failure(error, 'profiles')
    for (const p of data ?? []) profileById.set(p.id as string, { email: p.email as string | null, full_name: p.full_name as string | null })
  }
  const suppressed = await loadSuppressedEmails(admin, 'reminders')

  await Promise.allSettled([...inbox.entries()].map(async ([key, rows]) => {
    const [tenantId, userId] = key.split(':')
    const profile = profileById.get(userId)
    if (!profile?.email || suppressed.has(profile.email.toLowerCase())) { result.emailsSkipped += 1; return }
    const sent = await sendComplianceEvaluationDue({
      to:             profile.email,
      recipientName:  profile.full_name ?? '',
      tenantName:     tenantName.get(tenantId) ?? 'your organization',
      evaluations:    rows,
      unsubscribeUrl: buildUnsubscribe(baseUrl, profile.email, 'reminders')?.url ?? null,
    })
    if (sent.sent) result.emailsSent += 1
    else result.emailsSkipped += 1
  }))

  return NextResponse.json(result)
}
