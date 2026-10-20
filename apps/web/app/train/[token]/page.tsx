'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, HardHat, Loader2 } from 'lucide-react'
import { parseStrikeContent, type StrikeBlockEventRecord, type StrikeContent } from '@soteria/core/strikeContent'
import { StrikeModuleRunner, type StrikeRunnerTransport, type StrikeSubmitFn, type StrikeSubmitResult } from '@/components/strike/StrikeModuleRunner'
import type { QuizAnswerRow, QuizQuestionRow } from '@/components/strike/QuizQuestion'

interface Bootstrap {
  module: { id: string; title: string; description: string | null }
  member_name: string
  expires_at: string
  version: { id: string; passing_score: number; content: unknown }
  questions: QuizQuestionRow[]
  answers: QuizAnswerRow[]
}

async function kioskCall<T>(token: string, action: string, extra: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('/api/strike/kiosk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, action, ...extra }),
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((payload as { error?: string }).error ?? 'Request failed')
  return payload as T
}

// "Train now": a worker on a permit completes required training on their
// own phone, no login. Reached from a QR on the permit page. The signed
// token names exactly one worker and one module.
export default function TrainNowPage() {
  const { token: rawToken } = useParams<{ token: string }>()
  const token = decodeURIComponent(rawToken)
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    kioskCall<Bootstrap>(token, 'bootstrap').then(setBoot).catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [token])

  const content = useMemo<StrikeContent | null>(() => {
    if (boot?.version.content == null) return null
    const parsed = parseStrikeContent(boot.version.content)
    return parsed.ok ? parsed.content : null
  }, [boot])

  const transport = useMemo<StrikeRunnerTransport>(() => ({
    start: () => kioskCall<{ attempt_id: string; reached: StrikeBlockEventRecord[] }>(token, 'start'),
    events: async (attemptId, events) => { await kioskCall(token, 'events', { attempt_id: attemptId, events }) },
    assets: () => kioskCall<{ urls: Record<string, string>; has_download: boolean }>(token, 'assets'),
  }), [token])

  const submit = useCallback<StrikeSubmitFn>(
    ({ attempt_id, answers }) => kioskCall<StrikeSubmitResult>(token, 'submit', { attempt_id, answers }),
    [token],
  )

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden />
        <h1 className="stencil-title text-2xl text-slate-900 dark:text-slate-100">Can’t open this training</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">{error}</p>
      </main>
    )
  }

  if (!boot) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label="Loading training" />
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <header className="placard-surface flex items-start gap-3 border-l-8 border-l-brand-yellow p-4">
        <HardHat className="mt-1 h-6 w-6 shrink-0 text-brand-navy" aria-hidden />
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">Required before your permit · Train now</p>
          <h1 className="stencil-title mt-0.5 text-2xl text-slate-900 dark:text-slate-100">{boot.module.title}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            For <strong>{boot.member_name}</strong>. Finish every section, then pass the knowledge check ({boot.version.passing_score}%).
            Your supervisor will see your result on the permit.
          </p>
        </div>
      </header>

      <StrikeModuleRunner
        moduleTitle={boot.module.title}
        passingScore={boot.version.passing_score}
        content={content}
        questions={boot.questions}
        answers={boot.answers}
        transport={transport}
        submit={submit}
        learnerName={boot.member_name.split(' ')[0] ?? null}
      />
    </main>
  )
}
