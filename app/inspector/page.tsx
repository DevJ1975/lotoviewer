'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck, ShieldAlert } from 'lucide-react'

interface InspectorCsPermit {
  id:           string
  serial:       string
  spaceId:      string
  startedAt:    string
  expiresAt:    string
  status:       'pending_signature' | 'active' | 'expired' | 'canceled'
  cancelReason: string | null
  cancelDate:   string | null
}

interface InspectorHotWorkPermit {
  id:           string
  serial:       string
  workLocation: string
  startedAt:    string
  expiresAt:    string
  status:       string
  cancelReason: string | null
  cancelDate:   string | null
}

interface LookupResponse {
  window: { start: string; end: string; label: string; exp: number }
  csPermits:      InspectorCsPermit[]
  hotWorkPermits: InspectorHotWorkPermit[]
}

const STATUS_BG: Record<string, string> = {
  active:             'bg-emerald-100 text-emerald-800',
  pending_signature:  'bg-amber-100 text-amber-800',
  expired:            'bg-rose-100 text-rose-800',
  canceled:           'bg-slate-100 text-slate-700',
  post_watch:         'bg-blue-100 text-blue-800',
}

// next/navigation requires components that read searchParams to be
// wrapped in Suspense in the App Router. The actual page is the
// inner component; the export is the suspense wrapper.

export default function InspectorPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    }>
      <InspectorView />
    </Suspense>
  )
}

function InspectorView() {
  const params = useSearchParams()
  const [data, setData]       = useState<LookupResponse | null>(null)
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const start = params.get('start')
    const end   = params.get('end')
    const exp   = params.get('exp')
    const label = params.get('label')
    const sig   = params.get('sig')
    if (!start || !end || !exp || label == null || !sig) {
      setError('Inspector URL is incomplete. Ask the issuer to mint a fresh URL.')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/inspector/lookup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ start, end, exp: Number(exp), label, sig }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? `Lookup failed (${res.status})`)
        setData(null)
      } else {
        setData(json as LookupResponse)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [params])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 text-center space-y-3">
        <ShieldAlert className="h-12 w-12 text-rose-500 mx-auto" />
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">
          Inspector access unavailable
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{error ?? 'Unknown error'}</p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          The URL may have expired, the secret rotated, or the link been altered.
          Ask the issuer to mint a fresh URL.
        </p>
      </div>
    )
  }

  const totalPermits = data.csPermits.length + data.hotWorkPermits.length

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Header band — distinct color so an inspector knows they're on a
          read-only inspector view, not the admin app. */}
      <header className="bg-gradient-to-br from-brand-navy to-[#1a3470] text-white rounded-xl p-5 space-y-2 shadow-md">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-brand-yellow" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">
            Inspector access · Read-only
          </p>
        </div>
        <h1 className="text-2xl font-bold leading-tight">{data.window.label}</h1>
        <p className="text-sm text-white/80">
          Permits issued between <span className="font-semibold">{data.window.start}</span> and <span className="font-semibold">{data.window.end}</span>.
          {' '}URL valid until <span className="font-semibold">{new Date(data.window.exp * 1000).toLocaleString()}</span>.
        </p>
      </header>

      {/* Compliance bundle download — preserves the same query params
          so the API can re-validate the signature and stream the PDF. */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Compliance report bundle
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            One PDF concatenating every permit in the window with SHA-256 hashes for chain-of-custody.
          </p>
        </div>
        <a
          href={`/api/inspector/bundle?${params.toString()}`}
          className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          Download bundle
        </a>
      </div>

      {totalPermits === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No permits in this window.</p>
        </div>
      ) : (
        <>
          {data.csPermits.length > 0 && (
            <PermitTable
              title="Confined-space permits"
              subtitle={`${data.csPermits.length} permit${data.csPermits.length === 1 ? '' : 's'} · OSHA §1910.146`}
              rows={data.csPermits.map(p => ({
                id:        p.id,
                serial:    p.serial,
                primary:   p.spaceId,
                startedAt: p.startedAt,
                status:    p.status,
                cancelReason: p.cancelReason,
                cancelDate:   p.cancelDate,
              }))}
            />
          )}
          {data.hotWorkPermits.length > 0 && (
            <PermitTable
              title="Hot-work permits"
              subtitle={`${data.hotWorkPermits.length} permit${data.hotWorkPermits.length === 1 ? '' : 's'} · OSHA §1910.252 / NFPA 51B`}
              rows={data.hotWorkPermits.map(p => ({
                id:        p.id,
                serial:    p.serial,
                primary:   p.workLocation,
                startedAt: p.startedAt,
                status:    p.status,
                cancelReason: p.cancelReason,
                cancelDate:   p.cancelDate,
              }))}
            />
          )}
        </>
      )}

      <p className="text-[10px] text-center text-slate-400 dark:text-slate-500 pt-2 max-w-prose mx-auto">
        This is a stateless read-only view. Token verification is HMAC-SHA-256;
        any alteration to start/end/exp/label invalidates the signature.
      </p>
    </div>
  )
}

interface TableRow {
  id:           string
  serial:       string
  primary:      string
  startedAt:    string
  status:       string
  cancelReason: string | null
  cancelDate:   string | null
}

function PermitTable({ title, subtitle, rows }: {
  title:    string
  subtitle: string
  rows:     TableRow[]
}) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <header>
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h2>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
              <th className="pb-2 pr-2">Serial</th>
              <th className="pb-2 pr-2">Subject</th>
              <th className="pb-2 pr-2">Started</th>
              <th className="pb-2 pr-2">Status</th>
              <th className="pb-2 pl-2">Closed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(r => (
              <tr key={r.id}>
                <td className="py-2 pr-2 font-mono font-semibold tracking-wider text-slate-700 dark:text-slate-300">{r.serial}</td>
                <td className="py-2 pr-2 text-slate-800 dark:text-slate-200 truncate max-w-[260px]">{r.primary}</td>
                <td className="py-2 pr-2 text-slate-500 dark:text-slate-400 tabular-nums">
                  {new Date(r.startedAt).toLocaleDateString()}
                </td>
                <td className="py-2 pr-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                    STATUS_BG[r.status] ?? 'bg-slate-100 text-slate-700'
                  }`}>
                    {r.status.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="py-2 pl-2 text-slate-500 dark:text-slate-400">
                  {r.cancelDate
                    ? <>
                        {new Date(r.cancelDate).toLocaleDateString()}
                        {r.cancelReason && (
                          <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                            {r.cancelReason.replace(/_/g, ' ')}
                          </span>
                        )}
                      </>
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
