'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  GraduationCap,
  Link2,
  Loader2,
  PlayCircle,
  QrCode,
  RadioTower,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  computeStrikeReadiness,
  isStrikeAssignmentApplicable,
  isStrikeCompletionCurrent,
  STRIKE_ASSIGNMENT_TARGET_TYPES,
  STRIKE_REQUIREMENT_SOURCE_TYPES,
  type StrikeAssignmentTargetType,
  type StrikeLibraryScope,
  type StrikeReadinessStatus,
  type StrikeRequirementSourceType,
} from '@soteria/core/strike'

interface StrikeModuleRow {
  id: string
  tenant_id: string | null
  title: string
  slug: string
  description: string | null
  category: string | null
  tags: string[] | null
  estimated_minutes: number | null
  library_scope: StrikeLibraryScope
  published_at: string | null
}

interface StrikeVersionRow {
  id: string
  module_id: string
  version_number: number
  video_path: string | null
  thumbnail_path: string | null
  transcript: string | null
  duration_seconds: number | null
  passing_score: number
  published_at: string | null
}

interface StrikeCompletionRow {
  id: string
  module_id: string
  module_version_id: string
  completed_at: string
  expires_at: string | null
  score_percent: number | null
  passed: boolean
}

interface StrikeAssignmentRow {
  id: string
  module_id: string
  module_version_id: string | null
  target_type: StrikeAssignmentTargetType
  target_id: string | null
  due_at: string | null
  expires_at: string | null
  reason: string | null
  status: 'active' | 'paused' | 'archived'
}

interface StrikeRequirementRow {
  id: string
  module_id: string
  module_version_id: string | null
  source_type: StrikeRequirementSourceType
  source_id: string | null
  hazard_category: string | null
  required_before_start: boolean
  expires_after_days: number | null
  notes: string | null
  active: boolean
}

interface StrikeTaskCheckRow {
  id: string
  source_type: StrikeRequirementSourceType
  source_id: string | null
  user_id: string | null
  readiness_status: StrikeReadinessStatus
  required_count: number
  valid_completion_count: number
  checked_at: string
}

const SOURCE_TYPES = STRIKE_REQUIREMENT_SOURCE_TYPES
const TARGET_TYPES = STRIKE_ASSIGNMENT_TARGET_TYPES.filter(type =>
  type === 'tenant' || type === 'role' || type === 'user')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function StrikePage() {
  const { tenant, role } = useTenant()
  const { userId, profile } = useAuth()
  const tenantId = tenant?.id ?? null
  const isSuperadmin = profile?.is_superadmin === true
  const isTenantAdmin = role === 'admin' || role === 'owner'
  const canManageTenantTraining = isTenantAdmin || isSuperadmin

  const [modules, setModules] = useState<StrikeModuleRow[] | null>(null)
  const [versions, setVersions] = useState<StrikeVersionRow[]>([])
  const [completions, setCompletions] = useState<StrikeCompletionRow[]>([])
  const [assignments, setAssignments] = useState<StrikeAssignmentRow[]>([])
  const [requirements, setRequirements] = useState<StrikeRequirementRow[]>([])
  const [taskChecks, setTaskChecks] = useState<StrikeTaskCheckRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) {
      setModules([])
      setVersions([])
      setCompletions([])
      setAssignments([])
      setRequirements([])
      setTaskChecks([])
      return
    }
    setError(null)

    try {
      const { data: moduleRows, error: moduleErr } = await supabase
        .from('strike_modules')
        .select('id,tenant_id,title,slug,description,category,tags,estimated_minutes,library_scope,published_at')
        .eq('status', 'published')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(100)

      if (moduleErr) throw moduleErr
      const nextModules = (moduleRows ?? []) as StrikeModuleRow[]
      setModules(nextModules)

      const moduleIds = nextModules.map(m => m.id)
      if (moduleIds.length > 0) {
        const { data: versionRows, error: versionErr } = await supabase
          .from('strike_module_versions')
          .select('id,module_id,version_number,video_path,thumbnail_path,transcript,duration_seconds,passing_score,published_at')
          .in('module_id', moduleIds)
          .eq('status', 'published')
          .order('version_number', { ascending: false })
        if (versionErr) throw versionErr
        setVersions((versionRows ?? []) as StrikeVersionRow[])
      } else {
        setVersions([])
      }

      if (userId) {
        const { data: completionRows, error: completionErr } = await supabase
          .from('strike_completions')
          .select('id,module_id,module_version_id,completed_at,expires_at,score_percent,passed')
          .eq('user_id', userId)
          .eq('passed', true)
          .order('completed_at', { ascending: false })
          .limit(250)

        if (completionErr) throw completionErr
        setCompletions((completionRows ?? []) as StrikeCompletionRow[])
      } else {
        setCompletions([])
      }

      const [
        { data: assignmentRows, error: assignmentErr },
        { data: requirementRows, error: requirementErr },
        { data: checkRows, error: checkErr },
      ] = await Promise.all([
        supabase
          .from('strike_assignments')
          .select('id,module_id,module_version_id,target_type,target_id,due_at,expires_at,reason,status')
          .eq('tenant_id', tenantId)
          .eq('status', 'active')
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(100),
        supabase
          .from('strike_training_requirements')
          .select('id,module_id,module_version_id,source_type,source_id,hazard_category,required_before_start,expires_after_days,notes,active')
          .eq('tenant_id', tenantId)
          .eq('active', true)
          .order('created_at', { ascending: false })
          .limit(100),
        supabase
          .from('strike_task_checks')
          .select('id,source_type,source_id,user_id,readiness_status,required_count,valid_completion_count,checked_at')
          .eq('tenant_id', tenantId)
          .order('checked_at', { ascending: false })
          .limit(50),
      ])

      if (assignmentErr) throw assignmentErr
      if (requirementErr) throw requirementErr
      if (checkErr && canManageTenantTraining) throw checkErr

      setAssignments((assignmentRows ?? []) as StrikeAssignmentRow[])
      setRequirements((requirementRows ?? []) as StrikeRequirementRow[])
      setTaskChecks((checkRows ?? []) as StrikeTaskCheckRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setModules([])
    }
  }, [canManageTenantTraining, tenantId, userId])

  useEffect(() => { void load() }, [load])

  const latestVersionByModule = useMemo(() => {
    const map = new Map<string, StrikeVersionRow>()
    for (const version of versions) {
      const current = map.get(version.module_id)
      if (!current || version.version_number > current.version_number) map.set(version.module_id, version)
    }
    return map
  }, [versions])

  const currentCompletionByModule = useMemo(() => {
    const map = new Map<string, StrikeCompletionRow>()
    for (const row of completions) {
      const requiredVersionId = latestVersionByModule.get(row.module_id)?.id
      if (!isStrikeCompletionCurrent({
        completedAt: row.completed_at,
        expiresAt: row.expires_at,
        moduleVersionId: row.module_version_id,
        requiredVersionId,
      })) continue
      if (!map.has(row.module_id)) map.set(row.module_id, row)
    }
    return map
  }, [completions, latestVersionByModule])

  const activeAssignments = assignments.filter(a => a.status === 'active')
  const visibleAssignments = canManageTenantTraining
    ? activeAssignments
    : activeAssignments.filter(a => isStrikeAssignmentApplicable({
      targetType: a.target_type,
      targetId: a.target_id,
      userId,
      role,
    }))
  const assignedModuleIds = new Set(visibleAssignments.map(a => a.module_id))
  const assignedCompletions = visibleAssignments.filter(a => currentCompletionByModule.has(a.module_id)).length
  const readiness = computeStrikeReadiness({
    requiredCount: visibleAssignments.length,
    validCompletionCount: assignedCompletions,
  })
  const readinessRate = taskChecks.length > 0
    ? Math.round((taskChecks.filter(c => c.readiness_status === 'ready').length / taskChecks.length) * 100)
    : readiness.percent
  const overdueCount = visibleAssignments.filter(a => a.due_at && a.due_at < new Date().toISOString()).length
  const avgScore = completions.length > 0
    ? Math.round(completions.reduce((sum, c) => sum + (c.score_percent ?? 100), 0) / completions.length)
    : 0
  const failedAttempts = Math.max(0, visibleAssignments.length - assignedCompletions)
  const voluntaryCompletions = completions.filter(c => !assignedModuleIds.has(c.module_id)).length

  async function evaluateReadiness(sourceType: StrikeRequirementSourceType, sourceId: string) {
    if (!tenantId || !userId) return
    if (sourceId && !UUID_RE.test(sourceId)) {
      setError('Source ID must be a UUID.')
      return
    }
    const matching = requirements.filter(r =>
      r.source_type === sourceType && (!r.source_id || !sourceId || r.source_id === sourceId))
    const validCount = matching.filter(r => currentCompletionByModule.has(r.module_id)).length
    const result = computeStrikeReadiness({
      requiredCount: matching.length,
      validCompletionCount: validCount,
    })
    const { error: insertErr } = await supabase
      .from('strike_task_checks')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        source_type: sourceType,
        source_id: sourceId || null,
        readiness_status: result.status,
        required_count: matching.length,
        valid_completion_count: validCount,
        checked_by: userId,
        notes: 'Manual STRIKE readiness evaluation',
      })

    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setNotice(`Readiness recorded: ${result.status.replace(/_/g, ' ')} (${result.percent}%).`)
    await load()
  }

  const moduleCount = modules?.length ?? 0
  const tenantSpecificCount = modules?.filter(m => m.library_scope === 'tenant').length ?? 0

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">STRIKE</h1>
          <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            Microlearning, assignment tracking, and task readiness for high-risk work.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/strike/qr" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-navy/40 hover:text-brand-navy dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
            <QrCode className="h-4 w-4" />
            QR cards
          </Link>
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <ShieldCheck className="h-4 w-4" />
            Complete
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Published modules" value={moduleCount} icon={BookOpen} />
        <Metric label="Current completions" value={currentCompletionByModule.size} icon={CheckCircle2} />
        <Metric label="Readiness rate" value={`${readinessRate}%`} icon={ClipboardCheck} />
        <Metric label="Overdue assignments" value={overdueCount} icon={AlertTriangle} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Tenant modules" value={tenantSpecificCount} icon={Award} />
        <Metric label="Average score" value={avgScore ? `${avgScore}%` : '—'} icon={Target} />
        <Metric label="Voluntary completions" value={voluntaryCompletions} icon={Sparkles} />
      </section>

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {modules === null && !error && <LibrarySkeleton />}

      {modules && modules.length === 0 && (
        <section className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <GraduationCap className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">No STRIKE modules available yet</h2>
          <p className="mx-auto mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Published STRIKE courses appear here once the superadmin team releases them for this tenant.
          </p>
        </section>
      )}

      {modules && modules.length > 0 && (
        <section className={`grid gap-6 ${canManageTenantTraining ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : ''}`}>
          <div className="space-y-6">
            <LibrarySection
              modules={modules}
              latestVersionByModule={latestVersionByModule}
              currentCompletionByModule={currentCompletionByModule}
              assignments={visibleAssignments}
            />
            <ReadinessSection
              assignments={visibleAssignments}
              requirements={requirements}
              checks={taskChecks}
              modules={modules}
              readinessStatus={readiness.status}
              failedAttempts={failedAttempts}
              canEvaluate={canManageTenantTraining}
              onEvaluate={evaluateReadiness}
            />
          </div>

          {canManageTenantTraining && (
            <aside className="space-y-4">
              <AssignmentPanel modules={modules} latestVersionByModule={latestVersionByModule} tenantId={tenantId} userId={userId} onSaved={load} />
              <RequirementPanel modules={modules} latestVersionByModule={latestVersionByModule} tenantId={tenantId} userId={userId} onSaved={load} />
            </aside>
          )}
        </section>
      )}
    </div>
  )
}

type LibraryFilter = 'all' | 'todo' | 'completed'

// Highlight completions whose expiry falls within this window so a
// learner sees "renew soon" before it actually lapses. Kept loose because
// most STRIKE modules don't carry expiry data yet — when they do, the
// chip surfaces it automatically.
const EXPIRY_WARNING_DAYS = 30

function LibrarySection({
  modules,
  latestVersionByModule,
  currentCompletionByModule,
  assignments,
}: {
  modules: StrikeModuleRow[]
  latestVersionByModule: Map<string, StrikeVersionRow>
  currentCompletionByModule: Map<string, StrikeCompletionRow>
  assignments: StrikeAssignmentRow[]
}) {
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('all')
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map())

  // Fetch all thumbnail signed URLs in one round-trip. Signed URLs are
  // short-lived (1h) — well past any reasonable session — and we get
  // them in one call instead of N. Cards keep their default tile while
  // the URLs resolve so the grid never blocks on the network.
  useEffect(() => {
    const paths: string[] = []
    for (const row of modules) {
      const version = latestVersionByModule.get(row.id)
      if (version?.thumbnail_path) paths.push(version.thumbnail_path)
    }
    if (paths.length === 0) { setThumbnails(new Map()); return }
    let cancelled = false
    void (async () => {
      const { data } = await supabase.storage
        .from('strike-media')
        .createSignedUrls(paths, 60 * 60)
      if (cancelled || !data) return
      const next = new Map<string, string>()
      for (const entry of data) {
        if (entry.path && entry.signedUrl) next.set(entry.path, entry.signedUrl)
      }
      setThumbnails(next)
    })()
    return () => { cancelled = true }
  }, [modules, latestVersionByModule])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const row of modules) if (row.category) set.add(row.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [modules])

  // "Continue training" hero: incomplete assigned modules, soonest due
  // first. Falls back to silence when there are no assignments rather
  // than serving up filler — engagement comes from highlighting actual
  // pending work, not decorative content.
  const continueModules = useMemo(() => {
    const moduleById = new Map(modules.map(m => [m.id, m] as const))
    const dedupe = new Set<string>()
    const entries: { module: StrikeModuleRow; assignment: StrikeAssignmentRow }[] = []
    const sorted = assignments
      .slice()
      .sort((a, b) => (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999'))
    for (const assignment of sorted) {
      if (currentCompletionByModule.has(assignment.module_id)) continue
      if (dedupe.has(assignment.module_id)) continue
      const row = moduleById.get(assignment.module_id)
      if (!row) continue
      dedupe.add(assignment.module_id)
      entries.push({ module: row, assignment })
      if (entries.length >= 6) break
    }
    return entries
  }, [assignments, currentCompletionByModule, modules])

  // Pressing "/" anywhere on the page focuses search — a YouTube/GitHub-
  // style affordance for power users. Skips when the user is already
  // typing in another field so we never hijack their input.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const clearFilters = useCallback(() => {
    setQuery('')
    setCategory('all')
    setFilter('all')
  }, [])

  const hasActiveFilters = query.trim().length > 0 || category !== 'all' || filter !== 'all'

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return modules.filter(module => {
      if (category !== 'all' && module.category !== category) return false
      const completed = currentCompletionByModule.has(module.id)
      if (filter === 'todo' && completed) return false
      if (filter === 'completed' && !completed) return false
      if (!needle) return true
      const haystack = [
        module.title,
        module.description ?? '',
        module.category ?? '',
        ...(module.tags ?? []),
      ].join(' ').toLowerCase()
      return haystack.includes(needle)
    })
  }, [modules, query, category, filter, currentCompletionByModule])

  const counts = useMemo(() => {
    const completed = modules.filter(m => currentCompletionByModule.has(m.id)).length
    return { total: modules.length, completed, todo: modules.length - completed }
  }, [modules, currentCompletionByModule])

  return (
    <section>
      {continueModules.length > 0 && (
        <ContinueTrainingStrip
          entries={continueModules}
          latestVersionByModule={latestVersionByModule}
          thumbnails={thumbnails}
        />
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Training library
        </h2>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search modules…  (press / to focus)"
            aria-label="Search modules"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All <span className="ml-1 text-slate-400">{counts.total}</span>
        </FilterChip>
        <FilterChip active={filter === 'todo'} onClick={() => setFilter('todo')}>
          To do <span className="ml-1 text-slate-400">{counts.todo}</span>
        </FilterChip>
        <FilterChip active={filter === 'completed'} onClick={() => setFilter('completed')}>
          Completed <span className="ml-1 text-slate-400">{counts.completed}</span>
        </FilterChip>
        {categories.length > 0 && (
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            aria-label="Filter by category"
            className="ml-auto rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
          >
            <option value="all">All categories</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {filtered.length === modules.length
          ? `${filtered.length} module${filtered.length === 1 ? '' : 's'}`
          : `${filtered.length} of ${modules.length} module${modules.length === 1 ? '' : 's'} match filters`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center dark:border-slate-700">
          <Search className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
            No modules match the current filters.
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Try a broader search or check a different category.
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(module => {
            const version = latestVersionByModule.get(module.id)
            const completion = currentCompletionByModule.get(module.id)
            const thumbUrl = version?.thumbnail_path ? thumbnails.get(version.thumbnail_path) ?? null : null
            return (
              <LibraryCard
                key={module.id}
                module={module}
                version={version}
                completion={completion}
                thumbUrl={thumbUrl}
                onTagClick={tag => setQuery(tag)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function FilterChip({
  active, onClick, children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
        active
          ? 'bg-brand-navy text-white shadow-sm'
          : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-navy/30 hover:text-brand-navy dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
      }`}
    >
      {children}
    </button>
  )
}

interface LibraryCardProps {
  module: StrikeModuleRow
  version: StrikeVersionRow | undefined
  completion: StrikeCompletionRow | undefined
  thumbUrl: string | null
  onTagClick?: (tag: string) => void
}

const LibraryCard = memo(function LibraryCard({
  module,
  version,
  completion,
  thumbUrl,
  onTagClick,
}: LibraryCardProps) {
  const launchPath = `/strike/${module.slug}`
  const durationMinutes = version?.duration_seconds ? Math.ceil(version.duration_seconds / 60) : null
  const displayMinutes = durationMinutes ?? module.estimated_minutes ?? null
  const isCompleted = !!completion
  const isUnpublished = !version

  // Capture "now" once per mount so the days-until-expiry calculation is
  // pure across re-renders. Staleness over a long session doesn't matter
  // for a "renew in Nd" chip — the next route change refreshes it.
  const [nowMs] = useState(() => Date.now())
  const daysUntilExpiry = (() => {
    if (!completion?.expires_at) return null
    const ms = new Date(completion.expires_at).getTime() - nowMs
    if (!Number.isFinite(ms)) return null
    return Math.ceil(ms / (1000 * 60 * 60 * 24))
  })()
  const showExpiryWarning = daysUntilExpiry !== null && daysUntilExpiry <= EXPIRY_WARNING_DAYS

  return (
    <Link
      href={launchPath}
      aria-label={`Launch ${module.title}`}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-navy/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-navy/30 dark:border-slate-800 dark:bg-slate-950"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-400 dark:text-slate-600">
            <GraduationCap className="h-10 w-10" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white backdrop-blur-sm">
          {module.library_scope === 'global' ? 'Global' : 'Tenant'}
        </span>
        {isCompleted && !showExpiryWarning && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            <CheckCircle2 className="h-3 w-3" /> Complete
          </span>
        )}
        {showExpiryWarning && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-500/95 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            <AlertTriangle className="h-3 w-3" />
            {daysUntilExpiry! <= 0 ? 'Expired' : `Renew in ${daysUntilExpiry}d`}
          </span>
        )}
        {isUnpublished && !isCompleted && (
          <span className="absolute right-2 top-2 rounded-full bg-amber-500/95 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            Draft
          </span>
        )}
        <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-sm">
          <PlayCircle className="h-3 w-3" /> {isCompleted ? 'Revisit' : 'Launch'}
        </span>
        {displayMinutes !== null && (
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-sm">
            <Clock className="h-3 w-3" /> {displayMinutes} min
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          {module.title}
        </h3>
        {module.description && (
          <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{module.description}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          {module.category && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {module.category}
            </span>
          )}
          {(module.tags ?? []).slice(0, 2).map(tag => (
            <button
              key={tag}
              type="button"
              onClick={event => {
                // The whole card is a <Link>; stop the navigation and
                // hand the tag back so the parent can refine the search.
                event.preventDefault()
                event.stopPropagation()
                onTagClick?.(tag)
              }}
              className="rounded-full border border-slate-200 px-2 py-0.5 transition hover:border-brand-navy/40 hover:text-brand-navy dark:border-slate-700 dark:hover:text-brand-yellow"
            >
              #{tag}
            </button>
          ))}
        </div>

        {completion?.score_percent !== undefined && completion.score_percent !== null && (
          <p className="mt-3 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
            Last score: {completion.score_percent}%
          </p>
        )}
      </div>
    </Link>
  )
})

function LibrarySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
          >
            <div className="aspect-video w-full animate-pulse bg-slate-100 dark:bg-slate-900" />
            <div className="space-y-2 p-4">
              <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100 dark:bg-slate-900" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-slate-100 dark:bg-slate-900" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100 dark:bg-slate-900" />
            </div>
          </div>
        ))}
      </div>
      <p className="sr-only">Loading STRIKE modules…</p>
    </div>
  )
}

function ContinueTrainingStrip({
  entries,
  latestVersionByModule,
  thumbnails,
}: {
  entries: { module: StrikeModuleRow; assignment: StrikeAssignmentRow }[]
  latestVersionByModule: Map<string, StrikeVersionRow>
  thumbnails: Map<string, string>
}) {
  // Stable timestamp per mount keeps the due-day calculation pure across
  // re-renders. See LibraryCard for the same pattern.
  const [nowMs] = useState(() => Date.now())
  return (
    <section
      aria-labelledby="strike-continue-heading"
      className="mb-6 rounded-2xl border border-brand-navy/10 bg-gradient-to-br from-brand-navy/5 via-white to-brand-navy/5 p-4 shadow-sm dark:border-brand-yellow/15 dark:from-slate-900 dark:via-slate-950 dark:to-slate-900"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
          <h2
            id="strike-continue-heading"
            className="text-sm font-semibold uppercase tracking-wide text-brand-navy dark:text-brand-yellow"
          >
            Continue training
          </h2>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {entries.length} assigned
        </span>
      </div>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {entries.map(({ module, assignment }) => {
          const version = latestVersionByModule.get(module.id)
          const thumbUrl = version?.thumbnail_path ? thumbnails.get(version.thumbnail_path) ?? null : null
          const dueDays = assignment.due_at
            ? Math.ceil((new Date(assignment.due_at).getTime() - nowMs) / (1000 * 60 * 60 * 24))
            : null
          const overdue = dueDays !== null && dueDays < 0
          return (
            <Link
              key={assignment.id}
              href={`/strike/${module.slug}?assignment=${assignment.id}`}
              className="group relative w-56 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-navy/40 hover:shadow-md dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-800">
                {thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbUrl}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-slate-400 dark:text-slate-600">
                    <GraduationCap className="h-8 w-8" />
                  </div>
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/55 to-transparent" />
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-800 shadow-sm">
                  <PlayCircle className="h-3 w-3" /> Resume
                </span>
                {dueDays !== null && (
                  <span
                    className={`absolute right-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm ${overdue ? 'bg-rose-500/95' : dueDays <= 7 ? 'bg-amber-500/95' : 'bg-black/55 backdrop-blur-sm'}`}
                  >
                    <Clock className="h-3 w-3" />
                    {overdue ? `${Math.abs(dueDays)}d overdue` : `Due in ${dueDays}d`}
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="line-clamp-2 text-xs font-semibold text-slate-900 dark:text-slate-100">{module.title}</p>
                {assignment.reason && (
                  <p className="mt-1 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">{assignment.reason}</p>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

function ReadinessSection({
  assignments,
  requirements,
  checks,
  modules,
  readinessStatus,
  failedAttempts,
  canEvaluate,
  onEvaluate,
}: {
  assignments: StrikeAssignmentRow[]
  requirements: StrikeRequirementRow[]
  checks: StrikeTaskCheckRow[]
  modules: StrikeModuleRow[]
  readinessStatus: StrikeReadinessStatus
  failedAttempts: number
  canEvaluate: boolean
  onEvaluate: (sourceType: StrikeRequirementSourceType, sourceId: string) => Promise<void>
}) {
  const [sourceType, setSourceType] = useState<StrikeRequirementSourceType>('loto')
  const [sourceId, setSourceId] = useState('')
  const moduleById = new Map(modules.map(module => [module.id, module]))
  const moduleTitle = (id: string) => modules.find(m => m.id === id)?.title ?? 'STRIKE module'

  return (
    <section className="grid gap-4 2xl:grid-cols-2">
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">Assignments</h2>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            {readinessStatus.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="mt-3 space-y-3">
          {assignments.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No active assignments.</p>
          ) : assignments.slice(0, 8).map(row => (
            <div key={row.id} className="rounded-lg border border-slate-100 p-3 text-sm dark:border-slate-800">
              <p className="font-semibold text-slate-900 dark:text-slate-100">{moduleTitle(row.module_id)}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {row.target_type}{row.target_id ? `: ${row.target_id}` : ''}{row.due_at ? ` · due ${dateOnly(row.due_at)}` : ''}
              </p>
              {row.reason && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{row.reason}</p>}
              {moduleById.get(row.module_id)?.slug && (
                <Link
                  href={`/strike/${moduleById.get(row.module_id)!.slug}?assignment=${row.id}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navy/90"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  Launch assignment
                </Link>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">Readiness checks</h2>
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{failedAttempts} incomplete</span>
        </div>
        {canEvaluate && (
          <form
            onSubmit={e => {
              e.preventDefault()
              void onEvaluate(sourceType, sourceId.trim())
            }}
            className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto]"
          >
            <select value={sourceType} onChange={e => setSourceType(e.target.value as StrikeRequirementSourceType)} className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              {SOURCE_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={sourceId} onChange={e => setSourceId(e.target.value)} placeholder="Optional source UUID" className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            <button type="submit" className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 sm:col-span-2 2xl:col-span-1">
              <RadioTower className="h-4 w-4" />
              Check
            </button>
          </form>
        )}
        <div className="mt-3 space-y-2">
          {checks.slice(0, 5).map(row => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-900">
              <span className="text-slate-600 dark:text-slate-300">
                {row.source_type.replace(/_/g, ' ')} · {row.valid_completion_count}/{row.required_count}
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{row.readiness_status.replace(/_/g, ' ')}</span>
            </div>
          ))}
          {checks.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No readiness checks logged yet.</p>}
        </div>
        {requirements.length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
            <h3 className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Active requirements</h3>
            <div className="mt-2 space-y-2">
              {requirements.slice(0, 5).map(row => (
                <p key={row.id} className="text-xs text-slate-500 dark:text-slate-400">
                  {moduleTitle(row.module_id)} · {row.source_type.replace(/_/g, ' ')}
                  {row.hazard_category ? ` · ${row.hazard_category}` : ''}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

function AssignmentPanel({
  modules,
  latestVersionByModule,
  tenantId,
  userId,
  onSaved,
}: {
  modules: StrikeModuleRow[]
  latestVersionByModule: Map<string, StrikeVersionRow>
  tenantId: string | null
  userId: string | null
  onSaved: () => Promise<void>
}) {
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '')
  const [targetType, setTargetType] = useState<StrikeAssignmentTargetType>('tenant')
  const [targetId, setTargetId] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!modules.some(module => module.id === moduleId)) setModuleId(modules[0]?.id ?? '')
  }, [moduleId, modules])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!tenantId || !moduleId) return
    if (targetType !== 'tenant' && !targetId.trim()) {
      setError('Target ID is required for non-tenant assignments.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: insertErr } = await supabase
      .from('strike_assignments')
      .insert({
        tenant_id: tenantId,
        module_id: moduleId,
        module_version_id: latestVersionByModule.get(moduleId)?.id ?? null,
        target_type: targetType,
        target_id: targetType === 'tenant' ? null : targetId.trim(),
        assigned_by: userId,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        reason: reason.trim() || null,
      })
    setBusy(false)
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setTargetType('tenant')
    setTargetId('')
    setDueAt('')
    setReason('')
    await onSaved()
  }

  return (
    <Panel title="Assign training" icon={Target}>
      <form onSubmit={submit} className="space-y-3">
        <ModuleSelect modules={modules} value={moduleId} onChange={setModuleId} />
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Target</span>
          <select value={targetType} onChange={e => setTargetType(e.target.value as StrikeAssignmentTargetType)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            {TARGET_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        {targetType !== 'tenant' && <TextInput label="Target ID" value={targetId} onChange={setTargetId} required />}
        <TextInput label="Due date" value={dueAt} onChange={setDueAt} type="date" />
        <TextInput label="Reason" value={reason} onChange={setReason} />
        {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        <SubmitButton busy={busy} label="Create assignment" icon={Send} />
      </form>
    </Panel>
  )
}

function RequirementPanel({
  modules,
  latestVersionByModule,
  tenantId,
  userId,
  onSaved,
}: {
  modules: StrikeModuleRow[]
  latestVersionByModule: Map<string, StrikeVersionRow>
  tenantId: string | null
  userId: string | null
  onSaved: () => Promise<void>
}) {
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '')
  const [sourceType, setSourceType] = useState<StrikeRequirementSourceType>('loto')
  const [sourceId, setSourceId] = useState('')
  const [hazard, setHazard] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!modules.some(module => module.id === moduleId)) setModuleId(modules[0]?.id ?? '')
  }, [moduleId, modules])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!tenantId || !moduleId) return
    const cleanSourceId = sourceId.trim()
    if (cleanSourceId && !UUID_RE.test(cleanSourceId)) {
      setError('Source ID must be a UUID.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: insertErr } = await supabase
      .from('strike_training_requirements')
      .insert({
        tenant_id: tenantId,
        module_id: moduleId,
        module_version_id: latestVersionByModule.get(moduleId)?.id ?? null,
        source_type: sourceType,
        source_id: cleanSourceId || null,
        hazard_category: hazard.trim() || null,
        required_before_start: true,
        notes: notes.trim() || null,
        created_by: userId,
      })
    setBusy(false)
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setSourceId('')
    setHazard('')
    setNotes('')
    await onSaved()
  }

  return (
    <Panel title="Link requirement" icon={Link2}>
      <form onSubmit={submit} className="space-y-3">
        <ModuleSelect modules={modules} value={moduleId} onChange={setModuleId} />
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Source</span>
          <select value={sourceType} onChange={e => setSourceType(e.target.value as StrikeRequirementSourceType)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            {SOURCE_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <TextInput label="Source ID" value={sourceId} onChange={setSourceId} placeholder="Optional specific record" />
        <TextInput label="Hazard category" value={hazard} onChange={setHazard} />
        <TextInput label="Notes" value={notes} onChange={setNotes} />
        {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        <SubmitButton busy={busy} label="Save requirement" icon={Send} />
      </form>
    </Panel>
  )
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: ComponentType<{ className?: string }>
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">
        <Icon className="h-4 w-4" />
        {title}
      </h2>
      {children}
    </section>
  )
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number | string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
        <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  )
}

function ModuleSelect({
  modules,
  value,
  onChange,
}: {
  modules: StrikeModuleRow[]
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Module</span>
      <select value={value} onChange={e => onChange(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
        {modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}
      </select>
    </label>
  )
}

function TextInput({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  required?: boolean
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
      />
    </label>
  )
}

function SubmitButton({
  busy,
  label,
  icon: Icon,
}: {
  busy: boolean
  label: string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {label}
    </button>
  )
}

function dateOnly(value: string) {
  return value.slice(0, 10)
}
