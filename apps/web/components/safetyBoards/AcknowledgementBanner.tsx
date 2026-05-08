'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { acknowledgeThread, fetchAcknowledgements, type AckSummary } from '@/lib/safetyBoards/client'

// Renders the "you must acknowledge this thread" banner above the
// thread body. Hidden if the thread doesn't require ack OR if the
// caller has already acknowledged.
//
// For admins (isAdmin=true), this also surfaces the count of acks
// received so far + a small "view list" disclosure.

interface Props {
  threadId: string
  isAdmin: boolean
  onAcknowledged?: () => void
}

export default function AcknowledgementBanner({ threadId, isAdmin, onAcknowledged }: Props) {
  const { tenant } = useTenant()
  const [summary, setSummary] = useState<AckSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [showAcks, setShowAcks] = useState(false)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    void (async () => {
      try {
        const s = await fetchAcknowledgements(tenant.id, threadId)
        if (!cancelled) setSummary(s)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [tenant?.id, threadId])

  async function ack() {
    if (!tenant?.id) return
    setBusy(true); setError(null)
    try {
      await acknowledgeThread(tenant.id, threadId, comment.trim() || undefined)
      const s = await fetchAcknowledgements(tenant.id, threadId)
      setSummary(s)
      setComment('')
      onAcknowledged?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return null
  if (!summary) return null

  const acked = !!summary.mine
  return (
    <div className={
      'rounded-lg border p-3 ' +
      (acked
        ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800'
        : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800')
    }>
      <div className="flex items-start gap-2">
        {acked
          ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5" />
          : <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5" />}
        <div className="flex-1 min-w-0">
          {acked ? (
            <>
              <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">
                You acknowledged this on {new Date(summary.mine!.acknowledged_at).toLocaleString()}.
              </p>
              {summary.mine?.comment && (
                <p className="text-xs text-emerald-700 dark:text-emerald-200 mt-0.5 italic">
                  &ldquo;{summary.mine.comment}&rdquo;
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                Acknowledgement required
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
                Tenant admins flagged this for proof-of-notification. Acknowledge once you have read the thread.
              </p>
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <input
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Optional note (e.g. 'briefed crew')"
                  maxLength={1000}
                  className="flex-1 rounded border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm"
                />
                <button
                  type="button"
                  onClick={() => void ack()}
                  disabled={busy}
                  className="rounded-lg bg-amber-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 inline-flex items-center justify-center gap-1"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Acknowledge
                </button>
              </div>
            </>
          )}
          {error && <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">{error}</p>}

          {isAdmin && (
            <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800/50">
              <button
                type="button"
                onClick={() => setShowAcks(s => !s)}
                className="text-xs font-medium text-amber-900 dark:text-amber-100 hover:underline"
              >
                {showAcks ? 'Hide' : 'Show'} acknowledgements ({summary.count})
              </button>
              {showAcks && summary.acks.length > 0 && (
                <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                  {summary.acks.map(a => (
                    <li key={a.user_id} className="text-xs text-amber-900 dark:text-amber-100">
                      <span className="font-medium">{a.full_name ?? a.email ?? a.user_id}</span>
                      <span className="text-amber-700 dark:text-amber-300"> — {new Date(a.acknowledged_at).toLocaleString()}</span>
                      {a.comment && <span className="italic"> · &ldquo;{a.comment}&rdquo;</span>}
                    </li>
                  ))}
                </ul>
              )}
              {showAcks && summary.acks.length === 0 && (
                <p className="text-xs italic text-amber-800 dark:text-amber-200 mt-1">
                  No acknowledgements yet.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
