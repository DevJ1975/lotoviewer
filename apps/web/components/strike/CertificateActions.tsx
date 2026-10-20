'use client'

import { useState, type FormEvent } from 'react'
import { Award, CheckCircle2, Loader2, Mail } from 'lucide-react'
import { downloadPdf } from '@/lib/strike/certificate'
import { useStrikeCopy } from './player/copy'

export interface CertificateTransport {
  download: () => Promise<{ pdf: Uint8Array; filename: string }>
  email: (to: string) => Promise<void>
}

// After a pass or a supervisor sign-off: download the certificate, or have
// it emailed to any address the worker chooses (personal or work), since
// many frontline workers have no work email at all.
export function CertificateActions({ transport, defaultEmail }: { transport: CertificateTransport; defaultEmail: string | null }) {
  const t = useStrikeCopy()
  const [busy, setBusy] = useState<'download' | 'email' | null>(null)
  const [showEmail, setShowEmail] = useState(false)
  const [to, setTo] = useState(defaultEmail ?? '')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'download' | 'email', call: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try { await call() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  function send(e: FormEvent) {
    e.preventDefault()
    void run('email', async () => {
      await transport.email(to.trim())
      setSentTo(to.trim())
    })
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" disabled={busy !== null}
          onClick={() => void run('download', async () => {
            const { pdf, filename } = await transport.download()
            downloadPdf(pdf, filename)
          })}
          className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy === 'download' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Award className="h-4 w-4" aria-hidden />} {t.downloadCertificate}
        </button>
        <button type="button" onClick={() => setShowEmail(open => !open)} aria-expanded={showEmail}
          className="motion-press inline-flex min-h-12 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          <Mail className="h-4 w-4" aria-hidden /> {t.emailCertificate}
        </button>
      </div>
      {showEmail && (
        <form onSubmit={send} className="mx-auto flex max-w-md flex-col gap-2 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1 text-left text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t.emailLabel}
            <input type="email" inputMode="email" autoComplete="email" required value={to} onChange={e => setTo(e.target.value)}
              className="min-h-12 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <button type="submit" disabled={busy !== null || !to.trim()}
            className="motion-press inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-brand-navy px-5 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'email' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} {t.send}
          </button>
        </form>
      )}
      {sentTo && (
        <p role="status" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" aria-hidden /> {t.sentTo(sentTo)}
        </p>
      )}
      {error && <p role="alert" className="text-sm font-semibold text-rose-600">{error}</p>}
    </div>
  )
}
