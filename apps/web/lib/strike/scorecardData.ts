import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComplianceAssignment, ComplianceMember } from '@soteria/core/strikeCompliance'
import {
  microlearningWindowStart,
  summarizeMicrolearning,
  type MicrolearningSummary,
} from '@soteria/core/strikeScorecard'

// Loads the EHS Scorecard's microlearning section for one tenant. Runs on the
// service-role client with an explicit tenant filter on every query: the
// scorecard and all three exports must count every worker, kiosk learners
// included, whatever the caller's own RLS view would show.

/** Rows asked for per request; the API may return fewer (its max_rows cap). */
const PAGE_SIZE = 1000
/** PostgREST's answer to a page that starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

/**
 * Every row a query matches, a page at a time, so a large tenant is never
 * silently cut off at the API's row cap. A short page doesn't prove the end
 * (the cap may be below PAGE_SIZE), so it reads until a page comes back empty.
 * `build` must return a fresh query with a stable order.
 */
async function fetchAll<T>(build: () => { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> }): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const { data, error } = await build().range(rows.length, rows.length + PAGE_SIZE - 1)
    if (error?.code === RANGE_NOT_SATISFIABLE) return rows
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    if (page.length === 0) return rows
    rows.push(...page)
  }
}

/** The tenant's microlearning summary, or null when STRIKE is turned off for it. */
export async function loadMicrolearningSummary(
  admin: SupabaseClient,
  tenantId: string,
  windowDays: number,
  now: Date = new Date(),
): Promise<MicrolearningSummary | null> {
  const { data: tenant, error: tenantErr } = await admin.from('tenants').select('modules').eq('id', tenantId).maybeSingle()
  if (tenantErr) throw new Error(tenantErr.message)
  if (!tenant || (tenant.modules as Record<string, boolean> | null)?.strike === false) return null

  const since = microlearningWindowStart(now, windowDays).toISOString()
  const [completions, attempts, practice, members, memberships, assignments, overrides] = await Promise.all([
    fetchAll<{ module_id: string; module_version_id: string; member_id: string | null; user_id: string | null; completed_at: string; expires_at: string | null; mode: string | null }>(() =>
      admin.from('strike_completions')
        .select('id,module_id,module_version_id,member_id,user_id,completed_at,expires_at,mode:evidence->>mode')
        .eq('tenant_id', tenantId).eq('passed', true).order('id')),
    fetchAll<{ module_id: string; member_id: string | null; user_id: string | null; submitted_at: string; passed: boolean | null; score_percent: number | null }>(() =>
      admin.from('strike_attempts')
        .select('id,module_id,member_id,user_id,submitted_at,passed,score_percent')
        .eq('tenant_id', tenantId).eq('delivery', 'standard').not('submitted_at', 'is', null).order('id')),
    fetchAll<{ correct: boolean | null; hints_used: number | string | null }>(() =>
      admin.from('strike_block_events')
        .select('id,correct:detail->correct,hints_used:detail->hints_used')
        .eq('tenant_id', tenantId).eq('event', 'interaction').gte('created_at', since).order('id')),
    fetchAll<{ id: string; display_name: string; profile_id: string | null; department: string | null; site_label: string | null }>(() =>
      admin.from('members').select('id,display_name,profile_id,department,site_label')
        .eq('tenant_id', tenantId).eq('status', 'active').order('id')),
    fetchAll<{ user_id: string; role: string }>(() =>
      admin.from('tenant_memberships').select('user_id,role').eq('tenant_id', tenantId).order('user_id')),
    fetchAll<{ id: string; module_id: string; target_type: string; target_id: string | null; starts_at: string | null; due_at: string | null }>(() =>
      admin.from('strike_assignments').select('id,module_id,target_type,target_id,starts_at,due_at')
        .eq('tenant_id', tenantId).eq('status', 'active').order('id')),
    fetchAll<{ member_ids: string[] | null }>(() =>
      admin.from('permit_training_overrides').select('id,member_ids')
        .eq('tenant_id', tenantId).gte('granted_at', since).order('id')),
  ])

  const moduleIds = [...new Set([
    ...completions.map(c => c.module_id),
    ...attempts.map(a => a.module_id),
    ...assignments.map(a => a.module_id),
  ])]
  const [modules, versions] = moduleIds.length === 0 ? [[], []] : await Promise.all([
    fetchAll<{ id: string; title: string }>(() =>
      admin.from('strike_modules').select('id,title').in('id', moduleIds).order('id')),
    fetchAll<{ id: string; module_id: string; locale: string; version_number: number; supersedes_completions: boolean }>(() =>
      admin.from('strike_module_versions').select('id,module_id,locale,version_number,supersedes_completions')
        .in('module_id', moduleIds).in('status', ['published', 'superseded']).order('id')),
  ])

  const roleByUser = new Map(memberships.map(m => [m.user_id, m.role]))
  const rosterMembers: ComplianceMember[] = members.map(m => ({
    id: m.id,
    displayName: m.display_name,
    profileId: m.profile_id,
    role: m.profile_id ? roleByUser.get(m.profile_id) ?? null : null,
    department: m.department,
    site: m.site_label,
  }))
  const activeAssignments: ComplianceAssignment[] = assignments.map(a => ({
    id: a.id, moduleId: a.module_id, targetType: a.target_type, targetId: a.target_id, startsAt: a.starts_at, dueAt: a.due_at,
  }))

  return summarizeMicrolearning({
    windowDays,
    now,
    modules,
    versions: versions.map(v => ({
      id: v.id, moduleId: v.module_id, locale: v.locale, versionNumber: v.version_number, supersedesCompletions: v.supersedes_completions,
    })),
    completions: completions.map(c => ({
      moduleId: c.module_id,
      moduleVersionId: c.module_version_id,
      memberId: c.member_id,
      userId: c.user_id,
      completedAt: c.completed_at,
      expiresAt: c.expires_at,
      assisted: c.mode === 'assisted_verified',
    })),
    attempts: attempts.map(a => ({
      moduleId: a.module_id,
      memberId: a.member_id,
      userId: a.user_id,
      submittedAt: a.submitted_at,
      passed: a.passed === true,
      scorePercent: a.score_percent,
    })),
    practice: practice.map(p => ({ correct: p.correct === true, hintsUsed: Number(p.hints_used) || 0 })),
    members: rosterMembers,
    assignments: activeAssignments,
    permitOverrideWorkers: overrides.reduce((sum, o) => sum + (o.member_ids?.length ?? 0), 0),
  })
}
