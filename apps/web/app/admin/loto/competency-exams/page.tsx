'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ClipboardList, Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  COMPETENCY_EXAM_ROLE_LABELS,
  type CompetencyExam,
  type CompetencyExamRole,
} from '@soteria/core/lotoCompetencyExam'

const ROLES: CompetencyExamRole[] = ['operator', 'supervisor', 'energy_iso', 'rescue']

export default function CompetencyExamsListPage() {
  const router = useRouter()
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [exams, setExams] = useState<CompetencyExam[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newRole, setNewRole] = useState<CompetencyExamRole>('operator')

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const { data, error: err } = await supabase
      .from('loto_competency_exams')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (err) { setError(formatSupabaseError(err, 'load exams')); return }
    setExams((data ?? []) as CompetencyExam[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) load() }, [authLoading, profile, load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  async function create() {
    if (!tenantId || !newTitle.trim()) return
    setCreating(true)
    const { data, error: err } = await supabase
      .from('loto_competency_exams')
      .insert({
        tenant_id:     tenantId,
        title:         newTitle.trim(),
        role:          newRole,
        questions:     [],
        passing_score: 80,
        created_by:    profile?.id ?? null,
      })
      .select('id')
      .single()
    setCreating(false)
    if (err || !data) { setError(formatSupabaseError(err, 'create exam')); return }
    router.push(`/admin/loto/competency-exams/${data.id}`)
  }

  async function archive(exam: CompetencyExam) {
    if (!confirm(`Deactivate exam "${exam.title}"?`)) return
    const { error: err } = await supabase
      .from('loto_competency_exams')
      .update({ active: false })
      .eq('id', exam.id)
    if (err) { setError(formatSupabaseError(err, 'deactivate exam')); return }
    await load()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/loto" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to LOTO
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-brand-navy" />
          Competency exams
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          §1910.147(c)(7) — authorized + affected employees must be able to
          demonstrate understanding of the energy-control procedures.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Create exam</h2>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
          <input
            type="text"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            disabled={creating}
            placeholder="Title (e.g. Annual authorized-employee competency 2026)"
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
          <select
            value={newRole}
            onChange={e => setNewRole(e.target.value as CompetencyExamRole)}
            disabled={creating}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          >
            {ROLES.map(r => <option key={r} value={r}>{COMPETENCY_EXAM_ROLE_LABELS[r]}</option>)}
          </select>
          <button
            type="button"
            onClick={create}
            disabled={creating || !newTitle.trim()}
            className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-brand-navy text-white text-sm font-semibold disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Create
          </button>
        </div>
      </section>

      {exams === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : exams.filter(e => e.active).length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No active exams. Create one above.</p>
        </div>
      ) : (
        <ul className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {exams.filter(e => e.active).map(exam => (
            <li key={exam.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/loto/competency-exams/${exam.id}`}
                  className="text-sm font-bold text-slate-900 dark:text-slate-100 hover:underline"
                >
                  {exam.title}
                </Link>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {COMPETENCY_EXAM_ROLE_LABELS[exam.role]} · {exam.questions.length} questions · passing {exam.passing_score}%
                </p>
              </div>
              <button
                type="button"
                onClick={() => archive(exam)}
                aria-label={`Deactivate ${exam.title}`}
                className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 p-1"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
