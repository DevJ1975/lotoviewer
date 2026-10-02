import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { sentNoticeKey } from '@soteria/core/environmentalPermit'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { loadSuppressedEmails } from '@/lib/email/suppression'
import { buildUnsubscribe } from '@/lib/email/unsubscribe'
import { sendPermitsDue, type ConditionLine, type RenewalLine } from '@/lib/email/sendPermitsDue'
import { todayUtc } from '@/lib/environmental/registerApi'
import {
  EVIDENCE_BUCKET,
  PENDING_EVIDENCE_PREFIX,
  PENDING_EVIDENCE_TTL_HOURS,
} from '@/lib/environmental/evidence'
import {
  planPermitNotices,
  type ConditionForNotice,
  type PermitForNotice,
  type PlannedNotice,
  type TenantPeople,
} from '@/lib/environmental/permitNotices'

// Nightly permit job (Phase 2 plan D6-D10, Q2).
//
// For every tenant with the Environmental module on:
//   1. Renewal notices: each active permit is counted down to its renewal deadline (the
//      date its own terms give for the application, else its expiry) and its owner is told
//      at 180, 90 and 30 days and once it has passed, unless a renewal is submitted.
//   2. Condition reminders: the owner of each open permit condition is reminded 14 days
//      before it is due and once when it is overdue.
// Then, for every tenant, it removes direct uploads never finalized within 24 hours.
//
// Who hears about a notice (D8): the permit's or condition's owner while still a member of
// the tenant, otherwise the tenant's owners and admins; a business-critical permit also
// reaches whoever holds the Compliance obligations process, and every owner and admin at
// 30 days and once past its deadline. One email per person lists everything owed to them.
//
// Each notice is claimed in ms_notification_log (unique on its key) before it is sent, so
// it goes out once, however often the job runs; the deadline is part of the key, so a new
// term starts a new countdown. A notice nobody could be told about (no one to tell, or every
// send failed) is released, and tried again tomorrow. A recipient who has opted out of
// reminder emails counts as told.
//
// Auth: Bearer CRON_SECRET (Vercel) or x-internal-secret INTERNAL_PUSH_SECRET, as for every
// route under /api/cron. Vercel schedule: 15 14 * * *.

export const runtime = 'nodejs'
export const maxDuration = 300

/** Ids per .in() filter: they travel in the query string. */
const ID_CHUNK = 100
/** Rows per read; PostgREST never returns more than its max-rows setting (1000 on Supabase). */
const PAGE_SIZE = 1000
/** Objects per Storage list call, and per remove call. */
const STORAGE_PAGE = 100
/** A backstop on the listing loops, so a misbehaving listing cannot spin the job. */
const MAX_STORAGE_PAGES = 1000

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

interface CronResponse {
  tenantsScanned:       number
  renewalNotices:       number
  conditionReminders:   number
  alreadySent:          number
  released:             number
  failed:               number
  emailsSent:           number
  emailsSkipped:        number
  pendingUploadsSwept:  number
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => run(req))
}

export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => run(req))
}

class ReadFailure extends Error {
  constructor(readonly cause: unknown, readonly stage: string) { super(`Failed while reading ${stage}`) }
}

function failure(error: ReadFailure): NextResponse {
  Sentry.captureException(error.cause, { tags: { route: 'cron/environmental-permits', stage: error.stage } })
  return NextResponse.json({ error: error.message }, { status: 500 })
}

/** The rows of a paged read, or a ReadFailure naming the stage. */
async function readAll<T>(
  stage: string,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw new ReadFailure(error, stage)
    rows.push(...((data ?? []) as T[]))
    if (((data ?? []) as T[]).length < PAGE_SIZE) return rows
  }
}

async function run(req: Request): Promise<NextResponse> {
  const result: CronResponse = {
    tenantsScanned: 0, renewalNotices: 0, conditionReminders: 0, alreadySent: 0, released: 0, failed: 0,
    emailsSent: 0, emailsSkipped: 0, pendingUploadsSwept: 0,
  }
  try {
    await sendNotices(req, result)
  } catch (error) {
    if (error instanceof ReadFailure) return failure(error)
    throw error
  }
  // Unfinalized uploads are swept whether or not any notice was due.
  result.pendingUploadsSwept = await sweepPendingUploads()
  return NextResponse.json(result)
}

// ── Notices ─────────────────────────────────────────────────────────────

type Outcome = 'sent' | 'opted_out' | 'failed'

async function sendNotices(req: Request, result: CronResponse): Promise<void> {
  const admin = supabaseAdmin()
  const today = todayUtc()
  const baseUrl = publicAppUrl(req)

  // 1. Tenants with the module on.
  const { data: tenantRows, error: tenantError } = await admin.from('tenants').select('id, name, modules').is('disabled_at', null)
  if (tenantError) throw new ReadFailure(tenantError, 'tenants')
  const tenants = (tenantRows ?? []).filter(t => isModuleVisible('environmental', t.modules as Record<string, boolean> | null))
  result.tenantsScanned = tenants.length
  if (tenants.length === 0) return
  const tenantName = new Map(tenants.map(t => [t.id as string, t.name as string]))
  const tenantIds = tenants.map(t => t.id as string)

  // 2. Their active permits and open permit conditions.
  const permits: PermitForNotice[] = []
  const conditions: ConditionForNotice[] = []
  for (const ids of chunks(tenantIds, ID_CHUNK)) {
    permits.push(...await readAll<PermitForNotice>('permits', (from, to) => admin
      .from('environmental_permits')
      .select('id, tenant_id, title, agency, permit_number, expires_on, renewal_application_due_on, renewal_submitted_on, business_critical, owner_user_id')
      .in('tenant_id', ids).is('retired_at', null).order('id').range(from, to)))
    conditions.push(...await readAll<ConditionForNotice>('permit conditions', (from, to) => admin
      .from('compliance_calendar_obligations')
      .select('id, tenant_id, permit_id, title, next_due_at, owner_user_id')
      .in('tenant_id', ids).not('permit_id', 'is', null).eq('status', 'open').order('id').range(from, to)))
  }

  // 3. What was already sent, so a notice goes out once.
  const alreadySent = new Set<string>()
  const subjectIds = [...permits.map(p => p.id), ...conditions.map(c => c.id)]
  for (const ids of chunks(subjectIds, ID_CHUNK)) {
    const { data, error } = await admin.from('ms_notification_log').select('subject_id, notice_key').in('subject_id', ids)
    if (error) throw new ReadFailure(error, 'notification log')
    for (const row of data ?? []) alreadySent.add(sentNoticeKey(row.subject_id as string, row.notice_key as string))
  }

  // 4. What falls due. The first plan finds which tenants and owners matter, so only they are looked up.
  const planWith = (people: ReadonlyMap<string, TenantPeople>) =>
    planPermitNotices({ today, baseUrl, permits, conditions, people, alreadySent })
  const firstPass = planWith(new Map())
  if (firstPass.length === 0) return
  const dueTenantIds = [...new Set(firstPass.map(n => n.tenantId))]
  const namedOwners = new Set<string>([
    ...permits.map(p => p.owner_user_id), ...conditions.map(c => c.owner_user_id),
  ].filter((id): id is string => id !== null))

  // Filled in below, then read as TenantPeople.
  interface PeopleBuilder { activeMembers: Set<string>; admins: string[]; obligationsHolder: string | null }
  const people = new Map<string, PeopleBuilder>(dueTenantIds.map(id =>
    [id, { activeMembers: new Set<string>(), admins: [], obligationsHolder: null }]))
  const peopleOf = (tenantId: string) => people.get(tenantId)!
  for (const ids of chunks(dueTenantIds, ID_CHUNK)) {
    for (const owners of chunks([...namedOwners], ID_CHUNK)) {
      const { data, error } = await admin.from('tenant_memberships').select('tenant_id, user_id')
        .in('tenant_id', ids).in('user_id', owners).is('invite_cancelled_at', null)
      if (error) throw new ReadFailure(error, 'owner memberships')
      for (const m of data ?? []) peopleOf(m.tenant_id as string).activeMembers.add(m.user_id as string)
    }
    const { data: admins, error: adminError } = await admin.from('tenant_memberships').select('tenant_id, user_id')
      .in('tenant_id', ids).in('role', ['owner', 'admin']).is('invite_cancelled_at', null)
    if (adminError) throw new ReadFailure(adminError, 'admin memberships')
    for (const m of admins ?? []) peopleOf(m.tenant_id as string).admins.push(m.user_id as string)

    const { data: holders, error: holderError } = await admin.from('ms_responsibilities').select('tenant_id, owner_user_id')
      .in('tenant_id', ids).eq('discipline', 'ems').eq('responsibility_key', 'obligations').not('owner_user_id', 'is', null)
    if (holderError) throw new ReadFailure(holderError, 'responsibilities')
    for (const h of holders ?? []) peopleOf(h.tenant_id as string).obligationsHolder = h.owner_user_id as string
  }
  const notices = planWith(people)

  // 5. Claim each notice before sending it.
  const claimed: PlannedNotice[] = []
  for (const notice of notices) {
    const { error } = await admin.from('ms_notification_log').insert({
      tenant_id: notice.tenantId, subject_type: notice.subjectType, subject_id: notice.subjectId,
      notice_key: notice.noticeKey, recipients: notice.recipients.length,
    })
    if ((error as { code?: string } | null)?.code === '23505') { result.alreadySent += 1; continue }
    if (error) {
      result.failed += 1
      Sentry.captureException(error, { tags: { route: 'cron/environmental-permits', stage: 'claim' } })
      continue
    }
    claimed.push(notice)
  }
  if (claimed.length === 0) return

  // 6. One digest per person.
  interface Inbox { renewals: RenewalLine[]; conditions: ConditionLine[] }
  const inbox = new Map<string, Inbox>()          // `${tenantId}:${userId}`
  for (const notice of claimed) {
    for (const userId of notice.recipients) {
      const key = `${notice.tenantId}:${userId}`
      const entry = inbox.get(key) ?? { renewals: [], conditions: [] }
      if (notice.renewal) entry.renewals.push(notice.renewal)
      if (notice.condition) entry.conditions.push(notice.condition)
      inbox.set(key, entry)
    }
  }

  const profileById = new Map<string, { email: string | null; full_name: string | null }>()
  for (const ids of chunks([...new Set([...inbox.keys()].map(key => key.split(':')[1]))], ID_CHUNK)) {
    const { data, error } = await admin.from('profiles').select('id, email, full_name').in('id', ids)
    if (error) throw new ReadFailure(error, 'profiles')
    for (const p of data ?? []) profileById.set(p.id as string, { email: p.email as string | null, full_name: p.full_name as string | null })
  }
  const suppressed = await loadSuppressedEmails(admin, 'reminders')

  const outcomes = new Map<string, Outcome>()
  await Promise.allSettled([...inbox.entries()].map(async ([key, entry]) => {
    const [tenantId, userId] = key.split(':')
    const profile = profileById.get(userId)
    if (!profile?.email) { outcomes.set(key, 'failed'); result.emailsSkipped += 1; return }
    if (suppressed.has(profile.email.toLowerCase())) { outcomes.set(key, 'opted_out'); result.emailsSkipped += 1; return }
    const sent = await sendPermitsDue({
      to:             profile.email,
      recipientName:  profile.full_name ?? '',
      tenantName:     tenantName.get(tenantId) ?? 'your organization',
      renewals:       entry.renewals,
      conditions:     entry.conditions,
      unsubscribeUrl: buildUnsubscribe(baseUrl, profile.email, 'reminders')?.url ?? null,
    })
    outcomes.set(key, sent.sent ? 'sent' : 'failed')
    if (sent.sent) result.emailsSent += 1
    else result.emailsSkipped += 1
  }))

  // 7. A notice nobody was told about is released, to be tried again tomorrow.
  for (const notice of claimed) {
    const told = notice.recipients.some(userId => {
      const outcome = outcomes.get(`${notice.tenantId}:${userId}`)
      return outcome === 'sent' || outcome === 'opted_out'
    })
    if (told) {
      if (notice.renewal) result.renewalNotices += 1
      else result.conditionReminders += 1
      continue
    }
    const { error } = await admin.from('ms_notification_log').delete()
      .eq('tenant_id', notice.tenantId).eq('subject_type', notice.subjectType)
      .eq('subject_id', notice.subjectId).eq('notice_key', notice.noticeKey)
    if (error) {
      result.failed += 1
      Sentry.captureException(error, { tags: { route: 'cron/environmental-permits', stage: 'release' } })
    } else {
      result.released += 1
    }
  }
}

// ── Unfinalized direct uploads ──────────────────────────────────────────

interface StorageEntry { name: string; id: string | null; created_at: string | null }

/** Every entry under `path` in the evidence bucket, a page at a time. */
async function listAll(path: string): Promise<StorageEntry[]> {
  const bucket = supabaseAdmin().storage.from(EVIDENCE_BUCKET)
  const entries: StorageEntry[] = []
  for (let page = 0; page < MAX_STORAGE_PAGES; page++) {
    const { data, error } = await bucket.list(path, { limit: STORAGE_PAGE, offset: page * STORAGE_PAGE })
    if (error) throw error
    entries.push(...((data ?? []) as StorageEntry[]))
    if ((data ?? []).length < STORAGE_PAGE) break
  }
  return entries
}

/**
 * Removes pending uploads (Phase 2 Q2) that were never finalized within
 * PENDING_EVIDENCE_TTL_HOURS. A file that was filed lives under its tenant's
 * evidence prefix, never under pending/, so nothing filed is touched. Best
 * effort: a failure goes to Sentry and does not fail the notices.
 */
async function sweepPendingUploads(): Promise<number> {
  try {
    const bucket = supabaseAdmin().storage.from(EVIDENCE_BUCKET)
    const cutoff = Date.now() - PENDING_EVIDENCE_TTL_HOURS * 3_600_000
    let swept = 0
    for (const folder of await listAll(PENDING_EVIDENCE_PREFIX)) {
      if (folder.id !== null || folder.name.startsWith('.')) continue
      const stale = (await listAll(`${PENDING_EVIDENCE_PREFIX}/${folder.name}`))
        .filter(file => file.id !== null && !file.name.startsWith('.') && file.created_at !== null && Date.parse(file.created_at) < cutoff)
        .map(file => `${PENDING_EVIDENCE_PREFIX}/${folder.name}/${file.name}`)
      for (const paths of chunks(stale, STORAGE_PAGE)) {
        const removed = await bucket.remove(paths)
        if (removed.error) throw removed.error
        swept += paths.length
      }
    }
    return swept
  } catch (error) {
    Sentry.captureException(error, { level: 'warning', tags: { route: 'cron/environmental-permits', stage: 'sweep' } })
    return 0
  }
}
