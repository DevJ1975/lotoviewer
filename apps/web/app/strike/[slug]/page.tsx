'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Loader2, Video } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { StrikeVideoPlayer, type WatchProgress } from '@/components/strike/StrikeVideoPlayer'
import { supabase } from '@/lib/supabase'
import { strikeFetch } from '@/lib/strike/clientApi'
import { parseStrikeContent, type StrikeContent } from '@soteria/core/strikeContent'
import { StrikeModuleRunner, type StrikeRunnerTransport, type StrikeSubmitFn, type StrikeSubmitResult } from '@/components/strike/StrikeModuleRunner'
import type { QuizAnswerRow, QuizQuestionRow } from '@/components/strike/QuizQuestion'
import type { StrikeBlockEventRecord } from '@soteria/core/strikeContent'

interface ModuleRow {
  id: string
  tenant_id: string | null
  library_scope: 'global' | 'tenant'
  title: string
  description: string | null
  category: string | null
  slug: string
}

interface VersionRow {
  id: string
  module_id: string
  version_number: number
  transcript: string | null
  duration_seconds: number | null
  passing_score: number
  content: unknown
}

interface MediaSource {
  provider: 'vimeo' | null
  url: string | null
}

type MediaRequestResult =
  | { ok: true; media: MediaSource }
  | { ok: false; notice: string }

// Playback URLs are short-lived and minted server-side so every view is
// authenticated, rate-limited, and audit-logged. Called again on expiry.
async function requestPlaybackUrl(
  moduleId: string,
  moduleVersionId: string,
  tenantId: string,
): Promise<MediaRequestResult> {
  const { data: sessionData } = await supabase.auth.getSession()
  const token = sessionData.session?.access_token
  if (!token) return { ok: false, notice: 'Sign in again to load the video.' }

  const res = await fetch(`/api/strike/${moduleId}/media`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-active-tenant': tenantId,
    },
    body: JSON.stringify({ module_version_id: moduleVersionId }),
  })
  const payload = await res.json()
  if (!res.ok) return { ok: false, notice: payload.error ?? 'Video is unavailable right now.' }
  return { ok: true, media: payload as MediaSource }
}

export default function StrikeModulePage() {
  const params = useParams<{ slug: string }>()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { tenant } = useTenant()
  const { email } = useAuth()
  const [module, setModule] = useState<ModuleRow | null>(null)
  const [version, setVersion] = useState<VersionRow | null>(null)
  const [questions, setQuestions] = useState<QuizQuestionRow[]>([])
  const [answers, setAnswers] = useState<QuizAnswerRow[]>([])
  const [media, setMedia] = useState<MediaSource | null>(null)
  const [videoNotice, setVideoNotice] = useState<string | null>(null)
  const watchProgressRef = useRef<WatchProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const assignmentId = searchParams.get('assignment') ?? null

  const load = useCallback(async () => {
    if (!tenant?.id || !params.slug) {
      setLoading(false)
      setModule(null)
      setVersion(null)
      setQuestions([])
      setAnswers([])
      setMedia(null)
      setVideoNotice(null)
      return
    }
    setLoading(true)
    setError(null)
    setMedia(null)
    setVideoNotice(null)

    try {
      const { data: moduleRows, error: moduleErr } = await supabase
        .from('strike_modules')
        .select('id,tenant_id,library_scope,title,description,category,slug')
        .eq('slug', params.slug)
        .eq('status', 'published')
        .limit(10)
      if (moduleErr) throw moduleErr
      const moduleRow = ((moduleRows ?? []) as ModuleRow[]).find(row => row.tenant_id === tenant.id)
        ?? ((moduleRows ?? []) as ModuleRow[]).find(row => row.library_scope === 'global')
        ?? null
      if (!moduleRow) {
        setModule(null)
        setLoading(false)
        return
      }
      const nextModule = moduleRow as ModuleRow
      setModule(nextModule)

      const { data: versions, error: versionErr } = await supabase
        .from('strike_module_versions')
        .select('id,module_id,version_number,transcript,duration_seconds,passing_score,content')
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
        .select('id,question_type,prompt,sort_order,required,points')
        .eq('module_version_id', nextVersion.id)
        .eq('graded', true)
        .order('sort_order', { ascending: true })
      if (questionErr) throw questionErr
      const nextQuestions = (questionRows ?? []) as QuizQuestionRow[]
      setQuestions(nextQuestions)

      if (nextQuestions.length > 0) {
        const { data: answerRows, error: answerErr } = await supabase
          .from('strike_quiz_answers')
          .select('id,question_id,answer_text,sort_order')
          .in('question_id', nextQuestions.map(q => q.id))
          .order('sort_order', { ascending: true })
        if (answerErr) throw answerErr
        setAnswers((answerRows ?? []) as QuizAnswerRow[])
      } else {
        setAnswers([])
      }

      if (nextVersion.content == null) {
        const mediaResult = await requestPlaybackUrl(nextModule.id, nextVersion.id, tenant.id)
        if (mediaResult.ok) {
          setMedia(mediaResult.media)
        } else {
          setVideoNotice(mediaResult.notice)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // The React Compiler infers `tenant` (object) as the dependency; listing
    // the narrower `tenant?.id` here blocks compilation of the component.
  }, [params.slug, tenant])

  useEffect(() => { void load() }, [load])

  const content = useMemo<StrikeContent | null>(() => {
    if (version?.content == null) return null
    const parsed = parseStrikeContent(version.content)
    return parsed.ok ? parsed.content : null
  }, [version])

  const tenantId = tenant?.id ?? ''
  const submitAttempt = useCallback<StrikeSubmitFn>(({ attempt_id, answers: submitted }) => {
    if (!module || !version) return Promise.reject(new Error('Module is not loaded'))
    return strikeFetch<StrikeSubmitResult>(`/api/strike/${module.id}/submit`, tenantId, {
      body: {
        module_version_id: version.id,
        assignment_id: assignmentId,
        attempt_id,
        answers: submitted,
        watch: watchProgressRef.current,
      },
    })
  }, [module, version, tenantId, assignmentId])

  const transport = useMemo<StrikeRunnerTransport | null>(() => {
    if (!module || !version) return null
    const base = `/api/strike/${module.id}`
    return {
      start: () => strikeFetch<{ attempt_id: string; reached: StrikeBlockEventRecord[] }>(`${base}/start`, tenantId, {
        body: { module_version_id: version.id, assignment_id: assignmentId },
      }),
      events: async (attemptId, events) => {
        await strikeFetch(`${base}/events`, tenantId, { body: { module_version_id: version.id, attempt_id: attemptId, events } })
      },
      assets: () => strikeFetch<{ urls: Record<string, string>; has_download: boolean }>(
        `${base}/assets?version=${version.id}`, tenantId,
      ),
      download: async () => (await strikeFetch<{ url: string }>(`${base}/assets?version=${version.id}&download=1`, tenantId)).url,
    }
  }, [module, version, tenantId, assignmentId])

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

      {version && transport && (
        <StrikeModuleRunner
          moduleTitle={module.title}
          passingScore={version.passing_score}
          content={content}
          questions={questions}
          answers={answers}
          transport={transport}
          submit={submitAttempt}
          learnerName={null}
          legacyMedia={(
            <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
              {media?.url ? (
                <StrikeVideoPlayer
                  src={media.url}
                  watermarkText={email ?? 'SoteriaField viewer'}
                  onProgress={progress => { watchProgressRef.current = progress }}
                />
              ) : (
                <div className="flex aspect-video items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                  <div className="text-center">
                    <Video className="mx-auto h-8 w-8" />
                    <p className="mt-2 text-sm">{videoNotice ?? 'No video file attached yet.'}</p>
                  </div>
                </div>
              )}
              {version.transcript && (
                <details className="mt-4 rounded-lg border border-slate-100 p-3 text-sm dark:border-slate-800">
                  <summary className="cursor-pointer font-semibold text-slate-900 dark:text-slate-100">Transcript</summary>
                  <p className="mt-2 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{version.transcript}</p>
                </details>
              )}
            </section>
          )}
        />
      )}
    </div>
  )
}
