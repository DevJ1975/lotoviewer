import type Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Support-chat data-fetch tools. Read-only, RLS-scoped to the
// caller's tenant via service-role + an explicit .eq('tenant_id', X)
// filter. Tool input is NEVER trusted for tenant scoping — the only
// source of truth is gate.tenantId resolved by the route's auth.
//
// Tool design rules:
//   - Read-only. No writes from chat.
//   - Bounded result size (limit hard-capped). The model has a budget
//     per turn; an unbounded list blows the context.
//   - Module-aware. Tools are filtered out of the array we pass to
//     the model when the tenant doesn't have the relevant module
//     enabled, so the model can't propose a tool the user won't see.

interface GateContext {
  tenantId: string | null
  userId:   string
  modules:  Record<string, boolean>
}

const FETCH_NEAR_MISSES_TOOL: Anthropic.Tool = {
  name: 'fetch_recent_near_misses',
  description:
    'Look up recent near-miss reports for the current tenant. Use when the user asks ' +
    'something like "show me near-misses from last week" or "what slip/trip incidents have we had?". ' +
    'Returns up to 20 rows ordered newest first.',
  input_schema: {
    type: 'object',
    properties: {
      hazard_category: {
        type: 'string',
        enum: ['physical', 'chemical', 'biological', 'mechanical', 'electrical', 'ergonomic', 'psychosocial', 'environmental', 'radiological'],
        description: 'Optional hazard taxonomy filter. Omit to include all categories.',
      },
      days: {
        type:        'integer',
        description: 'Lookback window in days. Default 30, max 90.',
        minimum:     1,
        maximum:     90,
      },
      limit: {
        type:        'integer',
        description: 'Max rows to return. Default 10, max 20.',
        minimum:     1,
        maximum:     20,
      },
    },
  },
}

const FETCH_TRAINING_EXPIRY_TOOL: Anthropic.Tool = {
  name: 'fetch_training_expiry_cohort',
  description:
    'List workers in the tenant whose training records expire within a window. Use when ' +
    'the user asks "who needs recertification soon?" or "show me workers expiring this month". ' +
    'Returns up to 50 (worker, role, expires_at) tuples sorted by soonest expiry.',
  input_schema: {
    type: 'object',
    properties: {
      within_days: {
        type:        'integer',
        description: 'Window in days from today. Default 30, max 365.',
        minimum:     1,
        maximum:     365,
      },
    },
    required: ['within_days'],
  },
}

const FETCH_PERMITS_TOOL: Anthropic.Tool = {
  name: 'fetch_my_recent_permits',
  description:
    'Recent permits across confined-space and hot-work tables for the current tenant. ' +
    'Use when the user asks "show me last week\'s permits" or "what hot work was authorized today?".',
  input_schema: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['confined-space', 'hot-work'],
        description: 'Optional filter to a single permit type. Omit to include both.',
      },
      days: {
        type:        'integer',
        description: 'Lookback window in days. Default 7, max 90.',
        minimum:     1,
        maximum:     90,
      },
      limit: {
        type:        'integer',
        description: 'Max rows to return. Default 15, max 30.',
        minimum:     1,
        maximum:     30,
      },
    },
  },
}

export const DATA_FETCH_TOOLS = [
  FETCH_NEAR_MISSES_TOOL,
  FETCH_TRAINING_EXPIRY_TOOL,
  FETCH_PERMITS_TOOL,
] as const

/**
 * Filter the tool list to those whose backing module is enabled for
 * the tenant. Returning tools the user can't actually see leads the
 * model to confidently quote data the UI doesn't display anywhere
 * else, which confuses the human review step.
 */
export function visibleDataFetchTools(modules: Record<string, boolean>): Anthropic.Tool[] {
  const out: Anthropic.Tool[] = []
  if (modules['near-miss']) out.push(FETCH_NEAR_MISSES_TOOL)
  // Training records sit in the LOTO module's universe; gate
  // accordingly. The drawer doesn't have a standalone training entry.
  if (modules['lockout-tagout'] || modules['admin-training']) out.push(FETCH_TRAINING_EXPIRY_TOOL)
  if (modules['confined-spaces'] || modules['hot-work-permits']) out.push(FETCH_PERMITS_TOOL)
  return out
}

// ─── Tool execution ──────────────────────────────────────────────────

interface NearMissOut {
  id:                 string
  occurred_at:        string
  hazard_category:    string
  severity_potential: string
  status:             string
  description_excerpt: string
}

interface TrainingExpiryOut {
  worker_name: string
  employee_id: string | null
  role:        string
  expires_at:  string
  days_until:  number
}

interface PermitOut {
  type:           'confined-space' | 'hot-work'
  permit_number:  string | null
  description:    string | null
  status:         string | null
  authorized_at:  string | null
  canceled_at:    string | null
}

export interface ToolResult {
  tool:   string
  ok:     boolean
  data?:  unknown
  error?: string
}

export async function executeTool(
  name: string,
  input: unknown,
  gate: GateContext,
): Promise<ToolResult> {
  if (!gate.tenantId) {
    return { tool: name, ok: false, error: 'No active tenant; data tools unavailable.' }
  }
  const admin = supabaseAdmin()
  const inObj = (input ?? {}) as Record<string, unknown>

  switch (name) {
    case 'fetch_recent_near_misses': {
      const days     = clampInt(inObj.days,     30, 1, 90)
      const limit    = clampInt(inObj.limit,    10, 1, 20)
      const category = typeof inObj.hazard_category === 'string' ? inObj.hazard_category : null
      const since    = new Date(Date.now() - days * 86_400_000).toISOString()

      let q = admin
        .from('near_misses')
        .select('id, occurred_at, hazard_category, severity_potential, status, description')
        .eq('tenant_id', gate.tenantId)
        .gte('occurred_at', since)
        .order('occurred_at', { ascending: false })
        .limit(limit)
      if (category) q = q.eq('hazard_category', category)

      const { data, error } = await q
      if (error) return { tool: name, ok: false, error: error.message }
      const rows = (data ?? []) as Array<{
        id: string; occurred_at: string; hazard_category: string;
        severity_potential: string; status: string; description: string
      }>
      const out: NearMissOut[] = rows.map(r => ({
        id:                 r.id,
        occurred_at:        r.occurred_at,
        hazard_category:    r.hazard_category,
        severity_potential: r.severity_potential,
        status:             r.status,
        description_excerpt: (r.description ?? '').slice(0, 280),
      }))
      return { tool: name, ok: true, data: { rows: out, count: out.length, window_days: days } }
    }

    case 'fetch_training_expiry_cohort': {
      const within = clampInt(inObj.within_days, 30, 1, 365)
      const cutoff = new Date(Date.now() + within * 86_400_000).toISOString()
      const today  = new Date().toISOString()

      const { data, error } = await admin
        .from('loto_training_records')
        .select('role, expires_at, worker_id, loto_workers ( full_name, employee_id )')
        .eq('tenant_id', gate.tenantId)
        .not('expires_at', 'is', null)
        .gte('expires_at', today)
        .lte('expires_at', cutoff)
        .order('expires_at', { ascending: true })
        .limit(50)
      if (error) return { tool: name, ok: false, error: error.message }
      // PostgREST joins return arrays for inferred FK relationships
      // even when the FK is many-to-one. Coerce loto_workers to an
      // optional single row.
      const rows = (data ?? []) as unknown as Array<{
        role:         string
        expires_at:   string
        loto_workers: { full_name: string; employee_id: string | null } | Array<{ full_name: string; employee_id: string | null }> | null
      }>
      const out: TrainingExpiryOut[] = []
      for (const r of rows) {
        const worker = Array.isArray(r.loto_workers) ? r.loto_workers[0] : r.loto_workers
        if (!worker) continue
        const exp = new Date(r.expires_at).getTime()
        out.push({
          worker_name: worker.full_name,
          employee_id: worker.employee_id,
          role:        r.role,
          expires_at:  r.expires_at,
          days_until:  Math.max(0, Math.round((exp - Date.now()) / 86_400_000)),
        })
      }
      return { tool: name, ok: true, data: { rows: out, count: out.length, within_days: within } }
    }

    case 'fetch_my_recent_permits': {
      const days  = clampInt(inObj.days,  7,  1, 90)
      const limit = clampInt(inObj.limit, 15, 1, 30)
      const type  = typeof inObj.type === 'string' ? inObj.type : null
      const since = new Date(Date.now() - days * 86_400_000).toISOString()

      const out: PermitOut[] = []

      if (type !== 'hot-work') {
        const { data: csData, error: csErr } = await admin
          .from('loto_confined_space_permits')
          .select('permit_number, description, status, authorized_at, canceled_at, created_at')
          .eq('tenant_id', gate.tenantId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (csErr) return { tool: name, ok: false, error: csErr.message }
        for (const r of (csData ?? []) as Array<Record<string, unknown>>) {
          out.push({
            type:          'confined-space',
            permit_number: (r.permit_number  ?? null) as string | null,
            description:   (r.description    ?? null) as string | null,
            status:        (r.status         ?? null) as string | null,
            authorized_at: (r.authorized_at  ?? null) as string | null,
            canceled_at:   (r.canceled_at    ?? null) as string | null,
          })
        }
      }
      if (type !== 'confined-space') {
        const { data: hwData, error: hwErr } = await admin
          .from('loto_hot_work_permits')
          .select('permit_number, description, status, authorized_at, canceled_at, created_at')
          .eq('tenant_id', gate.tenantId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(limit)
        if (hwErr) return { tool: name, ok: false, error: hwErr.message }
        for (const r of (hwData ?? []) as Array<Record<string, unknown>>) {
          out.push({
            type:          'hot-work',
            permit_number: (r.permit_number  ?? null) as string | null,
            description:   (r.description    ?? null) as string | null,
            status:        (r.status         ?? null) as string | null,
            authorized_at: (r.authorized_at  ?? null) as string | null,
            canceled_at:   (r.canceled_at    ?? null) as string | null,
          })
        }
      }
      return { tool: name, ok: true, data: { rows: out.slice(0, limit), count: Math.min(out.length, limit), window_days: days } }
    }
  }

  return { tool: name, ok: false, error: `Unknown tool: ${name}` }
}

export function isDataFetchTool(name: string): boolean {
  return name === 'fetch_recent_near_misses'
      || name === 'fetch_training_expiry_cohort'
      || name === 'fetch_my_recent_permits'
}

function clampInt(v: unknown, defaultVal: number, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return defaultVal
  return Math.min(Math.max(Math.floor(n), min), max)
}
