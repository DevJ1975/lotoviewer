'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, ClipboardCheck, Loader2, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { PictogramBadges, SignalWordBadge } from '../_components/PictogramBadges'

interface PendingItem {
  id:               string
  barcode:          string
  quantity:         number
  unit:             string
  container_type:   string | null
  purchase_order:   string | null
  notes:            string | null
  requested_at:     string | null
  created_at:       string
  requester_name:   string | null
  chemical_products: {
    id:              string
    name:            string
    manufacturer:    string | null
    ghs_signal_word: string | null
    ghs_pictograms:  string[] | null
  } | null
  chemical_locations: {
    id:    string
    name:  string
    path:  string | null
  } | null
}

export default function ApprovalsPage() {
  const { tenant } = useTenant()
  const [items,  setItems]  = useState<PendingItem[] | null>(null)
  const [error,  setError]  = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const res  = await fetch('/api/chemicals/approvals', { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setItems([])
      return
    }
    setItems(body.items ?? [])
  }, [tenant, buildHeaders])

  useEffect(() => { void load() }, [load])

  async function approve(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/chemicals/inventory/${id}/approve`, {
        method: 'POST', headers,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) {
      setError('A rejection reason is required.')
      return
    }
    setBusyId(id)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/chemicals/inventory/${id}/approve`, {
        method:  'DELETE',
        headers: { ...headers, 'content-type': 'application/json' },
        body:    JSON.stringify({ reason: rejectReason.trim() }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setRejecting(null)
      setRejectReason('')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6" /> Approval queue
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Container requests waiting on safety review. Owner / admin role required to approve or reject.
          The requester gets a push notification on either decision.
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          The queue is empty. Containers can be filed by adding inventory with status &quot;requested&quot;.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {items.map(item => (
            <li key={item.id} className="px-4 py-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{item.barcode}</span>
                <Link
                  href={`/chemicals/${item.chemical_products?.id ?? ''}`}
                  className="font-semibold text-slate-900 dark:text-slate-100 hover:underline"
                >
                  {item.chemical_products?.name ?? '(unknown product)'}
                </Link>
                <SignalWordBadge word={item.chemical_products?.ghs_signal_word ?? null} />
                <PictogramBadges pictograms={item.chemical_products?.ghs_pictograms ?? []} />
                <span className="ml-auto text-xs text-slate-500">
                  requested {item.requested_at ? new Date(item.requested_at).toISOString().slice(0, 16).replace('T', ' ') : '—'}
                </span>
              </div>
              <div className="text-xs text-slate-500 flex flex-wrap gap-x-3">
                <span>{item.quantity} {item.unit}</span>
                {item.container_type && <span>· {item.container_type}</span>}
                {item.chemical_locations?.path && <span>· 📍 {item.chemical_locations.path}</span>}
                {item.requester_name && <span>· by {item.requester_name}</span>}
                {item.purchase_order && <span>· PO {item.purchase_order}</span>}
              </div>
              {item.notes && (
                <p className="text-xs text-slate-700 dark:text-slate-300 italic">{item.notes}</p>
              )}

              {rejecting === item.id ? (
                <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <label className="block flex-1 min-w-[240px]">
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Rejection reason</span>
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      placeholder="Wrong vendor, banned alternative, etc."
                      className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900"
                    />
                  </label>
                  <button
                    onClick={() => { setRejecting(null); setRejectReason('') }}
                    className="px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700"
                  >Cancel</button>
                  <button
                    onClick={() => void reject(item.id)}
                    disabled={busyId === item.id || !rejectReason.trim()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-60"
                  >
                    {busyId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                    Reject
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => setRejecting(item.id)}
                    disabled={busyId === item.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-60"
                  >
                    <X className="w-3 h-3" /> Reject
                  </button>
                  <button
                    onClick={() => void approve(item.id)}
                    disabled={busyId === item.id}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60"
                  >
                    {busyId === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                    Approve
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
