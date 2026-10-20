'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Download, Loader2, Lock, PlayCircle, RotateCcw, Send } from 'lucide-react'
import { strikeAssistedContent } from '@soteria/core/strikeAssisted'
import type { StrikeBlockEventRecord, StrikeContent } from '@soteria/core/strikeContent'
import { StrikeBlockPlayer } from './player/StrikeBlockPlayer'
import { useBlockEventQueue, type QueuedBlockEvent } from './player/useBlockEventQueue'
import { STRIKE_COPY, StrikeCopyProvider, type StrikeLocale } from './player/copy'
import { QuizQuestion, type QuizAnswerRow, type QuizQuestionRow, type QuizResponse } from './QuizQuestion'
import { PassCelebration } from './PassCelebration'
import { CertificateActions } from './CertificateActions'
import { SupervisorSignOff } from './SupervisorSignOff'

export interface StrikeSubmitResult {
  attempt_id: string
  scorePercent: number
  passed: boolean
  missedQuestionIds: string[]
  missedFeedback: { question_id: string; explanation: string | null }[]
}

export type StrikeDelivery = 'standard' | 'assisted'

/** How the runner reaches the server: the signed-in and kiosk flows authenticate differently. */
export interface StrikeRunnerTransport {
  start: (delivery: StrikeDelivery) => Promise<{ attempt_id: string; reached: StrikeBlockEventRecord[] }>
  events: (attemptId: string, events: QueuedBlockEvent[]) => Promise<void>
  assets: () => Promise<{ urls: Record<string, string>; has_download: boolean }>
  download?: () => Promise<string>
  certificate: (attemptId: string) => Promise<{ pdf: Uint8Array; filename: string }>
  emailCertificate: (attemptId: string, to: string) => Promise<void>
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
  /** First name for the greeting; the full name goes on the supervisor checklist. */
  learnerName: string | null
  learnerFullName: string
  locale: StrikeLocale
  /** Sent with the supervisor's own token when they sign off an assisted session. */
  tenantId: string
  /** Prefills "Email my certificate"; workers may send it anywhere. */
  learnerEmail: string | null
  onPassed?: () => void
  coach?: ReactNode
}

export function StrikeModuleRunner(props: StrikeModuleRunnerProps) {
  return (
    <StrikeCopyProvider value={STRIKE_COPY[props.locale]}>
      <Runner {...props} />
    </StrikeCopyProvider>
  )
}

function Runner({
  moduleTitle, passingScore, content, questions, answers, transport, submit: submitAttempt, legacyMedia,
  learnerName, learnerFullName, locale, tenantId, learnerEmail, onPassed, coach,
}: StrikeModuleRunnerProps) {
  const t = STRIKE_COPY[locale]
  const [delivery, setDelivery] = useState<StrikeDelivery>('standard')
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
  const [verified, setVerified] = useState(false)
  const [round, setRound] = useState(0)

  const assisted = delivery === 'assisted'
  const playerContent = useMemo(() => (content && assisted ? strikeAssistedContent(content) : content), [content, assisted])

  const sendEvents = useCallback(async (events: QueuedBlockEvent[]) => {
    if (attemptId) await transport.events(attemptId, events)
  }, [attemptId, transport])
  const { enqueue, flush } = useBlockEventQueue(sendEvents)

  useEffect(() => {
    if (!content) return
    let cancelled = false
    setInitialReached(null)
    Promise.all([transport.start(delivery), transport.assets()])
      .then(([opened, assets]) => {
        if (cancelled) return
        setAttemptId(opened.attempt_id)
        setInitialReached(opened.reached)
        setUrls(assets.urls)
        setHasDownload(assets.has_download)
      })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [content, transport, round, delivery])

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
  const finished = verified || !!result?.passed

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await flush()
      const graded = await submitAttempt({ attempt_id: attemptId, answers: responses })
      setResult(graded)
      if (graded.passed) onPassed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  function restart(nextDelivery: StrikeDelivery = delivery) {
    setResult(null)
    setResponses({})
    setAttemptId(null)
    setMissing([])
    setDelivery(nextDelivery)
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

  const certificate = attemptId && (
    <CertificateActions
      defaultEmail={learnerEmail}
      transport={{ download: () => transport.certificate(attemptId), email: to => transport.emailCertificate(attemptId, to) }}
    />
  )
  const explanationById = new Map(result?.missedFeedback.map(f => [f.question_id, f.explanation]) ?? [])

  return (
    // Room at the bottom so the floating coach button never covers Submit.
    <div lang={t.lang} className={`space-y-6 ${coach ? 'pb-20' : ''}`}>
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {content && !finished && (
        <fieldset className="placard-surface p-3 sm:p-4">
          <legend className="px-1 text-sm font-bold text-slate-800 dark:text-slate-100">{t.deliveryQuestion}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(['standard', 'assisted'] as const).map(option => (
              <label key={option} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border-2 border-slate-200 px-3 py-2.5 has-[:checked]:border-brand-navy has-[:checked]:bg-blue-50 dark:border-slate-700 dark:has-[:checked]:bg-blue-950/40">
                <input type="radio" name="strike-delivery" className="mt-0.5 h-5 w-5 shrink-0 accent-brand-navy"
                  checked={delivery === option} onChange={() => restart(option)} />
                <span>
                  <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">{option === 'standard' ? t.deliveryStandard : t.deliveryAssisted}</span>
                  <span className="block text-sm text-slate-600 dark:text-slate-300">{option === 'standard' ? t.deliveryStandardHelp : t.deliveryAssistedHelp}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {playerContent ? (
        initialReached === null ? (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-900">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label={t.loadingModule} />
          </div>
        ) : (
          <>
            {hasDownload && transport.download && (
              <div className="flex justify-end">
                <button type="button" onClick={download} disabled={downloading}
                  className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-brand-navy dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
                  {t.downloadVideo}
                </button>
              </div>
            )}
            <StrikeBlockPlayer
              key={`${attemptId}-${round}`}
              content={playerContent}
              urls={urls}
              seed={attemptId ?? 'preview'}
              initialReached={initialReached}
              onEvent={enqueue}
              onProgress={setMissing}
              assisted={assisted}
            />
          </>
        )
      ) : legacyMedia}

      {assisted && content ? (
        verified ? (
          <PassCelebration moduleTitle={moduleTitle} outcome={{ kind: 'verified' }} learnerName={learnerName} actions={certificate} />
        ) : attemptId && initialReached !== null && (
          <SupervisorSignOff
            tenantId={tenantId}
            attemptId={attemptId}
            content={content}
            learnerName={learnerFullName}
            moduleTitle={moduleTitle}
            locale={locale}
            questionPrompts={questions.map(q => q.prompt)}
            videosRemaining={missing.length}
            onVerified={() => { setVerified(true); onPassed?.() }}
          />
        )
      ) : (
        <section aria-labelledby="knowledge-check" className="placard-surface p-4 sm:p-5">
          <h2 id="knowledge-check" className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
            <PlayCircle className="h-4 w-4" aria-hidden />
            {t.knowledgeCheck(passingScore)}
          </h2>

          {quizLocked ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <Lock className="h-4 w-4" aria-hidden />
              {t.finishSections(missing.length)}
            </p>
          ) : result?.passed ? (
            <PassCelebration moduleTitle={moduleTitle} outcome={{ kind: 'score', scorePercent: result.scorePercent }} learnerName={learnerName} actions={certificate} />
          ) : (
            <>
              {questions.length === 0 ? (
                <label className="mt-4 flex min-h-12 items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
                  <input type="checkbox" checked={responses.acknowledgement === true}
                    onChange={e => setResponses({ acknowledgement: e.target.checked })} className="mt-0.5 h-5 w-5 shrink-0 accent-brand-navy" />
                  {t.reviewedAck}
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
                          {explanationById.get(question.id) ?? t.reviewTopic}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                {result && !result.passed ? (
                  <button type="button" onClick={() => restart()}
                    className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-navy px-5 py-2 text-sm font-semibold text-white">
                    <RotateCcw className="h-4 w-4" aria-hidden /> {t.tryAgain}
                  </button>
                ) : (
                  <button type="button" onClick={submit} disabled={submitting || !allAnswered}
                    className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-navy px-5 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-50">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                    {t.submit}
                  </button>
                )}
                {result && !result.passed && (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
                    <CheckCircle2 className="h-4 w-4" aria-hidden />
                    {t.scoreShort(result.scorePercent, passingScore)}
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {coach}
    </div>
  )
}
