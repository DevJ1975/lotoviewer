'use client'

import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { Check, Loader2, RefreshCcw, X } from 'lucide-react'

// Admin reconcile panel — "swap the staged photos in at the end".
//
// Lists every pending photo replacement staged against a review link with a
// side-by-side old-vs-new preview and per-item Apply / Reject, plus an
// "Apply all" shortcut. Nothing here touches loto_equipment directly: each
// action calls the tenant-guarded reconcile API, which runs the idempotent
// SECURITY DEFINER RPCs. Re-running is safe — applied/rejected rows drop out
// of the pending list.

interface Replacement {
  id:               string
  equipment_id:     string
  slot:             'EQUIP' | 'ISO'
  old_photo_url:    string | null
  new_photo_url:    string
  replaced_by_name: string | null
  replaced_at:      string
  status:           string
}

export default function PhotoReconcilePanel({
  reviewLinkId, authHeaders,
}: {
  reviewLinkId: string
  authHeaders:  () => Promise<Record<string, string>>
}) {
  const [rows, setRows]   = useState<Replacement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | 'all' | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const headers = await authHeaders()
      const res = await fetch(`/api/admin/review-links/${reviewLinkId}/reconcile`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRows((body.replacements ?? []) as Replacement[])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRows([])
    }
  }, [reviewLinkId, authHeaders])

  useEffect(() => { void load() }, [load])

  async function act(action: 'apply' | 'reject', row: Replacement) {
    const reason = action === 'reject' && typeof window !== 'undefined'
      ? (window.prompt('Reason for rejecting this photo? (optional)') ?? '')
      : ''
    setBusyId(row.id); setError(null)
    try {
      const headers = await authHeaders()
      const res = await fetch(`/api/admin/review-links/${reviewLinkId}/reconcile`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, replacement_id: row.id, reason }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setRows(prev => (prev ?? []).filter(r => r.id !== row.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusyId(null) }
  }

  async function applyAll() {
    setBusyId('all'); setError(null)
    try {
      const headers = await authHeaders()
      const res = await fetch(`/api/admin/review-links/${reviewLinkId}/reconcile`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'apply-all' }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally { setBusyId(null) }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Photo replacements
          {rows && rows.length > 0 ? (
            <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {rows.length} pending
            </span>
          ) : null}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <RefreshCcw className="size-3" /> Refresh
          </button>
          {rows && rows.length > 0 ? (
            <button
              type="button"
              onClick={() => void applyAll()}
              disabled={busyId !== null}
              className="inline-flex items-center gap-1 rounded-md bg-brand-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-50 dark:bg-brand-yellow dark:text-slate-950"
            >
              {busyId === 'all' ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
              Apply all
            </button>
          ) : null}
        </div>
      </div>

      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Staged by reviewers during the floor walk. Apply to swap the photo into the live placard
        (the placard is re-rendered from the new photo); reject to discard it. Nothing changes until you act.
      </p>

      {error && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</p>
      )}

      {rows === null ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No staged photo replacements to reconcile.</p>
      ) : (
        <ul className="mt-4 space-y-4">
          {rows.map(row => (
            <li key={row.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{row.equipment_id}</span>
                  <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{row.slot}</span>
                  {row.replaced_by_name ? (
                    <span className="ml-2 text-xs text-slate-500">by {row.replaced_by_name}</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void act('apply', row)}
                    disabled={busyId !== null}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busyId === row.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => void act('reject', row)}
                    disabled={busyId !== null}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
                  >
                    <X className="size-3" /> Reject
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <PreviewTile label="Current" url={row.old_photo_url} />
                <PreviewTile label="Staged (new)" url={row.new_photo_url} highlight />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PreviewTile({ label, url, highlight }: { label: string; url: string | null; highlight?: boolean }) {
  return (
    <figure>
      <div className={`relative aspect-[4/3] overflow-hidden rounded-md border ${highlight ? 'border-emerald-400' : 'border-slate-200 dark:border-slate-700'} bg-slate-900`}>
        {url ? (
          <Image src={url} alt={label} fill sizes="(max-width: 640px) 50vw, 240px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">No photo</div>
        )}
      </div>
      <figcaption className={`mt-1 text-[11px] font-semibold ${highlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500'}`}>{label}</figcaption>
    </figure>
  )
}
