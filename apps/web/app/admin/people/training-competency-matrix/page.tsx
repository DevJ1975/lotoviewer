'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import {
  pivotMatrix,
  trainingMatrixTone,
  expiresFromValidity,
  type TrainingMatrixRow,
  type TrainingMatrixStatus,
  type TrainingMatrixTone,
} from '@soteria/core/trainingMatrix'

// Unified Training & Competency Matrix (migration 240). Admin-only at the route
// level; RLS also enforces admin on writes. Three tabs:
//   • Matrix       — every active member × their required courses, status-colored;
//                    click a cell to record a completion.
//   • Courses      — the course catalog (the requirement vocabulary).
//   • Requirements — assign courses to positions / mark org-wide.
// Reads/writes go direct via supabase + RLS, mirroring the training-records page.

interface Course {
  id:               string
  code:             string
  title:            string
  category:         string | null
  role:             string | null
  validity_months:  number | null
  required_for_all: boolean
  active:           boolean
}

interface Position { id: string; title: string; department: string | null }
interface CourseRequirement { id: string; position_id: string; course_id: string; required: boolean }

type Tab = 'matrix' | 'courses' | 'requirements'

const TONE_CELL: Record<TrainingMatrixTone, string> = {
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  warn:    'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  danger:  'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
}
const STATUS_ABBR: Record<TrainingMatrixStatus, string> = {
  current: '✓', due_soon: 'due', overdue: 'exp', missing: '—',
}

export default function TrainingCompetencyMatrixPage() {
  const { profile, loading: authLoading } = useAuth()
  const [tab, setTab] = useState<Tab>('matrix')

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3 flex-wrap">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            Training &amp; Competency Matrix
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Required training by worker and course, with expiry status. Records flow into the §(g) permit gates.
          </p>
        </div>
      </header>

      <nav className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(['matrix', 'courses', 'requirements'] as Tab[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-brand-navy text-brand-navy'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t === 'matrix' ? 'Matrix' : t === 'courses' ? 'Courses' : 'Requirements'}
          </button>
        ))}
      </nav>

      {tab === 'matrix'       && <MatrixTab />}
      {tab === 'courses'      && <CoursesTab />}
      {tab === 'requirements' && <RequirementsTab />}
    </div>
  )
}

// ── Matrix tab ──────────────────────────────────────────────────────────────

function MatrixTab() {
  const [rows, setRows]       = useState<TrainingMatrixRow[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [search, setSearch]   = useState('')
  const [gapsOnly, setGapsOnly] = useState(false)
  const [record, setRecord]   = useState<{ memberId: string; memberName: string; course: Course } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [matrixRes, courseRes] = await Promise.all([
      supabase.from('v_training_matrix').select('*'),
      supabase.from('training_courses').select('id, code, title, category, role, validity_months, required_for_all, active'),
    ])
    if (matrixRes.error) { setError(matrixRes.error.message); setRows([]) }
    else setRows((matrixRes.data ?? []) as TrainingMatrixRow[])
    if (!courseRes.error) setCourses((courseRes.data ?? []) as Course[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const { courses: cols, members } = pivotMatrix(rows)
  const courseById = new Map(courses.map(c => [c.id, c]))
  const q = search.trim().toLowerCase()
  const visible = members.filter(m => {
    if (gapsOnly && m.gapCount === 0 && m.dueSoonCount === 0) return false
    if (!q) return true
    return m.display_name.toLowerCase().includes(q) || (m.department ?? '').toLowerCase().includes(q)
  })

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search worker or department…"
          className="flex-1 min-w-[200px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={gapsOnly} onChange={e => setGapsOnly(e.target.checked)} className="rounded" />
          Gaps &amp; due-soon only
        </label>
        <span className="text-[11px] text-slate-400">Click a cell to record a completion</span>
      </div>

      {cols.length === 0 ? (
        <Empty message="No required courses yet." hint="Add courses and assign them to positions (or mark them org-wide) to populate the matrix." />
      ) : visible.length === 0 ? (
        <Empty message={members.length === 0 ? 'No active members with requirements yet.' : 'No workers match your filter.'} />
      ) : (
        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/60">
                <th className="sticky left-0 z-10 bg-slate-50 dark:bg-slate-900/60 px-3 py-2 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">Worker</th>
                {cols.map(c => (
                  <th key={c.course_id} className="px-2 py-2 text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300 whitespace-nowrap" title={c.title}>
                    {c.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map(m => (
                <tr key={m.member_id}>
                  <td className="sticky left-0 z-10 bg-white dark:bg-slate-900 px-3 py-2 whitespace-nowrap">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{m.display_name}</span>
                    {(m.position_title || m.department) && (
                      <span className="block text-[10px] text-slate-400">{[m.position_title, m.department].filter(Boolean).join(' · ')}</span>
                    )}
                  </td>
                  {cols.map(col => {
                    const cell = m.cells[col.course_id]
                    const course = courseById.get(col.course_id)
                    return (
                      <td key={col.course_id} className="px-1.5 py-1.5 text-center">
                        {cell ? (
                          <button
                            type="button"
                            onClick={() => course && setRecord({ memberId: m.member_id, memberName: m.display_name, course })}
                            title={cell.expires_at ? `${cell.status} · expires ${cell.expires_at}` : cell.status}
                            className={`inline-block min-w-[2.25rem] rounded px-1.5 py-1 text-[11px] font-semibold ${TONE_CELL[trainingMatrixTone(cell.status)]} hover:ring-2 hover:ring-brand-navy/30`}
                          >
                            {STATUS_ABBR[cell.status]}
                          </button>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-700">·</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {record && (
        <RecordDialog
          {...record}
          onClose={() => setRecord(null)}
          onSaved={() => { setRecord(null); load() }}
        />
      )}
    </div>
  )
}

function RecordDialog({
  memberId, memberName, course, onClose, onSaved,
}: {
  memberId: string
  memberName: string
  course: Course
  onClose: () => void
  onSaved: () => void
}) {
  const [completedAt, setCompletedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [certAuthority, setCertAuthority] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expiresAt = expiresFromValidity(completedAt, course.validity_months)

  async function submit() {
    setError(null)
    if (!completedAt) { setError('Completion date is required.'); return }
    setSubmitting(true)
    // member_id + course_id make this a member-keyed completion; worker_name is
    // denormalized so the name-based permit validators still see it; role falls
    // back to 'other' since loto_training_records.role is NOT NULL.
    const { error: err } = await supabase
      .from('loto_training_records')
      .insert({
        worker_name:    memberName,
        member_id:      memberId,
        course_id:      course.id,
        role:           course.role ?? 'other',
        completed_at:   completedAt,
        expires_at:     expiresAt,
        cert_authority: certAuthority.trim() || null,
      })
    setSubmitting(false)
    if (err) { setError(err.message); return }
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 overflow-y-auto py-10">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Record completion</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1" aria-label="Close">×</button>
        </header>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-200">{memberName}</span> · {course.title}
        </p>

        <div className="space-y-3">
          <Field label="Completed">
            <input type="date" value={completedAt} onChange={e => setCompletedAt(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy" />
          </Field>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {course.validity_months
              ? <>Expires <span className="font-semibold">{expiresAt}</span> ({course.validity_months}-month validity).</>
              : 'No expiry (one-time course).'}
          </p>
          <Field label="Cert authority" hint="Optional">
            <input type="text" value={certAuthority} onChange={e => setCertAuthority(e.target.value)} placeholder="ABC Safety Co."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy" />
          </Field>
        </div>

        {error && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting} className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90">
            {submitting ? 'Saving…' : 'Save completion'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Courses tab ─────────────────────────────────────────────────────────────

function CoursesTab() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('training_courses')
      .select('id, code, title, category, role, validity_months, required_for_all, active')
      .order('title', { ascending: true })
    if (err) { setError(err.message); setCourses([]) } else setCourses((data ?? []) as Course[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function remove(c: Course) {
    if (!confirm(`Delete course "${c.title}"? Its completions are kept but un-linked.`)) return
    const { error: err } = await supabase.from('training_courses').delete().eq('id', c.id)
    if (err) { setError(err.message); return }
    setCourses(prev => prev.filter(x => x.id !== c.id))
  }

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500 dark:text-slate-400">The vocabulary of required trainings — each course has an optional validity window and can be marked org-wide.</p>
        <button type="button" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90">
          <Plus className="h-4 w-4" /> Add course
        </button>
      </div>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

      {courses.length === 0 ? (
        <Empty message="No courses yet." hint="Add a course to start building the matrix." />
      ) : (
        <ul className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800">
          {courses.map(c => (
            <li key={c.id} className="px-4 py-3 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {c.title} <span className="text-[11px] font-normal text-slate-400">· {c.code}</span>
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {c.validity_months ? `${c.validity_months}-month validity` : 'no expiry'}
                  {c.category && <> · {c.category}</>}
                  {c.required_for_all && <span className="ml-1 text-emerald-700 dark:text-emerald-300 font-semibold">· org-wide</span>}
                  {!c.active && <span className="ml-1 text-slate-400">· inactive</span>}
                </p>
              </div>
              <button type="button" onClick={() => remove(c)} aria-label={`Delete ${c.title}`} className="text-slate-400 hover:text-rose-600 p-1">
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {addOpen && <AddCourseDialog onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load() }} />}
    </div>
  )
}

function AddCourseDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [code, setCode]       = useState('')
  const [title, setTitle]     = useState('')
  const [category, setCategory] = useState('')
  const [validity, setValidity] = useState('')
  const [requiredForAll, setRequiredForAll] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!code.trim() || !title.trim()) { setError('Code and title are required.'); return }
    const months = validity.trim() ? Number(validity) : null
    if (months !== null && (!Number.isInteger(months) || months <= 0)) { setError('Validity must be a positive whole number of months.'); return }
    setSubmitting(true)
    const { error: err } = await supabase.from('training_courses').insert({
      code: code.trim(), title: title.trim(), category: category.trim() || null,
      validity_months: months, required_for_all: requiredForAll,
    })
    setSubmitting(false)
    if (err) { setError(err.message); return }
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 overflow-y-auto py-10">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add course</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1" aria-label="Close">×</button>
        </header>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_2fr] gap-3">
            <Field label="Code"><input type="text" value={code} onChange={e => setCode(e.target.value)} placeholder="FORKLIFT-OP"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy" /></Field>
            <Field label="Title"><input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Electric forklift operator"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" hint="Optional"><input type="text" value={category} onChange={e => setCategory(e.target.value)} placeholder="equipment"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy" /></Field>
            <Field label="Validity (months)" hint="Blank = no expiry"><input type="number" min="1" value={validity} onChange={e => setValidity(e.target.value)} placeholder="12"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy" /></Field>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={requiredForAll} onChange={e => setRequiredForAll(e.target.checked)} className="rounded" />
            Required for every active worker (org-wide)
          </label>
        </div>
        {error && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting} className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90">
            {submitting ? 'Adding…' : 'Add course'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Requirements tab ────────────────────────────────────────────────────────

function RequirementsTab() {
  const [positions, setPositions] = useState<Position[]>([])
  const [courses, setCourses]     = useState<Course[]>([])
  const [reqs, setReqs]           = useState<CourseRequirement[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const [posRes, courseRes, reqRes] = await Promise.all([
      supabase.from('worker_positions').select('id, title, department').eq('active', true).order('title'),
      supabase.from('training_courses').select('id, code, title, category, role, validity_months, required_for_all, active').eq('active', true).order('title'),
      supabase.from('position_course_requirements').select('id, position_id, course_id, required'),
    ])
    if (posRes.error) setError(posRes.error.message); else setPositions((posRes.data ?? []) as Position[])
    if (!courseRes.error) setCourses((courseRes.data ?? []) as Course[])
    if (!reqRes.error) setReqs((reqRes.data ?? []) as CourseRequirement[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function addReq(positionId: string, courseId: string) {
    if (!courseId) return
    const { error: err } = await supabase.from('position_course_requirements').insert({ position_id: positionId, course_id: courseId })
    if (err) { setError(err.message); return }
    load()
  }
  async function removeReq(id: string) {
    const { error: err } = await supabase.from('position_course_requirements').delete().eq('id', id)
    if (err) { setError(err.message); return }
    setReqs(prev => prev.filter(r => r.id !== id))
  }

  if (loading) return <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>

  const courseById = new Map(courses.map(c => [c.id, c]))

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">Assign required courses to each position. Courses marked org-wide apply to everyone automatically.</p>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

      {positions.length === 0 ? (
        <Empty message="No positions yet." hint="Define positions under People / Workers first, then assign their required courses here." />
      ) : positions.map(pos => {
        const posReqs = reqs.filter(r => r.position_id === pos.id)
        const assignedIds = new Set(posReqs.map(r => r.course_id))
        const addable = courses.filter(c => !assignedIds.has(c.id) && !c.required_for_all)
        return (
          <div key={pos.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
              {pos.title}{pos.department && <span className="ml-1 text-[11px] font-normal text-slate-400">· {pos.department}</span>}
            </p>
            {posReqs.length === 0 ? (
              <p className="text-[11px] text-slate-400">No course requirements.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {posReqs.map(r => {
                  const c = courseById.get(r.course_id)
                  return (
                    <li key={r.id} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[11px] text-slate-700 dark:text-slate-200">
                      {c?.title ?? '(unknown course)'}
                      <button type="button" onClick={() => removeReq(r.id)} aria-label="Remove" className="text-slate-400 hover:text-rose-600">×</button>
                    </li>
                  )
                })}
              </ul>
            )}
            {addable.length > 0 && (
              <select
                defaultValue=""
                onChange={e => { addReq(pos.id, e.target.value); e.target.value = '' }}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              >
                <option value="">+ Add required course…</option>
                {addable.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── shared bits ─────────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}{hint && <span className="text-slate-400 dark:text-slate-500 font-normal ml-1.5">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function Empty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-6 text-center space-y-1">
      <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">{message}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}
