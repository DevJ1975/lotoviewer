'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { LotoWorker } from '@soteria/core/types'
import {
  COMPETENCY_EXAM_ROLE_LABELS,
  scoreAttempt,
  type CompetencyExam,
} from '@soteria/core/lotoCompetencyExam'

// /admin/competency-exams/[id]/take/[workerId] — proctored exam.
//
// The admin is logged in and sits with the worker as they answer.
// The page records the admin as proctor_user_id and the worker as
// worker_id. On submit, a passing attempt optionally creates a
// loto_training_records row so the §147(c)(7) competency turns into
// a §(g)-style cert that drives the §(g) gates.

export default function TakeExamPage() {
  return (
    <Suspense fallback={<Loader />}>
      <TakeExam />
    </Suspense>
  )
}

function Loader() {
  return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
}

function TakeExam() {
  const router = useRouter()
  const { id: examId, workerId } = useParams<{ id: string; workerId: string }>()
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [exam, setExam] = useState<CompetencyExam | null>(null)
  const [worker, setWorker] = useState<LotoWorker | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [answers, setAnswers] = useState<number[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [autoCreateCert, setAutoCreateCert] = useState(true)
  const [result, setResult] = useState<{ score: number; passed: boolean } | null>(null)

  const start = useCallback(async () => {
    if (!tenantId || !profile) return
    setError(null)
    const { data, error: err } = await supabase
      .from('loto_competency_exam_attempts')
      .insert({
        tenant_id:        tenantId,
        exam_id:          examId,
        worker_id:        workerId,
        proctor_user_id:  profile.id,
        answers:          [],
      })
      .select('id')
      .single()
    if (err || !data) { setError(formatSupabaseError(err, 'start attempt')); return }
    setAttemptId(data.id)
  }, [tenantId, profile, examId, workerId])

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const [examResult, workerResult] = await Promise.all([
      supabase.from('loto_competency_exams').select('*').eq('id', examId).single(),
      supabase.from('loto_workers').select('*').eq('id', workerId).single(),
    ])
    if (examResult.error)   { setError(formatSupabaseError(examResult.error,   'load exam'));   return }
    if (workerResult.error) { setError(formatSupabaseError(workerResult.error, 'load worker')); return }
    setExam(examResult.data as CompetencyExam)
    setWorker(workerResult.data as LotoWorker)
    setAnswers(new Array((examResult.data as CompetencyExam).questions.length).fill(-1))
  }, [tenantId, examId, workerId])

  useEffect(() => { if (!authLoading && profile?.is_admin) load() }, [authLoading, profile, load])

  useEffect(() => { if (exam && !attemptId) start() }, [exam, attemptId, start])

  if (authLoading || !exam || !worker || !attemptId) return <Loader />
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  function pick(qi: number, ci: number) {
    setAnswers(prev => prev.map((a, idx) => idx === qi ? ci : a))
  }

  async function submit() {
    if (!exam || !worker) return
    setError(null)
    setSubmitting(true)
    try {
      const scored = scoreAttempt(exam, answers)

      // Stamp the attempt with the result. The DB enforces the
      // completed_at/score/passed all-or-nothing constraint via a
      // CHECK on the table.
      const { error: attemptErr } = await supabase
        .from('loto_competency_exam_attempts')
        .update({
          completed_at: new Date().toISOString(),
          score:        scored.score,
          passed:       scored.passed,
          answers,
        })
        .eq('id', attemptId)
      if (attemptErr) throw new Error(formatSupabaseError(attemptErr, 'finalize attempt'))

      // Auto-create a training record on pass when requested. The
      // record has no expires_at — the renewal cadence is the
      // operator's policy decision. They can set it manually on
      // the /admin/training-records page if needed.
      if (scored.passed && autoCreateCert) {
        const { data: rec, error: trainErr } = await supabase
          .from('loto_training_records')
          .insert({
            tenant_id:      tenantId,
            worker_name:    worker.full_name,
            role:           'authorized_employee',
            completed_at:   new Date().toISOString().slice(0, 10),
            cert_authority: `Competency exam: ${exam.title}`,
            created_by:     profile?.id,
          })
          .select('id')
          .single()
        if (!trainErr && rec) {
          await supabase
            .from('loto_competency_exam_attempts')
            .update({ training_record_id: rec.id })
            .eq('id', attemptId)
        }
      }

      setResult({ score: scored.score, passed: scored.passed })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit exam.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href={`/admin/competency-exams/${examId}`} className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to exam
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{exam.title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {COMPETENCY_EXAM_ROLE_LABELS[exam.role]} · candidate: <span className="font-semibold">{worker.full_name}</span>
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Proctor: <span className="font-semibold">{profile?.full_name ?? profile?.email}</span> · passing {exam.passing_score}%
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      {result ? (
        <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center space-y-2">
          <p className="text-3xl font-bold text-slate-900 dark:text-slate-100">{result.score}%</p>
          <p className={`text-sm font-semibold ${result.passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
            {result.passed ? 'Passed' : 'Did not pass'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {result.passed && autoCreateCert
              ? 'A training record was created for this worker.'
              : result.passed
                ? 'No training record was created (auto-cert disabled).'
                : 'No training record was created (failed).'}
          </p>
          <button
            type="button"
            onClick={() => router.push(`/admin/competency-exams/${examId}`)}
            className="mt-3 px-4 py-2 rounded-md bg-brand-navy text-white text-sm font-semibold"
          >
            Back to exam
          </button>
        </section>
      ) : (
        <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
          {exam.questions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 italic">
              This exam has no questions yet. Edit it before assigning attempts.
            </p>
          ) : (
            exam.questions.map((q, qi) => (
              <fieldset key={qi} className="rounded-md border border-slate-100 dark:border-slate-800 p-3 space-y-2">
                <legend className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 px-1">Question {qi + 1}</legend>
                <p className="text-sm text-slate-900 dark:text-slate-100">{q.prompt}</p>
                <div className="space-y-1.5">
                  {q.choices.map((c, ci) => (
                    <label key={ci} className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="radio"
                        name={`q-${qi}`}
                        checked={answers[qi] === ci}
                        onChange={() => pick(qi, ci)}
                        className="h-4 w-4 text-brand-navy focus:ring-brand-navy/30"
                      />
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))
          )}

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={autoCreateCert}
              onChange={e => setAutoCreateCert(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy/30"
            />
            Auto-create an authorized-employee training record on pass
          </label>

          <button
            type="button"
            onClick={submit}
            disabled={submitting || exam.questions.length === 0}
            className="w-full rounded-lg bg-brand-navy text-white text-sm font-semibold py-2.5 disabled:opacity-40"
          >
            {submitting ? 'Scoring…' : 'Submit exam'}
          </button>
        </section>
      )}
    </div>
  )
}
