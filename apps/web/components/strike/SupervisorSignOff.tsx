'use client'

import { useMemo, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Eraser, Loader2, Lock, PenLine, ShieldCheck } from 'lucide-react'
import {
  strikeAssistedAcknowledgment,
  strikeAssistedChecklist,
  type StrikeAssistedLocale,
} from '@soteria/core/strikeAssisted'
import type { StrikeContent } from '@soteria/core/strikeContent'
import SignaturePad, { type SignaturePadRef } from '@/components/SignaturePad'
import { signInSupervisor, type SupervisorSession } from '@/lib/strike/supervisorAuth'
import { useStrikeCopy } from './player/copy'

interface SupervisorSignOffProps {
  tenantId: string
  attemptId: string
  /** The full module, so safety callouts the worker never saw can be read aloud. */
  content: StrikeContent
  learnerName: string
  moduleTitle: string
  locale: StrikeAssistedLocale
  questionPrompts: string[]
  videosRemaining: number
  onVerified: () => void
}

// The end of an assisted (ADA) session: the supervisor signs in as
// themselves on the worker's device, works through the checklist with the
// worker, and signs. The server rebuilds the checklist and stores its own
// wording; this copy is what the supervisor reads.
export function SupervisorSignOff({
  tenantId, attemptId, content, learnerName, moduleTitle, locale, questionPrompts, videosRemaining, onVerified,
}: SupervisorSignOffProps) {
  const t = useStrikeCopy()
  const checklist = useMemo(() => strikeAssistedChecklist(content, { learnerName, locale }), [content, learnerName, locale])
  const acknowledgment = strikeAssistedAcknowledgment({ learnerName, moduleTitle, locale })
  const [session, setSession] = useState<SupervisorSession | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [signed, setSigned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const padRef = useRef<SignaturePadRef>(null)

  if (videosRemaining > 0) {
    return (
      <section className="placard-surface p-4 sm:p-5">
        <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
          <ShieldCheck className="h-4 w-4" aria-hidden /> {t.signOffTitle}
        </h2>
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Lock className="h-4 w-4 shrink-0" aria-hidden /> {t.signOffLocked(videosRemaining)}
        </p>
      </section>
    )
  }

  async function signIn(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try { setSession(await signInSupervisor(email, password)); setPassword('') }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setBusy(false) }
  }

  async function switchSupervisor() {
    await session?.signOut()
    setSession(null)
    setChecked(new Set())
  }

  async function submit() {
    if (!session) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/strike/assisted/verify', {
        method: 'POST',
        headers: { authorization: `Bearer ${session.accessToken}`, 'x-active-tenant': tenantId, 'content-type': 'application/json' },
        body: JSON.stringify({ attempt_id: attemptId, checked: [...checked], signature_png: padRef.current?.toDataURL() ?? '' }),
      })
      const payload = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((payload as { error?: string }).error ?? 'Sign-off failed')
      await session.signOut()
      onVerified()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const allChecked = checklist.every(item => checked.has(item.key))
  const input = 'min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900'

  return (
    <section aria-labelledby="supervisor-signoff" className="placard-surface space-y-4 p-4 sm:p-5">
      <h2 id="supervisor-signoff" className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300">
        <ShieldCheck className="h-4 w-4" aria-hidden /> {t.signOffTitle}
      </h2>
      <p className="flex items-start gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {t.watchedAll(learnerName)}
      </p>

      {!session ? (
        <form onSubmit={signIn} className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">{t.signOffIntro}</p>
          <label className="block space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t.supervisorEmail}
            <input className={input} type="email" autoComplete="off" inputMode="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label className="block space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t.supervisorPassword}
            <input className={input} type="password" autoComplete="off" required value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <button type="submit" disabled={busy || !email || !password}
            className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-navy px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} {t.signInAsSupervisor}
          </button>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-slate-800">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{t.signedInAs(session.email)}</span>
            <button type="button" onClick={() => void switchSupervisor()} className="min-h-11 text-sm font-semibold text-brand-navy underline-offset-2 hover:underline dark:text-blue-300">
              {t.useDifferentSupervisor}
            </button>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.checklist}</legend>
            {checklist.map(item => (
              <label key={item.key} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg border-2 border-slate-200 px-3 py-3 text-sm text-slate-800 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50 dark:border-slate-700 dark:text-slate-100 dark:has-[:checked]:bg-emerald-950/40">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-emerald-600" checked={checked.has(item.key)}
                  onChange={e => setChecked(prev => {
                    const next = new Set(prev)
                    if (e.target.checked) next.add(item.key)
                    else next.delete(item.key)
                    return next
                  })} />
                <span>
                  {item.text}
                  {item.detail && (
                    <span className="mt-1 block rounded bg-amber-50 px-2 py-1.5 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                      <span className="font-semibold">{t.readAloud}</span> {item.detail}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          {questionPrompts.length > 0 && (
            <details className="rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-700">
              <summary className="cursor-pointer py-1.5 font-semibold text-slate-800 dark:text-slate-100">{t.questionsToAsk}</summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700 dark:text-slate-200">
                {questionPrompts.map(prompt => <li key={prompt}>{prompt}</li>)}
              </ol>
            </details>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.acknowledgment}</h3>
            <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-800 dark:bg-slate-900 dark:text-slate-100">{acknowledgment}</p>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200"><PenLine className="h-4 w-4" aria-hidden /> {t.signHere}</p>
            <SignaturePad ref={padRef} onChange={empty => setSigned(!empty)} />
            <button type="button" onClick={() => padRef.current?.clear()}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
              <Eraser className="h-4 w-4" aria-hidden /> {t.clearSignature}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void submit()} disabled={busy || !allChecked || !signed}
              className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />} {t.signAndComplete}
            </button>
            {(!allChecked || !signed) && <span className="text-sm text-slate-500">{t.tickEverything}</span>}
          </div>
        </>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-rose-600">{error}</p>}
    </section>
  )
}
