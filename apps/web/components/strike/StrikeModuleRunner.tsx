'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Award, CheckCircle2, Download, Loader2, Lock, PlayCircle, RotateCcw, Send } from 'lucide-react'
import type { StrikeBlockEventRecord, StrikeContent } from '@soteria/core/strikeContent'
import { StrikeBlockPlayer } from './player/StrikeBlockPlayer'
import { useBlockEventQueue, type QueuedBlockEvent } from './player/useBlockEventQueue'
import { QuizQuestion, type QuizAnswerRow, type QuizQuestionRow, type QuizResponse } from './QuizQuestion'
import { PassCelebration } from './PassCelebration'
import { buildCertificatePdf, downloadPdf } from '@/lib/strike/certificate'

export interface StrikeSubmitResult {
  attempt_id: string
  scorePercent: number
  passed: boolean
  missedQuestionIds: string[]
  missedFeedback: { question_id: string; explanation: string | null }[]
}

/** How the runner reaches the server: the signed-in and kiosk flows authenticate differently. */
export interface StrikeRunnerTransport {
  start: () => Promise<{ attempt_id: string; reached: StrikeBlockEventRecord[] }>
  events: (attemptId: string, events: QueuedBlockEvent[]) => Promise<void>
  assets: () => Promise<{ urls: Record<string, string>; has_download: boolean }>
  download?: () => Promise<string>
}

export type StrikeSubmitFn = (body: { attempt_id: string | null; answers: Record<string, QuizResponse> }) => Promise<StrikeSubmitResult>

interface StrikeModuleRunnerProps {
  moduleTitle: string
  passingScore: number
  content: StrikeContent | null
  questions: QuizQuestionRow[]
  answers: QuizAnswerRow[]
  transport: StrikeRunnerTransport
  /** Kept apart from the transport so callers may close over refs (legacy watch progress). */
  submit: StrikeSubmitFn
  /** Legacy video-only modules render their player here. */
  legacyMedia?: ReactNode
  learnerName: string | null
  /** Enables the completion certificate download after a pass. */
  certificate?: { learnerName: string; organization: string | null }
  onPassed?: (result: StrikeSubmitResult) => void
  coach?: ReactNode
}

export function StrikeModuleRunner({
  moduleTitle, passingScore, content, questions, answers, transport, submit: submitAttempt, legacyMedia, learnerName, certificate, onPassed, coach,
}: StrikeModuleRunnerProps) {
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const [initialReached, setInitialReached] = useState<StrikeBlockEventRecord[] | null>(content ? null : [])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [hasDownload, setHasDownload] = useState(false)
  const [missing, setMissing] = useState<string[]>([])
  const [responses, setResponses] = useState<Record<string, QuizResponse>>({})
  const [submitting, setSubmitting] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<StrikeSubmitResult | null>(null)
  const [round, setRound] = useState(0)

  const sendEvents = useCallback(async (events: QueuedBlockEvent[]) => {
    if (attemptId) await transport.events(attemptId, events)
  }, [attemptId, transport])
  const { enqueue, flush } = useBlockEventQueue(sendEvents)

  useEffect(() => {
    if (!content) return
    let cancelled = false
    setInitialReached(null)
    Promise.all([transport.start(), transport.assets()])
      .then(([opened, assets]) => {
        if (cancelled) return
        setAttemptId(opened.attempt_id)
        setInitialReached(opened.reached)
        setUrls(assets.urls)
        setHasDownload(assets.has_download)
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [content, transport, round])

  const answersByQuestion = useMemo(() => {
    const map = new Map<string, QuizAnswerRow[]>()
    for (const answer of answers) {
      const list = map.get(answer.question_id) ?? []
      list.push(answer)
      map.set(answer.question_id, list)
    }
    return map
  }, [answers])

  const quizLocked = !!content && missing.length > 0
  const allAnswered = questions.length === 0
    ? responses.acknowledgement === true
    : questions.filter(q => q.required).every(q => {
        const value = responses[q.id]
        return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== ''
      })

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await flush()
      const graded = await submitAttempt({ attempt_id: attemptId, answers: responses })
      setResult(graded)
      if (graded.passed) onPassed?.(graded)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  function retake() {
    setResult(null)
    setResponses({})
    setAttemptId(null)
    setRound(r => r + 1)
  }

  async function download() {
    if (!transport.download) return
    setDownloading(true)
    try {
      window.location.assign(await transport.download())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setDownloading(false)
    }
  }

  const explanationById = new Map(result?.missedFeedback.map(f => [f.question_id, f.explanation]) ?? [])

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {content ? (
        initialReached === null ? (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading module" />
          </div>
        ) : (
          <>
            {hasDownload && transport.download && (
              <div className="flex justify-end">
                <button type="button" onClick={download} disabled={downloading}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-navy dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                  Download video
                </button>
              </div>
            )}
            <StrikeBlockPlayer
              key={`${attemptId}-${round}`}
              content={content}
              urls={urls}
              seed={attemptId ?? 'preview'}
              initialReached={initialReached}
              onEvent={enqueue}
              onProgress={setMissing}
            />
          </>
        )
      ) : legacyMedia}

      <section aria-labelledby="knowledge-check" className="placard-surface p-4 sm:p-5">
        <h2 id="knowledge-check" className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
          <PlayCircle className="h-4 w-4" aria-hidden />
          Knowledge check · pass {passingScore}%
        </h2>

        {quizLocked ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Lock className="h-4 w-4" aria-hidden />
            Finish every section above to unlock the knowledge check ({missing.length} remaining).
          </p>
        ) : result?.passed ? (
          <PassCelebration
            moduleTitle={moduleTitle}
            scorePercent={result.scorePercent}
            learnerName={learnerName}
            actions={certificate && (
              <button type="button" onClick={async () => {
                const bytes = await buildCertificatePdf({
                  learnerName: certificate.learnerName,
                  moduleTitle,
                  organization: certificate.organization,
                  scorePercent: result.scorePercent,
                  completedAt: new Date(),
                  reference: result.attempt_id,
                })
                downloadPdf(bytes, `${moduleTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-certificate.pdf`)
              }}
                className="motion-press inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white">
                <Award className="h-4 w-4" aria-hidden /> Download certificate
              </button>
            )}
          />
        ) : (
          <>
            {questions.length === 0 ? (
              <label className="mt-4 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" checked={responses.acknowledgement === true}
                  onChange={e => setResponses({ acknowledgement: e.target.checked })} className="mt-1" />
                I reviewed the instruction and understand the task expectations.
              </label>
            ) : (
              <div className="mt-4 space-y-4">
                {questions.map((question, index) => (
                  <div key={question.id}>
                    <QuizQuestion
                      index={index}
                      question={question}
                      answers={answersByQuestion.get(question.id) ?? []}
                      value={responses[question.id]}
                      onChange={value => setResponses(prev => ({ ...prev, [question.id]: value }))}
                    />
                    {result && explanationById.has(question.id) && (
                      <p className="mt-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                        {explanationById.get(question.id) ?? 'Review this topic and try again.'}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              {result && !result.passed ? (
                <button type="button" onClick={retake}
                  className="motion-press inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white">
                  <RotateCcw className="h-4 w-4" aria-hidden /> Try again
                </button>
              ) : (
                <button type="button" onClick={submit} disabled={submitting || !allAnswered}
                  className="motion-press inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50">
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                  Submit
                </button>
              )}
              {result && !result.passed && (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
                  <CheckCircle2 className="h-4 w-4" aria-hidden />
                  {result.scorePercent}%. You need {passingScore}%. Review the notes above, then try again.
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {coach}
    </div>
  )
}
