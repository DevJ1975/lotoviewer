import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { FEATURES } from '@soteria/core'
import { trir as trirRate, dart as dartRate } from '@soteria/core/incidentScorecardMetrics'

// Tool registry for the home-page assistant.
//
// Each tool has:
//   - definition (Anthropic.Tool) — passed to messages.create
//   - handler — async function that runs server-side when the model
//     calls the tool. Receives the parsed input + an execution context
//     (tenant id, user id, role) and returns a string the model sees
//     in the next turn's tool_result.
//
// Role gating: tools that mutate or send (send_alert, schedule_followup,
// open_support_ticket) are gated by role. The handler returns a polite
// refusal string if the user lacks permission — the model will then
// pass that through to the user. We don't 403 the whole request because
// the model may be running other tool calls in the same turn.
//
// PR1 ships: lookup tools (read-only) + open_support_ticket (proxies to
// existing support_tickets table) + send_alert and schedule_followup as
// stubs that store intent in assistant_tasks for PR3's executor to run.

export type UserRole = 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'

export interface ToolContext {
  tenantId:       string
  userId:         string
  role:           UserRole
  conversationId: string
}

interface ToolDef {
  definition: Anthropic.Tool
  /** Returns a string the model will see as tool_result. */
  handler:    (input: unknown, ctx: ToolContext) => Promise<string>
}

// ── Helpers ──────────────────────────────────────────────────────────────

function isAdmin(role: UserRole): boolean {
  return role === 'admin' || role === 'owner' || role === 'superadmin'
}

function refuse(reason: string): string {
  return JSON.stringify({ ok: false, refusal: reason })
}

function ok<T>(data: T): string {
  return JSON.stringify({ ok: true, data })
}

function fail(message: string): string {
  return JSON.stringify({ ok: false, error: message })
}

// ── Tool: lookup_equipment ───────────────────────────────────────────────

const lookup_equipment: ToolDef = {
  definition: {
    name: 'lookup_equipment',
    description:
      'Find an equipment record in the active tenant by its equipment_id (the human-readable identifier printed on placards, e.g. "MIX-04"). Returns the equipment row including department, description, and any internal notes. Use this whenever the user mentions a specific equipment by id.',
    input_schema: {
      type: 'object',
      properties: {
        equipment_id: { type: 'string', description: 'The equipment_id printed on the placard (case-insensitive).' },
      },
      required: ['equipment_id'],
    },
  },
  async handler(input, ctx) {
    const { equipment_id } = input as { equipment_id?: string }
    if (!equipment_id) return fail('equipment_id is required')
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('loto_equipment')
      .select('id, equipment_id, description, department, internal_notes, status')
      .eq('tenant_id', ctx.tenantId)
      .ilike('equipment_id', equipment_id)
      .limit(1)
      .maybeSingle()
    if (error) return fail(error.message)
    if (!data) return ok(null)
    return ok(data)
  },
}

// ── Tool: list_departments ───────────────────────────────────────────────

const list_departments: ToolDef = {
  definition: {
    name: 'list_departments',
    description:
      'List the distinct departments that have equipment in the active tenant. Returns each department with the count of equipment items. Use this when the user asks "what departments are there" or wants to navigate by department.',
    input_schema: { type: 'object', properties: {} },
  },
  async handler(_input, ctx) {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('loto_equipment')
      .select('department')
      .eq('tenant_id', ctx.tenantId)
    if (error) return fail(error.message)
    const counts = new Map<string, number>()
    for (const row of (data ?? [])) {
      const d = (row as { department: string | null }).department
      if (!d) continue
      counts.set(d, (counts.get(d) ?? 0) + 1)
    }
    const list = [...counts.entries()].map(([dept, count]) => ({ dept, count }))
    list.sort((a, b) => a.dept.localeCompare(b.dept))
    return ok(list)
  },
}

// ── Tool: recent_incidents ───────────────────────────────────────────────

const recent_incidents: ToolDef = {
  definition: {
    name: 'recent_incidents',
    description:
      'List the most recent incident reports for the active tenant. Use this when the user asks about recent injuries, near-misses, spills, or property damage events.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'How many to return (default 5).' },
      },
    },
  },
  async handler(input, ctx) {
    const { limit } = (input ?? {}) as { limit?: number }
    const cap = Math.min(Math.max(1, limit ?? 5), 25)
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('incidents')
      .select('id, occurred_at, kind, severity, summary, department, status')
      .eq('tenant_id', ctx.tenantId)
      .order('occurred_at', { ascending: false })
      .limit(cap)
    if (error) return fail(error.message)
    return ok(data ?? [])
  },
}

// ── Tool: find_chemical ──────────────────────────────────────────────────

const find_chemical: ToolDef = {
  definition: {
    name: 'find_chemical',
    description:
      'Search the chemical inventory in the active tenant by name (case-insensitive substring match). Returns the top 5 matches with their CAS number when known and any GHS hazard codes on file. Use when the user asks about a specific chemical, SDS, or compatibility.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring of the chemical product name.' },
      },
      required: ['query'],
    },
  },
  async handler(input, ctx) {
    const { query } = input as { query?: string }
    if (!query) return fail('query is required')
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_products')
      .select('id, name, cas_number, ghs_hazard_codes, department')
      .eq('tenant_id', ctx.tenantId)
      .ilike('name', `%${query}%`)
      .limit(5)
    if (error) return fail(error.message)
    return ok(data ?? [])
  },
}

// ── Tool: open_support_ticket ────────────────────────────────────────────

const open_support_ticket: ToolDef = {
  definition: {
    name: 'open_support_ticket',
    description:
      'Open a human support ticket. Call this when (a) the user explicitly asks to talk to a person, (b) you do not have a confident answer, or (c) the question is safety- or compliance-critical and requires a qualified person to decide. The support team follows up by email.',
    input_schema: {
      type: 'object',
      properties: {
        subject: { type: 'string', description: 'Short ticket subject (under 100 chars).' },
        summary: { type: 'string', description: 'What the user is trying to do, what they tried, and where they are stuck.' },
        reason:  {
          type: 'string',
          enum: ['user_requested','low_confidence','safety_critical'],
          description: 'Why you are escalating.',
        },
      },
      required: ['subject','summary','reason'],
    },
  },
  async handler(input, ctx) {
    const i = (input ?? {}) as { subject?: string; summary?: string; reason?: string }
    if (!i.subject || !i.summary || !i.reason) return fail('subject, summary, and reason are required')
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('support_tickets')
      .insert({
        conversation_id: null,    // assistant tickets aren't tied to a support_conversations row
        user_id:         ctx.userId,
        tenant_id:       ctx.tenantId,
        subject:         i.subject.trim().slice(0, 200),
        summary:         i.summary.trim().slice(0, 4000),
        reason:          i.reason,
        emailed_ok:      null,
      })
      .select('id')
      .maybeSingle()
    if (error || !data) return fail(error?.message ?? 'ticket insert failed')
    return ok({ ticket_id: data.id, note: 'The support team will follow up by email.' })
  },
}

// ── Tool: send_alert (admin-only) ────────────────────────────────────────

const send_alert: ToolDef = {
  definition: {
    name: 'send_alert',
    description:
      'Send an alert to a group of users in the tenant. Admin-only. Channels: web-push (mobile), email, in-app. Use for urgent operational notifications such as "Pump P-101 is locked out — do not energize" or "Spill at Line 3, evacuate to Muster Point B".',
    input_schema: {
      type: 'object',
      properties: {
        audience: {
          type: 'string',
          enum: ['all','admins','department'],
          description: 'Who to alert. department requires departmentName.',
        },
        departmentName: { type: 'string', description: 'Required when audience=department.' },
        message:        { type: 'string', description: 'The alert body. Plain text, under 1000 chars.' },
        channels: {
          type: 'array',
          items: { type: 'string', enum: ['web-push','email','in-app'] },
          description: 'Delivery channels.',
        },
      },
      required: ['audience','message','channels'],
    },
  },
  async handler(input, ctx) {
    if (!isAdmin(ctx.role)) {
      return refuse('Only tenant admins or owners can send alerts. Ask your site admin to send it from their account.')
    }
    const i = (input ?? {}) as { audience?: string; departmentName?: string; message?: string; channels?: string[] }
    if (!i.audience || !i.message || !i.channels?.length) return fail('audience, message, and at least one channel are required')
    if (i.audience === 'department' && !i.departmentName) return fail('departmentName is required when audience=department')

    // PR1 stub: store intent in assistant_tasks. PR3's cron picks pending
    // rows and dispatches via web-push + Resend + in-app.
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('assistant_tasks')
      .insert({
        tenant_id:       ctx.tenantId,
        user_id:         ctx.userId,
        conversation_id: ctx.conversationId,
        kind:            'alert',
        payload:         {
          audience:       i.audience,
          departmentName: i.departmentName ?? null,
          message:        i.message.slice(0, 1000),
          channels:       i.channels,
        },
        run_at:          new Date().toISOString(),  // dispatch immediately when cron picks up
        status:          'pending',
      })
      .select('id')
      .maybeSingle()
    if (error || !data) return fail(error?.message ?? 'alert insert failed')
    return ok({
      task_id: data.id,
      note:    'Alert queued. Delivery runs on the next cron tick (within 5 minutes). The assistant_tasks executor lands in PR3.',
    })
  },
}

// ── Tool: schedule_followup (admin-only) ─────────────────────────────────

const schedule_followup: ToolDef = {
  definition: {
    name: 'schedule_followup',
    description:
      'Schedule a future reminder or follow-up message. Admin-only. Use for "remind the maintenance team in 48 hours to verify the lockout was removed" or "ping me next week if this incident hasn\'t been signed off".',
    input_schema: {
      type: 'object',
      properties: {
        run_at_iso: { type: 'string', description: 'When to fire, ISO 8601 with timezone, e.g. 2025-12-15T14:00:00-05:00.' },
        message:    { type: 'string', description: 'The reminder body.' },
        audience: {
          type: 'string',
          enum: ['self','admins','department'],
          description: 'Who to notify. self = the requesting user only.',
        },
        departmentName: { type: 'string', description: 'Required when audience=department.' },
      },
      required: ['run_at_iso','message','audience'],
    },
  },
  async handler(input, ctx) {
    if (!isAdmin(ctx.role)) {
      return refuse('Only tenant admins or owners can schedule follow-ups. Ask your site admin.')
    }
    const i = (input ?? {}) as { run_at_iso?: string; message?: string; audience?: string; departmentName?: string }
    if (!i.run_at_iso || !i.message || !i.audience) return fail('run_at_iso, message, and audience are required')
    const runAt = new Date(i.run_at_iso)
    if (Number.isNaN(runAt.getTime())) return fail('run_at_iso is not a valid date')
    if (runAt.getTime() < Date.now() - 60_000) return fail('run_at_iso must be in the future')

    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('assistant_tasks')
      .insert({
        tenant_id:       ctx.tenantId,
        user_id:         ctx.userId,
        conversation_id: ctx.conversationId,
        kind:            'followup',
        payload:         {
          audience:       i.audience,
          departmentName: i.departmentName ?? null,
          message:        i.message.slice(0, 1000),
        },
        run_at:          runAt.toISOString(),
        status:          'pending',
      })
      .select('id, run_at')
      .maybeSingle()
    if (error || !data) return fail(error?.message ?? 'follow-up insert failed')
    return ok({ task_id: data.id, run_at: data.run_at })
  },
}

// ── Read-only module-coverage tools ──────────────────────────────────────
// One focused tool per data area so the assistant can reach every module.
// Same posture as the lookups above: supabaseAdmin() + explicit tenant
// filter, compact JSON result, no mutations.

const DAY_MS = 86_400_000
const todayYmd = () => new Date().toISOString().slice(0, 10)
const ymdFromNow = (days: number) => new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10)

const list_risks: ToolDef = {
  definition: {
    name: 'list_risks',
    description:
      'List entries from the tenant risk register, highest residual risk first. Use for "what are our top risks", "which risks are overdue for review", or any risk-assessment question. Optionally filter by residual band or to only overdue reviews.',
    input_schema: {
      type: 'object',
      properties: {
        band: { type: 'string', enum: ['low', 'moderate', 'high', 'extreme'], description: 'Filter to a residual risk band.' },
        overdue_reviews_only: { type: 'boolean', description: 'Only risks whose next_review_date has passed.' },
        limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 10.' },
      },
    },
  },
  async handler(input, ctx) {
    const i = (input ?? {}) as { band?: string; overdue_reviews_only?: boolean; limit?: number }
    const cap = Math.min(Math.max(1, i.limit ?? 10), 25)
    const admin = supabaseAdmin()
    let q = admin.from('risks')
      .select('risk_number, title, hazard_category, residual_band, residual_score, status, next_review_date')
      .eq('tenant_id', ctx.tenantId)
      .order('residual_score', { ascending: false, nullsFirst: false })
      .limit(cap)
    if (i.band) q = q.eq('residual_band', i.band)
    if (i.overdue_reviews_only) q = q.lt('next_review_date', todayYmd())
    const { data, error } = await q
    if (error) return fail(error.message)
    return ok(data ?? [])
  },
}

const list_jhas: ToolDef = {
  definition: {
    name: 'list_jhas',
    description:
      'List Job Hazard Analyses (JHAs) for the tenant, most recently updated first. Use for "what JHAs exist", "which JHAs are due for review", or task-level hazard questions.',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 10.' } } },
  },
  async handler(input, ctx) {
    const cap = Math.min(Math.max(1, ((input ?? {}) as { limit?: number }).limit ?? 10), 25)
    const admin = supabaseAdmin()
    const { data, error } = await admin.from('jhas')
      .select('job_number, title, status, location, next_review_date, last_reviewed_at')
      .eq('tenant_id', ctx.tenantId)
      .order('updated_at', { ascending: false })
      .limit(cap)
    if (error) return fail(error.message)
    return ok(data ?? [])
  },
}

const bbs_summary: ToolDef = {
  definition: {
    name: 'bbs_summary',
    description:
      'Summarize Behavior-Based Safety (BBS) observations over a recent window: counts of safe behaviors vs unsafe acts/conditions, the safe-to-unsafe ratio (a leading indicator — higher is better), and how many are still open. Use for "how is our BBS program", "safe-to-unsafe ratio".',
    input_schema: { type: 'object', properties: { window_days: { type: 'integer', minimum: 1, maximum: 365, description: 'Default 30.' } } },
  },
  async handler(input, ctx) {
    const win = Math.min(Math.max(1, ((input ?? {}) as { window_days?: number }).window_days ?? 30), 365)
    const since = new Date(Date.now() - win * DAY_MS).toISOString()
    const admin = supabaseAdmin()
    const { data, error } = await admin.from('bbs_observations')
      .select('kind, status, observed_at')
      .eq('tenant_id', ctx.tenantId)
      .gte('observed_at', since)
    if (error) return fail(error.message)
    const rows = (data ?? []) as { kind: string | null; status: string | null }[]
    let safe = 0, unsafe = 0, open = 0
    for (const r of rows) {
      if (r.kind === 'safe_behavior') safe++
      else if (r.kind === 'unsafe_act' || r.kind === 'unsafe_condition') unsafe++
      if (r.status && r.status !== 'closed' && r.status !== 'invalid') open++
    }
    return ok({
      window_days: win,
      total: rows.length,
      safe_behaviors: safe,
      unsafe_observations: unsafe,
      safe_to_unsafe_ratio: unsafe > 0 ? Math.round((safe / unsafe) * 100) / 100 : null,
      open,
    })
  },
}

const training_expiring: ToolDef = {
  definition: {
    name: 'training_expiring',
    description:
      'List worker training certifications that are expired or expiring soon (already-expired are always included). Use for "whose training is expiring", "expired certifications".',
    input_schema: {
      type: 'object',
      properties: {
        within_days: { type: 'integer', minimum: 1, maximum: 180, description: 'Expiring within N days. Default 30.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 25.' },
      },
    },
  },
  async handler(input, ctx) {
    const i = (input ?? {}) as { within_days?: number; limit?: number }
    const within = Math.min(Math.max(1, i.within_days ?? 30), 180)
    const cap = Math.min(Math.max(1, i.limit ?? 25), 50)
    const admin = supabaseAdmin()
    const { data, error } = await admin.from('loto_training_records')
      .select('worker_name, role, expires_at, cert_authority')
      .eq('tenant_id', ctx.tenantId)
      .not('expires_at', 'is', null)
      .lte('expires_at', ymdFromNow(within))
      .order('expires_at', { ascending: true })
      .limit(cap)
    if (error) return fail(error.message)
    return ok(data ?? [])
  },
}

const active_permits: ToolDef = {
  definition: {
    name: 'active_permits',
    description:
      'List currently active permits — confined-space entries and hot-work permits that are not canceled and not yet expired. Use for "what permits are open right now", "active confined space entries", "hot work in progress".',
    input_schema: { type: 'object', properties: {} },
  },
  async handler(_input, ctx) {
    const admin = supabaseAdmin()
    const nowIso = new Date().toISOString()
    const [cs, hw] = await Promise.all([
      admin.from('loto_confined_space_permits')
        .select('serial, purpose, started_at, expires_at')
        .eq('tenant_id', ctx.tenantId).is('canceled_at', null).gt('expires_at', nowIso)
        .order('expires_at', { ascending: true }).limit(25),
      admin.from('loto_hot_work_permits')
        .select('serial, work_location, work_description, started_at, expires_at')
        .eq('tenant_id', ctx.tenantId).is('canceled_at', null).gt('expires_at', nowIso)
        .order('expires_at', { ascending: true }).limit(25),
    ])
    if (cs.error) return fail(cs.error.message)
    if (hw.error) return fail(hw.error.message)
    return ok({ confined_space: cs.data ?? [], hot_work: hw.data ?? [] })
  },
}

const recent_inspections: ToolDef = {
  definition: {
    name: 'recent_inspections',
    description:
      'List recent inspections/audits with their score and pass/fail result. Use for "recent inspections", "failed audits", "inspection scores".',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 10.' } } },
  },
  async handler(input, ctx) {
    const cap = Math.min(Math.max(1, ((input ?? {}) as { limit?: number }).limit ?? 10), 25)
    const admin = supabaseAdmin()
    const { data, error } = await admin.from('inspections')
      .select('title, status, score, max_score, result, submitted_at, due_at')
      .eq('tenant_id', ctx.tenantId)
      .order('created_at', { ascending: false })
      .limit(cap)
    if (error) return fail(error.message)
    return ok(data ?? [])
  },
}

const compliance_obligations_due: ToolDef = {
  definition: {
    name: 'compliance_obligations_due',
    description:
      'List compliance-calendar obligations that are overdue or due soon (excludes snoozed and not-applicable items). Use for "what compliance deadlines are coming up", "overdue obligations", "regulatory due dates".',
    input_schema: {
      type: 'object',
      properties: {
        within_days: { type: 'integer', minimum: 1, maximum: 120, description: 'Due within N days. Default 45. Overdue always included.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 25.' },
      },
    },
  },
  async handler(input, ctx) {
    const i = (input ?? {}) as { within_days?: number; limit?: number }
    const within = Math.min(Math.max(1, i.within_days ?? 45), 120)
    const cap = Math.min(Math.max(1, i.limit ?? 25), 50)
    const nowIso = new Date().toISOString()
    const admin = supabaseAdmin()
    const { data, error } = await admin.from('compliance_obligations')
      .select('title, category, jurisdiction, frequency, next_due_date, responsible_party, last_completed_at, snoozed_until')
      .eq('tenant_id', ctx.tenantId)
      .eq('not_applicable', false)
      .not('next_due_date', 'is', null)
      .lte('next_due_date', ymdFromNow(within))
      .order('next_due_date', { ascending: true })
      .limit(cap)
    if (error) return fail(error.message)
    const rows = ((data ?? []) as { snoozed_until: string | null }[]).filter(r => !r.snoozed_until || r.snoozed_until < nowIso)
    return ok(rows)
  },
}

const near_misses_recent: ToolDef = {
  definition: {
    name: 'near_misses_recent',
    description:
      'List recent near-miss reports with their potential severity and status. Use for "recent near misses", "near-miss trend", "what almost went wrong".',
    input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 25, description: 'Default 10.' } } },
  },
  async handler(input, ctx) {
    const cap = Math.min(Math.max(1, ((input ?? {}) as { limit?: number }).limit ?? 10), 25)
    const admin = supabaseAdmin()
    const { data, error } = await admin.from('near_misses')
      .select('report_number, occurred_at, hazard_category, severity_potential, status, location')
      .eq('tenant_id', ctx.tenantId)
      .order('occurred_at', { ascending: false })
      .limit(cap)
    if (error) return fail(error.message)
    return ok(data ?? [])
  },
}

const scorecard_kpis: ToolDef = {
  definition: {
    name: 'scorecard_kpis',
    description:
      'Compute the tenant safety scorecard headline KPIs for the year to date: recordable count, TRIR, DART, near-miss count, and the near-miss-to-recordable ratio. Use for "what is our TRIR", "how are our safety numbers", or before discussing incident risk.',
    input_schema: { type: 'object', properties: {} },
  },
  async handler(_input, ctx) {
    const admin = supabaseAdmin()
    const now = new Date()
    const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1)
    const yearKey = String(now.getUTCFullYear())
    const nowMs = now.getTime()
    const inRange = (iso: string) => { const ms = new Date(iso).getTime(); return !Number.isNaN(ms) && ms >= yearStart && ms <= nowMs }
    const [incRes, classRes, estRes] = await Promise.all([
      admin.from('incidents').select('id, incident_type, occurred_at').eq('tenant_id', ctx.tenantId),
      admin.from('incident_classifications').select('incident_id, meets_recording_criteria, classification').eq('tenant_id', ctx.tenantId),
      admin.from('osha_establishments').select('hours_employees_by_year').eq('tenant_id', ctx.tenantId),
    ])
    if (incRes.error) return fail(incRes.error.message)
    if (classRes.error) return fail(classRes.error.message)
    if (estRes.error) return fail(estRes.error.message)
    type Inc = { id: string; incident_type: string; occurred_at: string }
    const incidents = (incRes.data ?? []) as Inc[]
    const classById = new Map<string, { meets_recording_criteria: boolean; classification: string | null }>()
    for (const c of (classRes.data ?? []) as { incident_id: string; meets_recording_criteria: boolean; classification: string | null }[]) classById.set(c.incident_id, c)
    const ytd = incidents.filter(r => inRange(r.occurred_at))
    const recordables = ytd.filter(r => classById.get(r.id)?.meets_recording_criteria === true)
    const deaths = recordables.filter(r => classById.get(r.id)?.classification === 'death').length
    const daysAway = recordables.filter(r => classById.get(r.id)?.classification === 'days_away').length
    const restricted = recordables.filter(r => classById.get(r.id)?.classification === 'restricted').length
    const nearMiss = ytd.filter(r => r.incident_type === 'near_miss').length
    let hours = 0
    for (const e of (estRes.data ?? []) as { hours_employees_by_year: Record<string, { hours?: number }> | null }[]) {
      const h = e.hours_employees_by_year?.[yearKey]?.hours
      if (typeof h === 'number') hours += h
    }
    const round2 = (n: number | null) => n === null ? null : Math.round(n * 100) / 100
    return ok({
      year: yearKey,
      recordables: recordables.length,
      near_miss: nearMiss,
      near_miss_to_recordable_ratio: recordables.length > 0 ? Math.round((nearMiss / recordables.length) * 100) / 100 : null,
      trir: round2(trirRate(recordables.length, hours)),
      dart: round2(dartRate(deaths, daysAway, restricted, hours)),
      hours_worked: hours,
    })
  },
}

const navigate_to: ToolDef = {
  definition: {
    name: 'navigate_to',
    description:
      'Resolve a module or page name to its in-app URL so you can give the user a direct link ("take me to X", "open the confined space board"). Returns the best matching feature with its href — always present the href to the user as a clickable markdown link.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'What the user wants to open, e.g. "confined space status", "risk register", "chemicals".' } },
      required: ['query'],
    },
  },
  async handler(input, _ctx) {
    const { query } = (input ?? {}) as { query?: string }
    if (!query) return fail('query is required')
    const q = query.toLowerCase().trim()
    const words = q.split(/\s+/).filter(Boolean)
    let best: { href: string; name: string } | null = null
    let bestScore = 0
    for (const f of FEATURES) {
      if (!f.enabled || f.comingSoon || typeof f.href !== 'string') continue
      const hay = `${f.name} ${f.id} ${f.description}`.toLowerCase()
      let score: number
      if (f.name.toLowerCase() === q) score = 100
      else if (hay.includes(q)) score = 60
      else score = words.filter(w => hay.includes(w)).length * 10
      if (score > bestScore) { bestScore = score; best = { href: f.href, name: f.name } }
    }
    if (!best || bestScore === 0) return ok(null)
    return ok(best)
  },
}

// ── Registry ─────────────────────────────────────────────────────────────

export const ASSISTANT_TOOLS: Record<string, ToolDef> = {
  lookup_equipment,
  list_departments,
  recent_incidents,
  find_chemical,
  list_risks,
  list_jhas,
  bbs_summary,
  training_expiring,
  active_permits,
  recent_inspections,
  compliance_obligations_due,
  near_misses_recent,
  scorecard_kpis,
  navigate_to,
  open_support_ticket,
  send_alert,
  schedule_followup,
}

export function getToolDefinitions(): Anthropic.Tool[] {
  return Object.values(ASSISTANT_TOOLS).map(t => t.definition)
}

export async function runTool(
  name: string,
  input: unknown,
  ctx:   ToolContext,
): Promise<string> {
  const tool = ASSISTANT_TOOLS[name]
  if (!tool) return fail(`Unknown tool: ${name}`)
  try {
    return await tool.handler(input, ctx)
  } catch (err) {
    return fail(err instanceof Error ? err.message : 'tool handler threw')
  }
}
