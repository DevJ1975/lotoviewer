'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComponentType, FormEvent, ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Award,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  GraduationCap,
  Link2,
  Loader2,
  Plus,
  QrCode,
  RadioTower,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  Video,
} from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  computeStrikeReadiness,
  isStrikeCompletionCurrent,
  normalizeStrikeSlug,
  STRIKE_ASSIGNMENT_TARGET_TYPES,
  STRIKE_QUESTION_TYPES,
  STRIKE_REQUIREMENT_SOURCE_TYPES,
  type StrikeAssignmentTargetType,
  type StrikeLibraryScope,
  type StrikeQuestionType,
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

interface StrikeStudioRequestRow {
  id: string
  title: string
  request_type: 'custom_module' | 'content_refresh' | 'site_filming' | 'consultation'
  priority: 'low' | 'normal' | 'high' | 'urgent'
  status: string
  target_audience: string | null
  desired_due_date: string | null
  created_at: string
}

const SOURCE_TYPES = STRIKE_REQUIREMENT_SOURCE_TYPES
const TARGET_TYPES = STRIKE_ASSIGNMENT_TARGET_TYPES
const QUESTION_TYPES = STRIKE_QUESTION_TYPES
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function StrikePage() {
  const { tenant, role } = useTenant()
  const { userId, profile } = useAuth()
  const tenantId = tenant?.id ?? null
  const isAdmin = role === 'admin' || role === 'owner' || profile?.is_superadmin === true

  const [modules, setModules] = useState<StrikeModuleRow[] | null>(null)
  const [versions, setVersions] = useState<StrikeVersionRow[]>([])
  const [completions, setCompletions] = useState<StrikeCompletionRow[]>([])
  const [assignments, setAssignments] = useState<StrikeAssignmentRow[]>([])
  const [requirements, setRequirements] = useState<StrikeRequirementRow[]>([])
  const [taskChecks, setTaskChecks] = useState<StrikeTaskCheckRow[]>([])
  const [studioRequests, setStudioRequests] = useState<StrikeStudioRequestRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
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
          .select('id,module_id,version_number,video_path,transcript,duration_seconds,passing_score,published_at')
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
      }

      const [
        { data: assignmentRows, error: assignmentErr },
        { data: requirementRows, error: requirementErr },
        { data: checkRows, error: checkErr },
        { data: requestRows, error: requestErr },
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
        supabase
          .from('strike_studio_requests')
          .select('id,title,request_type,priority,status,target_audience,desired_due_date,created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      if (assignmentErr) throw assignmentErr
      if (requirementErr) throw requirementErr
      if (checkErr && isAdmin) throw checkErr
      if (requestErr) throw requestErr

      setAssignments((assignmentRows ?? []) as StrikeAssignmentRow[])
      setRequirements((requirementRows ?? []) as StrikeRequirementRow[])
      setTaskChecks((checkRows ?? []) as StrikeTaskCheckRow[])
      setStudioRequests((requestRows ?? []) as StrikeStudioRequestRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setModules([])
    }
  }, [isAdmin, tenantId, userId])

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
  const assignedModuleIds = new Set(activeAssignments.map(a => a.module_id))
  const assignedCompletions = activeAssignments.filter(a => currentCompletionByModule.has(a.module_id)).length
  const readiness = computeStrikeReadiness({
    requiredCount: activeAssignments.length,
    validCompletionCount: assignedCompletions,
  })
  const readinessRate = taskChecks.length > 0
    ? Math.round((taskChecks.filter(c => c.readiness_status === 'ready').length / taskChecks.length) * 100)
    : readiness.percent
  const overdueCount = activeAssignments.filter(a => a.due_at && a.due_at < new Date().toISOString()).length
  const avgScore = completions.length > 0
    ? Math.round(completions.reduce((sum, c) => sum + (c.score_percent ?? 100), 0) / completions.length)
    : 0
  const failedAttempts = Math.max(0, activeAssignments.length - assignedCompletions)
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
            Microlearning, assignment tracking, Studio requests, and task-readiness for high-risk work.
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
        <Metric label="Open Studio requests" value={studioRequests.filter(r => !['delivered', 'cancelled'].includes(r.status)).length} icon={Video} />
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

      {modules === null && !error && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {modules && modules.length === 0 && (
        <section className="rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <GraduationCap className="mx-auto h-9 w-9 text-slate-300 dark:text-slate-600" />
          <h2 className="mt-3 text-base font-semibold text-slate-900 dark:text-slate-100">No STRIKE modules published yet</h2>
          <p className="mx-auto mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Tenant admins can create the first published module below, then assign it or link it to a readiness requirement.
          </p>
        </section>
      )}

      {modules && (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <LibrarySection
              modules={modules}
              latestVersionByModule={latestVersionByModule}
              currentCompletionByModule={currentCompletionByModule}
            />
            <ReadinessSection
              assignments={activeAssignments}
              requirements={requirements}
              checks={taskChecks}
              modules={modules}
              readinessStatus={readiness.status}
              failedAttempts={failedAttempts}
              canEvaluate={isAdmin}
              onEvaluate={evaluateReadiness}
            />
          </div>

          <aside className="space-y-4">
            <StudioPanel requests={studioRequests} tenantId={tenantId} userId={userId} onSaved={load} />
            {isAdmin && (
              <>
                <ModuleAuthoringPanel tenantId={tenantId} userId={userId} onSaved={load} />
                <QuizAuthoringPanel modules={modules} latestVersionByModule={latestVersionByModule} tenantId={tenantId} onSaved={load} />
                <AssignmentPanel modules={modules} latestVersionByModule={latestVersionByModule} tenantId={tenantId} userId={userId} onSaved={load} />
                <RequirementPanel modules={modules} latestVersionByModule={latestVersionByModule} tenantId={tenantId} userId={userId} onSaved={load} />
              </>
            )}
          </aside>
        </section>
      )}
    </div>
  )
}

function LibrarySection({
  modules,
  latestVersionByModule,
  currentCompletionByModule,
}: {
  modules: StrikeModuleRow[]
  latestVersionByModule: Map<string, StrikeVersionRow>
  currentCompletionByModule: Map<string, StrikeCompletionRow>
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">
          Training library
        </h2>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {modules.map(module => {
          const completion = currentCompletionByModule.get(module.id)
          const version = latestVersionByModule.get(module.id)
          const launchPath = `/strike/${module.slug}`
          return (
            <article
              key={module.id}
              className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{module.title}</h3>
                  <p className="mt-1 line-clamp-3 text-sm text-slate-500 dark:text-slate-400">
                    {module.description ?? 'Short, field-ready safety instruction.'}
                  </p>
                </div>
                <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                  {module.library_scope}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                {module.category && <span>{module.category}</span>}
                {module.estimated_minutes && <span>{module.estimated_minutes} min</span>}
                {version?.duration_seconds && <span>{Math.ceil(version.duration_seconds / 60)} min video</span>}
                {completion && (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Current
                  </span>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link href={launchPath} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white hover:bg-brand-navy/90">
                  <QrCode className="h-3.5 w-3.5" />
                  Launch
                </Link>
                {!version && <span className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 dark:border-amber-900 dark:text-amber-300">No published version</span>}
              </div>
            </article>
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
  const moduleTitle = (id: string) => modules.find(m => m.id === id)?.title ?? 'STRIKE module'

  return (
    <section className="grid gap-4 lg:grid-cols-2">
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
            className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
          >
            <select value={sourceType} onChange={e => setSourceType(e.target.value as StrikeRequirementSourceType)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
              {SOURCE_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
            </select>
            <input value={sourceId} onChange={e => setSourceId(e.target.value)} placeholder="Optional source UUID" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            <button type="submit" className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90">
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

function ModuleAuthoringPanel({
  tenantId,
  userId,
  onSaved,
}: {
  tenantId: string | null
  userId: string | null
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [minutes, setMinutes] = useState('5')
  const [videoPath, setVideoPath] = useState('')
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!tenantId || !title.trim()) return
    setBusy(true)
    setError(null)
    const slug = `${normalizeStrikeSlug(title)}-${Date.now().toString(36)}`
    const now = new Date().toISOString()
    const { data: module, error: moduleErr } = await supabase
      .from('strike_modules')
      .insert({
        tenant_id: tenantId,
        library_scope: 'tenant',
        title: title.trim(),
        slug,
        description: description.trim() || null,
        category: category.trim() || null,
        estimated_minutes: Math.max(1, Math.min(60, Number(minutes) || 5)),
        status: 'published',
        created_by: userId,
        updated_by: userId,
        published_at: now,
      })
      .select('id')
      .single()

    if (moduleErr || !module) {
      setError(moduleErr?.message ?? 'Module creation failed')
      setBusy(false)
      return
    }

    const { error: versionErr } = await supabase
      .from('strike_module_versions')
      .insert({
        module_id: module.id,
        tenant_id: tenantId,
        library_scope: 'tenant',
        version_number: 1,
        status: 'published',
        video_path: videoPath.trim() || null,
        transcript: transcript.trim() || null,
        duration_seconds: Math.max(60, (Number(minutes) || 5) * 60),
        passing_score: 80,
        created_by: userId,
        published_at: now,
      })

    setBusy(false)
    if (versionErr) {
      setError(versionErr.message)
      return
    }
    setTitle('')
    setDescription('')
    setCategory('')
    setMinutes('5')
    setVideoPath('')
    setTranscript('')
    await onSaved()
  }

  return (
    <Panel title="Author module" icon={Plus}>
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="Title" value={title} onChange={setTitle} required />
        <TextInput label="Category" value={category} onChange={setCategory} />
        <TextInput label="Estimated minutes" value={minutes} onChange={setMinutes} type="number" />
        <TextInput label="Private video path" value={videoPath} onChange={setVideoPath} placeholder="tenant-id/file.mp4" />
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Transcript</span>
          <textarea value={transcript} onChange={e => setTranscript(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
        </label>
        <TextInput label="Description" value={description} onChange={setDescription} />
        {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        <SubmitButton busy={busy} label="Publish module" icon={Send} />
      </form>
    </Panel>
  )
}

function QuizAuthoringPanel({
  modules,
  latestVersionByModule,
  tenantId,
  onSaved,
}: {
  modules: StrikeModuleRow[]
  latestVersionByModule: Map<string, StrikeVersionRow>
  tenantId: string | null
  onSaved: () => Promise<void>
}) {
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '')
  const [questionType, setQuestionType] = useState<StrikeQuestionType>('multiple_choice')
  const [prompt, setPrompt] = useState('')
  const [answerText, setAnswerText] = useState('*Correct answer\nDistractor answer')
  const [explanation, setExplanation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!moduleId && modules[0]) setModuleId(modules[0].id)
  }, [moduleId, modules])

  async function submit(e: FormEvent) {
    e.preventDefault()
    const version = latestVersionByModule.get(moduleId)
    if (!tenantId || !moduleId || !version || !prompt.trim()) return

    const parsedAnswers = questionType === 'acknowledgement'
      ? []
      : answerText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line, index) => ({
          answer_text: line.replace(/^\*/, '').trim(),
          is_correct: line.startsWith('*'),
          sort_order: index,
        }))

    if (questionType !== 'acknowledgement') {
      if (parsedAnswers.length < 2) {
        setError('Add at least two answer choices.')
        return
      }
      if (!parsedAnswers.some(a => a.is_correct)) {
        setError('Prefix at least one correct answer with *.')
        return
      }
      if (questionType !== 'select_all' && parsedAnswers.filter(a => a.is_correct).length !== 1) {
        setError('Multiple choice and true/false questions need exactly one correct answer.')
        return
      }
    }

    setBusy(true)
    setError(null)
    const { count } = await supabase
      .from('strike_quiz_questions')
      .select('id', { count: 'exact', head: true })
      .eq('module_version_id', version.id)

    const { data: question, error: questionErr } = await supabase
      .from('strike_quiz_questions')
      .insert({
        module_version_id: version.id,
        tenant_id: tenantId,
        library_scope: 'tenant',
        question_type: questionType,
        prompt: prompt.trim(),
        explanation: explanation.trim() || null,
        sort_order: count ?? 0,
        required: true,
        points: 1,
      })
      .select('id')
      .single()

    if (questionErr || !question) {
      setError(questionErr?.message ?? 'Question creation failed')
      setBusy(false)
      return
    }

    if (parsedAnswers.length > 0) {
      const { error: answersErr } = await supabase
        .from('strike_quiz_answers')
        .insert(parsedAnswers.map(answer => ({
          question_id: question.id,
          tenant_id: tenantId,
          library_scope: 'tenant',
          ...answer,
        })))
      if (answersErr) {
        setError(answersErr.message)
        setBusy(false)
        return
      }
    }

    setPrompt('')
    setExplanation('')
    setAnswerText(questionType === 'acknowledgement' ? '' : '*Correct answer\nDistractor answer')
    setBusy(false)
    await onSaved()
  }

  return (
    <Panel title="Add quiz question" icon={ClipboardCheck}>
      <form onSubmit={submit} className="space-y-3">
        <ModuleSelect modules={modules} value={moduleId} onChange={setModuleId} />
        <label className="block">
          <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Type</span>
          <select value={questionType} onChange={e => setQuestionType(e.target.value as StrikeQuestionType)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900">
            {QUESTION_TYPES.map(type => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <TextInput label="Prompt" value={prompt} onChange={setPrompt} required />
        {questionType !== 'acknowledgement' && (
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Answers</span>
            <textarea value={answerText} onChange={e => setAnswerText(e.target.value)} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
        )}
        <TextInput label="Explanation" value={explanation} onChange={setExplanation} />
        {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        <SubmitButton busy={busy} label="Add question" icon={Send} />
      </form>
    </Panel>
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
    if (!moduleId && modules[0]) setModuleId(modules[0].id)
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
    if (!moduleId && modules[0]) setModuleId(modules[0].id)
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

function StudioPanel({
  requests,
  tenantId,
  userId,
  onSaved,
}: {
  requests: StrikeStudioRequestRow[]
  tenantId: string | null
  userId: string | null
  onSaved: () => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!tenantId || !title.trim()) return
    setBusy(true)
    setError(null)
    const { error: insertErr } = await supabase
      .from('strike_studio_requests')
      .insert({
        tenant_id: tenantId,
        requested_by: userId,
        title: title.trim(),
        request_type: 'custom_module',
        priority: 'normal',
        target_audience: audience.trim() || null,
        task_description: description.trim() || null,
      })
    setBusy(false)
    if (insertErr) {
      setError(insertErr.message)
      return
    }
    setTitle('')
    setAudience('')
    setDescription('')
    await onSaved()
  }

  return (
    <Panel title="STRIKE Studio" icon={Video}>
      <form onSubmit={submit} className="space-y-3">
        <TextInput label="Request title" value={title} onChange={setTitle} required />
        <TextInput label="Target audience" value={audience} onChange={setAudience} />
        <TextInput label="Task description" value={description} onChange={setDescription} />
        {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        <SubmitButton busy={busy} label="Request content" icon={Send} />
      </form>
      {requests.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          {requests.slice(0, 4).map(row => (
            <div key={row.id} className="text-xs">
              <p className="font-semibold text-slate-900 dark:text-slate-100">{row.title}</p>
              <p className="text-slate-500 dark:text-slate-400">{row.status} · {row.priority}</p>
            </div>
          ))}
        </div>
      )}
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
