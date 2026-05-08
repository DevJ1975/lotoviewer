import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

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

// ── Registry ─────────────────────────────────────────────────────────────

export const ASSISTANT_TOOLS: Record<string, ToolDef> = {
  lookup_equipment,
  list_departments,
  recent_incidents,
  find_chemical,
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
