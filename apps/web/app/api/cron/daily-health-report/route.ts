import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { renderSupportTicketSection, type DigestTicket } from '@/lib/support/digest'

// Daily app-health digest. Aggregates the last 24h of bug reports +
// audit log + tenant metrics + (when configured) Sentry top issues,
// and emails the result to DEV_DIGEST_EMAIL (default
// jamil@trainovations.com).
//
// Vercel Cron schedule: 10:00 UTC daily = 5am EST / 6am EDT (the
// closest single-cron approximation of the user's "6am Eastern"
// preference without DST gymnastics).
//
// Auth: same Bearer-token pattern as /api/cron/meter-bump-reminders.
// Vercel sends Authorization: Bearer <CRON_SECRET> on scheduled
// invocations; manual curl with INTERNAL_PUSH_SECRET also works for
// debugging.

export const runtime = 'nodejs'

const RECIPIENT  = process.env.DEV_DIGEST_EMAIL ?? 'jamil@trainovations.com'
const FROM_EMAIL = process.env.DIGEST_FROM_EMAIL
              ?? process.env.SUPPORT_FROM_EMAIL
              ?? 'Soteria FIELD <onboarding@resend.dev>'

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
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }

async function run(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const admin = supabaseAdmin()

  // ─── Bug reports (last 24h) ─────────────────────────────────────────────
  const { data: bugRows } = await admin
    .from('bug_reports')
    .select('id, severity, title, reporter_email, created_at, emailed_ok')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  const bugs = bugRows ?? []
  const bugsBySeverity = {
    critical: bugs.filter(b => b.severity === 'critical').length,
    high:     bugs.filter(b => b.severity === 'high').length,
    medium:   bugs.filter(b => b.severity === 'medium').length,
    low:      bugs.filter(b => b.severity === 'low').length,
  }
  const { count: openBugs } = await admin
    .from('bug_reports')
    .select('*', { count: 'exact', head: true })
    .is('resolved_at', null)

  // ─── AI support tickets (last 24h + open backlog) ──────────────────────
  // Mirrors the bug-reports pattern. Joining tenants(name) gives the
  // digest enough context that the user doesn't have to cross-reference
  // tenant_id by hand.
  const { data: ticketRows } = await admin
    .from('support_tickets')
    .select('id, subject, reason, user_email, user_name, emailed_ok, resolved_at, created_at, tenants(name)')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  type TicketRow = Omit<DigestTicket, 'tenant_name'> & {
    tenants: { name: string | null } | { name: string | null }[] | null
  }
  const supportRecent: DigestTicket[] = ((ticketRows ?? []) as unknown as TicketRow[]).map(r => ({
    id:          r.id,
    subject:     r.subject,
    reason:      r.reason,
    user_email:  r.user_email,
    user_name:   r.user_name,
    tenant_name: Array.isArray(r.tenants) ? r.tenants[0]?.name ?? null : r.tenants?.name ?? null,
    emailed_ok:  r.emailed_ok,
    resolved_at: r.resolved_at,
    created_at:  r.created_at,
  }))
  const { count: supportOpen } = await admin
    .from('support_tickets')
    .select('*', { count: 'exact', head: true })
    .is('resolved_at', null)

  // ─── Audit-log activity (last 24h) ──────────────────────────────────────
  const { data: auditRows } = await admin
    .from('audit_log')
    .select('table_name, operation')
    .gte('created_at', since)
  const audit = auditRows ?? []
  const auditByOp: Record<string, number> = {}
  const auditByTable: Record<string, number> = {}
  for (const row of audit) {
    auditByOp[row.operation]    = (auditByOp[row.operation]    ?? 0) + 1
    auditByTable[row.table_name] = (auditByTable[row.table_name] ?? 0) + 1
  }
  const topAuditTables = Object.entries(auditByTable)
    .sort(([, a], [, b]) => b - a).slice(0, 5)

  // ─── Tenant health ──────────────────────────────────────────────────────
  const { data: tenants } = await admin
    .from('tenants')
    .select('id, tenant_number, name, status, is_demo, created_at, disabled_at')
    .order('tenant_number')
  const allTenants = tenants ?? []
  const newTenantsLast24h = allTenants.filter(t => t.created_at >= since)
  const tenantsByStatus = {
    active:   allTenants.filter(t => t.status === 'active'   && !t.disabled_at).length,
    trial:    allTenants.filter(t => t.status === 'trial'    && !t.disabled_at).length,
    disabled: allTenants.filter(t => t.disabled_at !== null).length,
    archived: allTenants.filter(t => t.status === 'archived').length,
  }

  // ─── Pending invites (members who never signed in) ──────────────────────
  // Query memberships joined with auth.users.last_sign_in_at via a
  // listUsers pass, since we want a count not a full join.
  let pendingInvites = 0
  let totalMembers = 0
  try {
    const { data: ms } = await admin
      .from('tenant_memberships')
      .select('user_id')
    const memberIds = new Set((ms ?? []).map(m => m.user_id))
    totalMembers = memberIds.size

    const lastSignInByUser = new Map<string, string | null>()
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) break
      const users = data?.users ?? []
      for (const u of users) lastSignInByUser.set(u.id, u.last_sign_in_at ?? null)
      if (users.length < 200) break
    }
    for (const id of memberIds) {
      if (!lastSignInByUser.get(id)) pendingInvites++
    }
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: '/api/cron/daily-health-report', stage: 'pending-invites' },
    })
  }

  // ─── Sentry top issues (optional — only when SENTRY_AUTH_TOKEN is set) ──
  let sentrySection = '_Skipped — set SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT in Vercel env to enable._'
  const sentryToken   = process.env.SENTRY_AUTH_TOKEN
  const sentryOrg     = process.env.SENTRY_ORG
  const sentryProject = process.env.SENTRY_PROJECT
  if (sentryToken && sentryOrg && sentryProject) {
    try {
      const url = `https://sentry.io/api/0/projects/${encodeURIComponent(sentryOrg)}/${encodeURIComponent(sentryProject)}/issues/?statsPeriod=24h&query=is:unresolved&limit=10`
      const sres = await fetch(url, {
        headers: { Authorization: `Bearer ${sentryToken}` },
      })
      if (sres.ok) {
        type SentryIssue = { title: string; count?: string | number; firstSeen?: string; permalink: string }
        const issues = await sres.json() as SentryIssue[]
        if (issues.length === 0) {
          sentrySection = '_No unresolved Sentry issues in the last 24h. ✅_'
        } else {
          sentrySection = issues.slice(0, 10).map(i =>
            `- **${i.title}** — ${i.count ?? '?'} events · [view](${i.permalink})`
          ).join('\n')
        }
      } else {
        sentrySection = `_Sentry API returned ${sres.status} — check SENTRY_AUTH_TOKEN scope._`
      }
    } catch (err) {
      Sentry.captureException(err, { tags: { route: '/api/cron/daily-health-report', stage: 'sentry' } })
      sentrySection = '_Sentry fetch threw — see Sentry for details._'
    }
  }

  // ─── Compose ────────────────────────────────────────────────────────────
  const dayLabel = new Date().toISOString().slice(0, 10)
  const subject = `Soteria FIELD — daily health · ${dayLabel}`
  const text = renderText({
    dayLabel,
    bugs, bugsBySeverity, openBugs: openBugs ?? 0,
    supportRecent, supportOpen: supportOpen ?? 0,
    audit, auditByOp, topAuditTables,
    allTenants, newTenantsLast24h, tenantsByStatus,
    totalMembers, pendingInvites,
    sentrySection,
  })
  const html = `<pre style="font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(text)}</pre>`

  // ─── Send ───────────────────────────────────────────────────────────────
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      error: 'RESEND_API_KEY not set — digest computed but not sent',
      preview: text,
    }, { status: 200 })
  }
  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: FROM_EMAIL, to: RECIPIENT, subject, text, html,
    })
    if (error) {
      Sentry.captureException(error, { tags: { route: '/api/cron/daily-health-report', stage: 'resend' } })
      return NextResponse.json({ ok: false, error: error.message }, { status: 502 })
    }
    return NextResponse.json({ ok: true, sent_to: RECIPIENT, summary: text.split('\n').slice(0, 8).join('\n') })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/daily-health-report', stage: 'send' } })
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'send threw' }, { status: 500 })
  }
}

interface RenderArgs {
  dayLabel:          string
  bugs:              Array<{ id: string; severity: string; title: string; reporter_email: string | null; created_at: string; emailed_ok: boolean | null }>
  bugsBySeverity:    Record<string, number>
  openBugs:          number
  supportRecent:     DigestTicket[]
  supportOpen:       number
  audit:             unknown[]
  auditByOp:         Record<string, number>
  topAuditTables:    Array<[string, number]>
  allTenants:        Array<{ tenant_number: string; name: string; status: string; is_demo: boolean }>
  newTenantsLast24h: Array<{ tenant_number: string; name: string }>
  tenantsByStatus:   Record<string, number>
  totalMembers:      number
  pendingInvites:    number
  sentrySection:     string
}

function renderText(a: RenderArgs): string {
  const lines: string[] = []
  lines.push(`Soteria FIELD — Daily Health Report`)
  lines.push(`============================================`)
  lines.push(`Date: ${a.dayLabel}`)
  lines.push('')

  // Bug reports
  lines.push(`▶ BUG REPORTS (last 24h: ${a.bugs.length} · open all-time: ${a.openBugs})`)
  if (a.bugs.length === 0) {
    lines.push(`  none — quiet day ✅`)
  } else {
    lines.push(`  by severity: critical=${a.bugsBySeverity.critical} high=${a.bugsBySeverity.high} medium=${a.bugsBySeverity.medium} low=${a.bugsBySeverity.low}`)
    for (const b of a.bugs.slice(0, 10)) {
      const tag = `[${b.severity.toUpperCase()}]`
      const reporter = b.reporter_email ?? '(unknown)'
      const flag = b.emailed_ok === false ? ' (email failed!)' : ''
      lines.push(`  ${tag} ${b.title} — ${reporter}${flag}`)
    }
  }
  lines.push('')

  // AI support tickets
  for (const line of renderSupportTicketSection({
    recent:    a.supportRecent,
    openCount: a.supportOpen,
  })) lines.push(line)
  lines.push('')

  // Sentry
  lines.push(`▶ SENTRY — top unresolved issues (last 24h)`)
  for (const line of a.sentrySection.split('\n')) lines.push(`  ${line}`)
  lines.push('')

  // Tenants
  lines.push(`▶ TENANTS`)
  lines.push(`  total: ${a.allTenants.length}  ·  active: ${a.tenantsByStatus.active}  ·  trial: ${a.tenantsByStatus.trial}  ·  disabled: ${a.tenantsByStatus.disabled}  ·  archived: ${a.tenantsByStatus.archived}`)
  if (a.newTenantsLast24h.length > 0) {
    lines.push(`  new in last 24h:`)
    for (const t of a.newTenantsLast24h) lines.push(`    #${t.tenant_number}  ${t.name}`)
  } else {
    lines.push(`  no new tenants in the last 24h`)
  }
  lines.push('')

  // Members
  lines.push(`▶ MEMBERS`)
  lines.push(`  total members across all tenants: ${a.totalMembers}`)
  lines.push(`  pending invites (never signed in): ${a.pendingInvites}`)
  lines.push('')

  // Audit
  lines.push(`▶ AUDIT LOG (last 24h: ${a.audit.length} rows)`)
  if (Object.keys(a.auditByOp).length > 0) {
    const ops = Object.entries(a.auditByOp).sort(([, x], [, y]) => y - x)
      .map(([op, n]) => `${op}=${n}`).join('  ')
    lines.push(`  by op: ${ops}`)
  }
  if (a.topAuditTables.length > 0) {
    lines.push(`  top tables:`)
    for (const [t, n] of a.topAuditTables) lines.push(`    ${t}: ${n}`)
  }
  lines.push('')
  lines.push(`---`)
  lines.push(`Generated by /api/cron/daily-health-report`)
  return lines.join('\n')
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
