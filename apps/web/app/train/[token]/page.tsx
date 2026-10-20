'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { AlertTriangle, HardHat, Loader2 } from 'lucide-react'
import { parseStrikeContent, type StrikeBlockEventRecord, type StrikeContent } from '@soteria/core/strikeContent'
import { StrikeModuleRunner, type StrikeRunnerTransport, type StrikeSubmitFn, type StrikeSubmitResult } from '@/components/strike/StrikeModuleRunner'
import { LanguageSwitch } from '@/components/strike/LanguageSwitch'
import { isStrikeLocale } from '@/components/strike/player/copy'
import type { QuizAnswerRow, QuizQuestionRow } from '@/components/strike/QuizQuestion'

interface Bootstrap {
  module: { id: string; title: string; description: string | null }
  tenant_id: string
  member_name: string
  locales: string[]
  expires_at: string
  version: { id: string; passing_score: number; content: unknown; locale: string; title: string | null }
  questions: QuizQuestionRow[]
  answers: QuizAnswerRow[]
}

const HEADER_COPY = {
  en: {
    eyebrow: 'Required before your permit · Train now',
    lead: (name: string, pass: number) => [`For `, name, `. Finish every section, then pass the knowledge check (${pass}%). Your supervisor will see your result on the permit.`],
    cantOpen: 'Can’t open this training',
  },
  es: {
    eyebrow: 'Requerido antes de su permiso · Capacítese ahora',
    lead: (name: string, pass: number) => ['Para ', name, `. Termine cada sección y apruebe la evaluación (${pass}%). Su supervisor verá su resultado en el permiso.`],
    cantOpen: 'No se puede abrir esta capacitación',
  },
} as const

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
// token names exactly one worker and one module; the worker picks the
// language, and every call names it so the server serves that version.
export default function TrainNowPage() {
  const { token: rawToken } = useParams<{ token: string }>()
  const token = decodeURIComponent(rawToken)
  const [locale, setLocale] = useState<string | null>(() =>
    typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('es') ? 'es' : null,
  )
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBoot(null)
    kioskCall<Bootstrap>(token, 'bootstrap', { locale }).then(setBoot).catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [token, locale])

  const content = useMemo<StrikeContent | null>(() => {
    if (boot?.version.content == null) return null
    const parsed = parseStrikeContent(boot.version.content)
    return parsed.ok ? parsed.content : null
  }, [boot])

  const servedLocale = boot?.version.locale ?? null
  const transport = useMemo<StrikeRunnerTransport>(() => ({
    start: delivery => kioskCall<{ attempt_id: string; reached: StrikeBlockEventRecord[] }>(token, 'start', { locale: servedLocale, delivery }),
    events: async (attemptId, events) => { await kioskCall(token, 'events', { locale: servedLocale, attempt_id: attemptId, events }) },
    assets: () => kioskCall<{ urls: Record<string, string>; has_download: boolean }>(token, 'assets', { locale: servedLocale }),
    certificate: async attemptId => {
      const { filename, pdf_base64 } = await kioskCall<{ filename: string; pdf_base64: string }>(token, 'certificate', { locale: servedLocale, attempt_id: attemptId })
      return { filename, pdf: Uint8Array.from(atob(pdf_base64), c => c.charCodeAt(0)) }
    },
    emailCertificate: async (attemptId, to) => { await kioskCall(token, 'email_certificate', { locale: servedLocale, attempt_id: attemptId, to }) },
  }), [token, servedLocale])

  const submit = useCallback<StrikeSubmitFn>(
    ({ attempt_id, answers }) => kioskCall<StrikeSubmitResult>(token, 'submit', { locale: servedLocale, attempt_id, answers }),
    [token, servedLocale],
  )

  const copy = HEADER_COPY[servedLocale === 'es' || locale === 'es' ? 'es' : 'en']

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-500" aria-hidden />
        <h1 className="stencil-title text-2xl text-slate-900 dark:text-slate-100">{copy.cantOpen}</h1>
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

  const [before, name, after] = copy.lead(boot.member_name, boot.version.passing_score)
  const title = boot.version.title ?? boot.module.title
  const runnerLocale = isStrikeLocale(boot.version.locale) ? boot.version.locale : 'en'

  return (
    <main lang={runnerLocale} className="mx-auto max-w-3xl space-y-5 px-4 py-6">
      <header className="placard-surface flex items-start gap-3 border-l-8 border-l-brand-yellow p-4">
        <HardHat className="mt-1 h-6 w-6 shrink-0 text-brand-navy" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{copy.eyebrow}</p>
          <h1 className="stencil-title mt-0.5 text-2xl text-slate-900 dark:text-slate-100">{title}</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{before}<strong>{name}</strong>{after}</p>
        </div>
      </header>
      <LanguageSwitch locales={boot.locales} value={boot.version.locale} onChange={setLocale} />

      <StrikeModuleRunner
        key={boot.version.id}
        moduleTitle={title}
        passingScore={boot.version.passing_score}
        content={content}
        questions={boot.questions}
        answers={boot.answers}
        transport={transport}
        submit={submit}
        learnerName={boot.member_name.split(' ')[0] ?? null}
        learnerFullName={boot.member_name}
        locale={runnerLocale}
        tenantId={boot.tenant_id}
        learnerEmail={null}
      />
    </main>
  )
}
