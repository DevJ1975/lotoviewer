'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, PlugZap, RotateCcw, Send, Unplug, XCircle } from 'lucide-react'
import { strikeFetch } from '@/lib/strike/clientApi'

interface LrsStatus {
  config: {
    endpoint: string
    auth_username: string
    enabled: boolean
    updated_at: string
    last_success_at: string | null
    last_error: string | null
    last_error_at: string | null
  } | null
  queue: { pending: number; failed: number; sent_24h: number }
}

const input = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'
const secondary = 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'

const SENT_EVENTS = [
  ['attempted', 'a worker starts a module'],
  ['experienced', 'they finish a scene or read a safety callout'],
  ['answered', 'their first try at each practice check, with hints used'],
  ['completed', 'a practice check is solved, and the module once passed'],
  ['passed / failed', 'the graded knowledge check, with the score'],
] as const

// Sends STRIKE progress to the tenant's LMS over xAPI. Any LMS or LRS that
// accepts xAPI works, so there is one connection form rather than a
// connector per vendor.
export function LmsSyncTab({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<LrsStatus | null>(null)
  const [endpoint, setEndpoint] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [busy, setBusy] = useState<'load' | 'save' | 'test' | 'retry' | 'disconnect' | null>('load')
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const apply = useCallback((next: LrsStatus) => {
    setStatus(next)
    setEndpoint(next.config?.endpoint ?? '')
    setUsername(next.config?.auth_username ?? '')
    setEnabled(next.config?.enabled ?? true)
    setPassword('')
  }, [])

  const run = useCallback(async (kind: NonNullable<typeof busy>, call: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try { await call() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }, [])

  useEffect(() => {
    void run('load', async () => apply(await strikeFetch<LrsStatus>('/api/strike/lrs', tenantId)))
  }, [tenantId, run, apply])

  const connected = !!status?.config

  return (
    <div className="space-y-4">
      <section className="placard-surface space-y-4 p-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
            <PlugZap className="h-5 w-5 text-brand-navy" aria-hidden /> Send STRIKE progress to your LMS
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            STRIKE speaks xAPI (also called Tin Can), which most LMSs accept. In your LMS, find its xAPI or LRS settings and create a key for
            Soteria Field, then paste the endpoint, key and secret here. Records go out within about ten minutes and are retried if your LMS is down.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">
            LRS endpoint
            <input className={input} type="url" inputMode="url" autoComplete="off" placeholder="https://your-lms.example.com/xapi/"
              value={endpoint} onChange={e => setEndpoint(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Key (username)
            <input className={input} autoComplete="off" value={username} onChange={e => setUsername(e.target.value)} />
          </label>
          <label className="space-y-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Secret (password)
            <input className={input} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder={connected ? 'Saved. Leave blank to keep it.' : ''} />
          </label>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="h-5 w-5 accent-brand-navy" />
          Send records to this LMS
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null || !endpoint || !username || (!password && !connected)}
            onClick={() => run('save', async () => apply(await strikeFetch<LrsStatus>('/api/strike/lrs', tenantId, {
              method: 'PUT', body: { endpoint, username, password, enabled },
            })))}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Save
          </button>
          <button type="button" disabled={busy !== null || !endpoint} className={secondary}
            onClick={() => run('test', async () => setTestResult(await strikeFetch<{ ok: boolean; message: string }>('/api/strike/lrs', tenantId, {
              body: { action: 'test', endpoint, username, password },
            })))}>
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="h-4 w-4" aria-hidden />} Test connection
          </button>
          {connected && (
            <button type="button" disabled={busy !== null} className={`${secondary} text-rose-700 dark:text-rose-300`}
              onClick={() => {
                if (!window.confirm('Disconnect this LMS? Records not yet sent will be dropped.')) return
                void run('disconnect', async () => apply(await strikeFetch<LrsStatus>('/api/strike/lrs', tenantId, { method: 'DELETE' })))
              }}>
              <Unplug className="h-4 w-4" aria-hidden /> Disconnect
            </button>
          )}
        </div>

        {testResult && (
          <p role="status" className={`flex items-start gap-2 text-sm ${testResult.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
            {testResult.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
            {testResult.message}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      </section>

      {busy === 'load' && !status ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>
      ) : connected && status && (
        <section className="placard-surface space-y-3 p-4 text-sm">
          <h3 className="font-bold text-slate-900 dark:text-slate-100">Delivery</h3>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Waiting to send" value={status.queue.pending} />
            <Stat label="Sent in 24 hours" value={status.queue.sent_24h} />
            <Stat label="Gave up" value={status.queue.failed} tone={status.queue.failed > 0 ? 'bad' : 'plain'} />
          </dl>
          <p className="text-slate-600 dark:text-slate-300">
            Last delivered: {status.config?.last_success_at ? new Date(status.config.last_success_at).toLocaleString() : 'not yet'}
          </p>
          {status.config?.last_error && (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              Last error{status.config.last_error_at ? ` (${new Date(status.config.last_error_at).toLocaleString()})` : ''}: {status.config.last_error}
            </p>
          )}
          {status.queue.failed > 0 && (
            <button type="button" disabled={busy !== null} className={secondary}
              onClick={() => run('retry', async () => apply(await strikeFetch<LrsStatus>('/api/strike/lrs', tenantId, { body: { action: 'retry' } })))}>
              {busy === 'retry' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              Retry records that gave up
            </button>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
        <h3 className="font-bold text-slate-900 dark:text-slate-100">What your LMS receives</h3>
        <ul className="mt-2 space-y-1 text-slate-600 dark:text-slate-300">
          {SENT_EVENTS.map(([verb, when]) => (
            <li key={verb}><span className="font-semibold text-slate-800 dark:text-slate-100">{verb}</span>: {when}</li>
          ))}
        </ul>
        <p className="mt-2 text-slate-500">
          Workers are identified by email so your LMS can match them; workers without one are sent with a stable Soteria Field id.
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: number; tone?: 'plain' | 'bad' }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className={`text-xl font-black tabular-nums ${tone === 'bad' ? 'text-rose-600' : 'text-slate-900 dark:text-slate-100'}`}>{value}</dd>
    </div>
  )
}
