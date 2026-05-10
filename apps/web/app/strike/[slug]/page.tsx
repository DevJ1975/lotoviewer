'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, PlayCircle, Send, Video } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import type { StrikeQuestionType } from '@soteria/core/strike'

interface ModuleRow {
  id: string
  title: string
  description: string | null
  category: string | null
  slug: string
}

interface VersionRow {
  id: string
  module_id: string
  version_number: number
  video_path: string | null
  captions_path: string | null
  transcript: string | null
  duration_seconds: number | null
  passing_score: number
}

interface QuestionRow {
  id: string
  question_type: StrikeQuestionType
  prompt: string
  explanation: string | null
  sort_order: number
  required: boolean
  points: number
}

interface AnswerRow {
  id: string
  question_id: string
  answer_text: string
  sort_order: number
}

interface SubmitResult {
  scorePercent: number
  passed: boolean
  missedQuestionIds: string[]
}

export default function StrikeModulePage() {
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { tenant } = useTenant()
  const { userId } = useAuth()
  const [module, setModule] = useState<ModuleRow | null>(null)
  const [version, setVersion] = useState<VersionRow | null>(null)
  const [questions, setQuestions] = useState<QuestionRow[]>([])
  const [answers, setAnswers] = useState<AnswerRow[]>([])
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null)
  const [responses, setResponses] = useState<Record<string, string[] | string | boolean>>({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SubmitResult | null>(null)

  const assignmentId = searchParams.get('assignment') ?? null

  const load = useCallback(async () => {
    if (!tenant?.id || !params.slug) return
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const { data: moduleRow, error: moduleErr } = await supabase
        .from('strike_modules')
        .select('id,title,description,category,slug')
        .eq('slug', params.slug)
        .eq('status', 'published')
        .maybeSingle()
      if (moduleErr) throw moduleErr
      if (!moduleRow) {
        setModule(null)
        setLoading(false)
        return
      }
      const nextModule = moduleRow as ModuleRow
      setModule(nextModule)

      const { data: versions, error: versionErr } = await supabase
        .from('strike_module_versions')
        .select('id,module_id,version_number,video_path,captions_path,transcript,duration_seconds,passing_score')
        .eq('module_id', nextModule.id)
        .eq('status', 'published')
        .order('version_number', { ascending: false })
        .limit(1)
      if (versionErr) throw versionErr
      const nextVersion = (versions?.[0] ?? null) as VersionRow | null
      setVersion(nextVersion)

      if (!nextVersion) {
        setQuestions([])
        setAnswers([])
        setLoading(false)
        return
      }

      const { data: questionRows, error: questionErr } = await supabase
        .from('strike_quiz_questions')
        .select('id,question_type,prompt,explanation,sort_order,required,points')
        .eq('module_version_id', nextVersion.id)
        .order('sort_order', { ascending: true })
      if (questionErr) throw questionErr
      const nextQuestions = (questionRows ?? []) as QuestionRow[]
      setQuestions(nextQuestions)

      if (nextQuestions.length > 0) {
        const { data: answerRows, error: answerErr } = await supabase
          .from('strike_quiz_answers')
          .select('id,question_id,answer_text,sort_order')
          .in('question_id', nextQuestions.map(q => q.id))
          .order('sort_order', { ascending: true })
        if (answerErr) throw answerErr
        setAnswers((answerRows ?? []) as AnswerRow[])
      } else {
        setAnswers([])
      }

      if (nextVersion.video_path) {
        const { data } = await supabase.storage
          .from('strike-media')
          .createSignedUrl(nextVersion.video_path, 60 * 30)
        setSignedVideoUrl(data?.signedUrl ?? null)
      } else {
        setSignedVideoUrl(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [params.slug, tenant?.id])

  useEffect(() => { void load() }, [load])

  const answersByQuestion = useMemo(() => {
    const map = new Map<string, AnswerRow[]>()
    for (const answer of answers) {
      const list = map.get(answer.question_id) ?? []
      list.push(answer)
      map.set(answer.question_id, list)
    }
    return map
  }, [answers])

  async function submit() {
    if (!module || !version || !userId) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    const { data: sessionData } = await supabase.auth.getSession()
    const token = sessionData.session?.access_token
    if (!token) {
      setSubmitting(false)
      setError('Sign in again to submit this module.')
      return
    }
    const res = await fetch(`/api/strike/${module.id}/submit`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-active-tenant': tenant?.id ?? '',
      },
      body: JSON.stringify({
        module_version_id: version.id,
        assignment_id: assignmentId,
        answers: responses,
      }),
    })
    const payload = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setError(payload.error ?? 'Submission failed')
      return
    }
    setResult(payload as SubmitResult)
  }

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }

  if (!module) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Link href="/strike" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-brand-navy"><ArrowLeft className="h-4 w-4" /> STRIKE</Link>
        <div className="mt-6 rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Module not found</h1>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="space-y-3">
        <button type="button" onClick={() => router.push('/strike')} className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" />
          STRIKE library
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{module.title}</h1>
            <p className="max-w-3xl text-sm text-slate-500 dark:text-slate-400">
              {module.description ?? 'Short, field-ready safety instruction.'}
            </p>
          </div>
          {version && (
            <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              v{version.version_number} · pass {version.passing_score}%
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        {signedVideoUrl ? (
          <video controls className="aspect-video w-full rounded-lg bg-black" src={signedVideoUrl} />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <div className="text-center">
              <Video className="mx-auto h-8 w-8" />
              <p className="mt-2 text-sm">No video file attached yet.</p>
            </div>
          </div>
        )}
        {version?.transcript && (
          <details className="mt-4 rounded-lg border border-slate-100 p-3 text-sm dark:border-slate-800">
            <summary className="cursor-pointer font-semibold text-slate-900 dark:text-slate-100">Transcript</summary>
            <p className="mt-2 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{version.transcript}</p>
          </details>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase text-slate-500 dark:text-slate-400">
          <PlayCircle className="h-4 w-4" />
          Knowledge check
        </h2>
        {questions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No quiz questions are attached. Submitting records an acknowledgement.</p>
        ) : (
          <div className="mt-4 space-y-4">
            {questions.map((question, index) => (
              <Question
                key={question.id}
                index={index}
                question={question}
                answers={answersByQuestion.get(question.id) ?? []}
                value={responses[question.id]}
                onChange={value => setResponses(prev => ({ ...prev, [question.id]: value }))}
              />
            ))}
          </div>
        )}

        {questions.length === 0 && (
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={responses.acknowledgement === true}
              onChange={e => setResponses({ acknowledgement: e.target.checked })}
              className="mt-1"
            />
            I reviewed the instruction and understand the task expectations.
          </label>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !version || (questions.length === 0 && responses.acknowledgement !== true)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit
          </button>
          {result && (
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${result.passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
              <CheckCircle2 className="h-4 w-4" />
              {result.scorePercent}% · {result.passed ? 'complete' : 'try again'}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}

function Question({
  index,
  question,
  answers,
  value,
  onChange,
}: {
  index: number
  question: QuestionRow
  answers: AnswerRow[]
  value: string[] | string | boolean | undefined
  onChange: (value: string[] | string | boolean) => void
}) {
  const selected = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  const isMulti = question.question_type === 'select_all'
  const isAck = question.question_type === 'acknowledgement'

  return (
    <fieldset className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
      <legend className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {index + 1}. {question.prompt}
      </legend>
      {isAck ? (
        <label className="mt-3 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} className="mt-1" />
          I acknowledge this requirement.
        </label>
      ) : (
        <div className="mt-3 space-y-2">
          {answers.map(answer => (
            <label key={answer.id} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type={isMulti ? 'checkbox' : 'radio'}
                name={question.id}
                value={answer.id}
                checked={selected.includes(answer.id)}
                onChange={e => {
                  if (isMulti) {
                    const next = e.target.checked
                      ? Array.from(new Set([...selected, answer.id]))
                      : selected.filter(id => id !== answer.id)
                    onChange(next)
                  } else {
                    onChange(answer.id)
                  }
                }}
                className="mt-1"
              />
              {answer.answer_text}
            </label>
          ))}
        </div>
      )}
      {question.explanation && <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{question.explanation}</p>}
    </fieldset>
  )
}
