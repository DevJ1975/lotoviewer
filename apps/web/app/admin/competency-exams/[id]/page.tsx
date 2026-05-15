'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { LotoWorker } from '@soteria/core/types'
import {
  COMPETENCY_EXAM_ROLE_LABELS,
  validateQuestions,
  type CompetencyExam,
  type CompetencyExamQuestion,
} from '@soteria/core/lotoCompetencyExam'

export default function CompetencyExamEditorPage() {
  return (
    <Suspense fallback={<Loader />}>
      <Editor />
    </Suspense>
  )
}

function Loader() {
  return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
}

function Editor() {
  const { id: examId } = useParams<{ id: string }>()
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [exam, setExam] = useState<CompetencyExam | null>(null)
  const [workers, setWorkers] = useState<LotoWorker[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Editable state — diverges from `exam` until Save is clicked.
  const [title, setTitle] = useState('')
  const [passingScore, setPassingScore] = useState(80)
  const [questions, setQuestions] = useState<CompetencyExamQuestion[]>([])

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    try {
      const [examResult, workersResult] = await Promise.all([
        supabase.from('loto_competency_exams').select('*').eq('id', examId).single(),
        supabase.from('loto_workers').select('*').eq('tenant_id', tenantId).eq('active', true).order('full_name', { ascending: true }),
      ])
      if (examResult.error) throw new Error(formatSupabaseError(examResult.error, 'load exam'))
      if (workersResult.error) throw new Error(formatSupabaseError(workersResult.error, 'load workers'))
      const e = examResult.data as CompetencyExam
      setExam(e)
      setTitle(e.title)
      setPassingScore(e.passing_score)
      setQuestions(Array.isArray(e.questions) ? e.questions : [])
      setWorkers((workersResult.data ?? []) as LotoWorker[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load exam.')
    }
  }, [tenantId, examId])

  useEffect(() => { if (!authLoading && profile?.is_admin) load() }, [authLoading, profile, load])

  if (authLoading || !exam) return <Loader />
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  function addQuestion() {
    setQuestions(prev => [...prev, { prompt: '', choices: ['', ''], answer_index: 0 }])
  }

  function removeQuestion(i: number) {
    setQuestions(prev => prev.filter((_, idx) => idx !== i))
  }

  function patchQuestion(i: number, patch: Partial<CompetencyExamQuestion>) {
    setQuestions(prev => prev.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  }

  function patchChoice(qi: number, ci: number, value: string) {
    setQuestions(prev => prev.map((q, idx) => {
      if (idx !== qi) return q
      const choices = [...q.choices]
      choices[ci] = value
      return { ...q, choices }
    }))
  }

  function addChoice(qi: number) {
    setQuestions(prev => prev.map((q, idx) => idx === qi ? { ...q, choices: [...q.choices, ''] } : q))
  }

  function removeChoice(qi: number, ci: number) {
    setQuestions(prev => prev.map((q, idx) => {
      if (idx !== qi) return q
      const choices = q.choices.filter((_, x) => x !== ci)
      // Keep answer_index valid if the removed choice was the answer
      // or to the left of it.
      const newAnswer = ci < q.answer_index
        ? q.answer_index - 1
        : ci === q.answer_index
          ? 0
          : q.answer_index
      return { ...q, choices, answer_index: Math.min(newAnswer, choices.length - 1) }
    }))
  }

  async function save() {
    setError(null)
    const issues = validateQuestions(questions)
    if (issues.length > 0) {
      setError(`Question ${issues[0].index + 1}: ${issues[0].message}`)
      return
    }
    if (!title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    const { error: err } = await supabase
      .from('loto_competency_exams')
      .update({
        title:         title.trim(),
        passing_score: passingScore,
        questions,
      })
      .eq('id', examId)
    setSaving(false)
    if (err) { setError(formatSupabaseError(err, 'save exam')); return }
    await load()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/competency-exams" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to exams
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">Edit competency exam</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {COMPETENCY_EXAM_ROLE_LABELS[exam.role]}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Title</span>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Passing %</span>
            <input
              type="number"
              min={0}
              max={100}
              value={passingScore}
              onChange={e => setPassingScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
              className="mt-1 w-24 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            />
          </label>
        </div>

        <div className="space-y-3">
          {questions.map((q, qi) => (
            <div key={qi} className="rounded-md border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Question {qi + 1}</span>
                <button type="button" onClick={() => removeQuestion(qi)} className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 p-1">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input
                type="text"
                value={q.prompt}
                onChange={e => patchQuestion(qi, { prompt: e.target.value })}
                placeholder="Prompt"
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
              <div className="space-y-1.5">
                {q.choices.map((c, ci) => (
                  <div key={ci} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`answer-${qi}`}
                      checked={q.answer_index === ci}
                      onChange={() => patchQuestion(qi, { answer_index: ci })}
                      className="h-4 w-4 text-brand-navy focus:ring-brand-navy/30"
                    />
                    <input
                      type="text"
                      value={c}
                      onChange={e => patchChoice(qi, ci, e.target.value)}
                      placeholder={`Choice ${ci + 1}`}
                      className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
                    />
                    {q.choices.length > 2 && (
                      <button type="button" onClick={() => removeChoice(qi, ci)} className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 text-lg leading-none px-1">×</button>
                    )}
                  </div>
                ))}
                {q.choices.length < 5 && (
                  <button type="button" onClick={() => addChoice(qi)} className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-brand-navy">+ Add choice</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addQuestion}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-dashed border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-brand-navy/40"
        >
          <Plus className="h-3 w-3" /> Add question
        </button>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save exam'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Proctored attempts</h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Pick a worker and start a proctored attempt. The admin records the score
          while the worker takes the exam.
        </p>
        {workers.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">No active workers in the LOTO roster.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {workers.map(w => (
              <li key={w.id} className="py-2 flex items-center gap-3">
                <span className="text-sm text-slate-700 dark:text-slate-300 flex-1 min-w-0 truncate">
                  {w.full_name}
                  {w.employee_id && <span className="ml-1 text-[11px] text-slate-500 dark:text-slate-400">· {w.employee_id}</span>}
                </span>
                <Link
                  href={`/admin/competency-exams/${examId}/take/${w.id}`}
                  className="text-[11px] px-3 py-1.5 rounded-md bg-brand-navy text-white font-semibold"
                >
                  Start proctored attempt
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
