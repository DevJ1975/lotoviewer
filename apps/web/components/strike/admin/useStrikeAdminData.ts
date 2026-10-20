'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StrikeVersionLineage } from '@soteria/core/strike'
import { STRIKE_DEFAULT_LOCALE } from '@soteria/core/strikeLocale'
import type { ComplianceAssignment, ComplianceCompletion, ComplianceMember } from '@soteria/core/strikeCompliance'
import { supabase } from '@/lib/supabase'

export interface AdminModule {
  id: string
  title: string
  slug: string
  description: string | null
  category: string | null
  tags: string[]
  estimated_minutes: number
  library_scope: 'global' | 'tenant'
  latestVersionId: string | null
}

export interface AdminAssignment extends ComplianceAssignment {
  triggerKind: string
  recurrenceRule: unknown
  curriculumId: string | null
  reason: string | null
  status: string
}

export interface AdminRequirement {
  id: string
  module_id: string
  source_type: string
  source_id: string | null
  required_before_start: boolean
  expires_after_days: number | null
  active: boolean
  notes: string | null
}

export interface AdminCurriculum {
  id: string
  name: string
  description: string | null
  active: boolean
  items: { id: string; module_id: string; sort_order: number; release_offset_days: number; due_after_days: number }[]
}

export interface StrikeAdminData {
  modules: AdminModule[]
  members: ComplianceMember[]
  assignments: AdminAssignment[]
  requirements: AdminRequirement[]
  curricula: AdminCurriculum[]
  completions: ComplianceCompletion[]
  lineageByModule: Map<string, StrikeVersionLineage[]>
}

const EMPTY: StrikeAdminData = {
  modules: [], members: [], assignments: [], requirements: [], curricula: [], completions: [], lineageByModule: new Map(),
}

/** Everything the STRIKE admin console reads, loaded together and refreshed after every write. */
export function useStrikeAdminData(tenantId: string | null) {
  const [data, setData] = useState<StrikeAdminData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    try {
      const [modulesRes, membersRes, membershipsRes, assignmentsRes, requirementsRes, curriculaRes, itemsRes, completionsRes] = await Promise.all([
        supabase.from('strike_modules')
          .select('id,title,slug,description,category,tags,estimated_minutes,library_scope,tenant_id')
          .eq('status', 'published')
          .or(`library_scope.eq.global,tenant_id.eq.${tenantId}`)
          .order('title'),
        supabase.from('members').select('id,display_name,profile_id,department,site_label').eq('tenant_id', tenantId).eq('status', 'active').order('display_name').limit(5000),
        supabase.from('tenant_memberships').select('user_id,role').eq('tenant_id', tenantId),
        supabase.from('strike_assignments')
          .select('id,module_id,target_type,target_id,starts_at,due_at,trigger_kind,recurrence_rule,curriculum_id,reason,status')
          .eq('tenant_id', tenantId).neq('status', 'archived').order('due_at', { ascending: true, nullsFirst: false }),
        supabase.from('strike_training_requirements')
          .select('id,module_id,source_type,source_id,required_before_start,expires_after_days,active,notes')
          .eq('tenant_id', tenantId).order('created_at', { ascending: false }),
        supabase.from('strike_curricula').select('id,name,description,active').eq('tenant_id', tenantId).order('name'),
        supabase.from('strike_curriculum_items').select('id,curriculum_id,module_id,sort_order,release_offset_days,due_after_days').eq('tenant_id', tenantId),
        supabase.from('strike_completions')
          .select('module_id,module_version_id,member_id,user_id,completed_at,expires_at')
          .eq('tenant_id', tenantId).eq('passed', true).order('completed_at', { ascending: false }).limit(20000),
      ])
      const firstError = [modulesRes, membersRes, membershipsRes, assignmentsRes, requirementsRes, curriculaRes, itemsRes, completionsRes].find(r => r.error)?.error
      if (firstError) throw new Error(firstError.message)

      const moduleRows = modulesRes.data ?? []
      const { data: versions, error: versionErr } = moduleRows.length > 0
        ? await supabase.from('strike_module_versions')
          .select('id,module_id,version_number,status,supersedes_completions,locale')
          .in('module_id', moduleRows.map(m => m.id))
          .in('status', ['published', 'superseded'])
        : { data: [], error: null }
      if (versionErr) throw new Error(versionErr.message)

      const lineageByModule = new Map<string, StrikeVersionLineage[]>()
      const latestByModule = new Map<string, { id: string; n: number; isDefault: boolean }>()
      for (const v of versions ?? []) {
        const list = lineageByModule.get(v.module_id) ?? []
        list.push({ id: v.id, versionNumber: v.version_number, supersedesCompletions: v.supersedes_completions })
        lineageByModule.set(v.module_id, list)
        // Assignments bind to the default-language version when there is one;
        // translations of it satisfy them (lib/strike/attempts.ts
        // isAssignedVersionOrTranslation).
        if (v.status !== 'published') continue
        const latest = latestByModule.get(v.module_id)
        const isDefault = v.locale === STRIKE_DEFAULT_LOCALE
        if (!latest || (isDefault && !latest.isDefault) || (isDefault === latest.isDefault && v.version_number > latest.n)) {
          latestByModule.set(v.module_id, { id: v.id, n: v.version_number, isDefault })
        }
      }

      const roleByUser = new Map((membershipsRes.data ?? []).map(m => [m.user_id as string, m.role as string]))
      const itemsByCurriculum = new Map<string, AdminCurriculum['items']>()
      for (const item of itemsRes.data ?? []) {
        const list = itemsByCurriculum.get(item.curriculum_id) ?? []
        list.push(item)
        itemsByCurriculum.set(item.curriculum_id, list)
      }

      setData({
        modules: moduleRows.map(m => ({
          id: m.id, title: m.title, slug: m.slug, description: m.description, category: m.category,
          tags: m.tags ?? [], estimated_minutes: m.estimated_minutes, library_scope: m.library_scope,
          latestVersionId: latestByModule.get(m.id)?.id ?? null,
        })),
        members: (membersRes.data ?? []).map(m => ({
          id: m.id, displayName: m.display_name, profileId: m.profile_id,
          role: m.profile_id ? roleByUser.get(m.profile_id) ?? null : null,
          department: m.department, site: m.site_label,
        })),
        assignments: (assignmentsRes.data ?? []).map(a => ({
          id: a.id, moduleId: a.module_id, targetType: a.target_type, targetId: a.target_id,
          startsAt: a.starts_at, dueAt: a.due_at, triggerKind: a.trigger_kind, recurrenceRule: a.recurrence_rule,
          curriculumId: a.curriculum_id, reason: a.reason, status: a.status,
        })),
        requirements: (requirementsRes.data ?? []) as AdminRequirement[],
        curricula: (curriculaRes.data ?? []).map(c => ({
          ...c,
          items: (itemsByCurriculum.get(c.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
        })),
        completions: (completionsRes.data ?? []).map(c => ({
          moduleId: c.module_id, moduleVersionId: c.module_version_id, memberId: c.member_id,
          userId: c.user_id, completedAt: c.completed_at, expiresAt: c.expires_at,
        })),
        lineageByModule,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void reload() }, [reload])

  return { data, loading, error, reload }
}
