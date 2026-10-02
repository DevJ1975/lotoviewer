'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, GitPullRequestArrow, Loader2 } from 'lucide-react'
import { CHANGE_KIND_LABELS } from '@soteria/core/managementOfChange'
import { useTenant } from '@/components/TenantProvider'
import { useFacility } from '@/components/FacilityProvider'
import { Sheet } from '@/components/ui/sheet'
import { listChanges, type ChangeSummary } from '@/lib/environmental/client'
import { useCanEditRegisters } from '../_components/access'
import { BUTTON_PRIMARY, INPUT, LABEL, LABEL_TEXT } from '../_components/formStyles'
import { ChangeForm } from './_components/ChangeForm'
import { Progress } from './_components/Progress'

// /environmental/changes — management of change (clauses 6.1.4 and 8.1). A
// change to equipment, a chemical, a process, or who owns the site opens with a
// checklist of the records it touches; it closes when every item is resolved.

type Status = 'open' | 'closed' | 'cancelled' | 'all'

export default function ChangesPage() {
  const { tenantId } = useTenant()
  const { facilityId } = useFacility()
  const canEdit = useCanEditRegisters()
  const router = useRouter()

  const [status, setStatus] = useState<Status>('open')
  const [changes, setChanges] = useState<ChangeSummary[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  // The newest load wins, so a quick filter change never shows the other filter's list.
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!tenantId) return
    const current = ++generation.current
    setLoadError(null)
    try {
      const result = await listChanges(tenantId, status)
      if (current === generation.current) setChanges(result.changes)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load the changes.')
    }
  }, [tenantId, status])

  useEffect(() => { void load() }, [load])

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Environmental
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <GitPullRequestArrow className="h-6 w-6 text-brand-navy" />
          Management of change
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ISO 14001:2015 clauses 6.1.4 and 8.1. When equipment, a chemical, a process or the owner changes, the records it
          touches are listed here, and the change is closed only when each has been dealt with.
        </p>
      </div>

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{loadError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className={LABEL}>
          <span className={LABEL_TEXT}>Show</span>
          <select className={INPUT} value={status} onChange={e => setStatus(e.target.value as Status)}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </label>
        {canEdit && <button type="button" className={BUTTON_PRIMARY} onClick={() => setAdding(true)}>New change</button>}
      </div>

      {changes === null ? (
        !loadError && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : changes.length === 0 ? (
        <p className="rounded-xl border border-slate-100 bg-white px-4 py-10 text-center text-sm italic text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          No changes {status === 'all' ? 'recorded' : status}.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
          {changes.map(change => (
            <li key={change.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div>
                <Link href={`/environmental/changes/${change.id}`} className="text-sm font-medium text-slate-900 hover:underline dark:text-slate-100">
                  {change.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {CHANGE_KIND_LABELS[change.kind]} · opened {change.opened_at.slice(0, 10)}
                  {change.status !== 'open' && ` · ${change.status}`}
                </p>
              </div>
              <Progress resolved={change.impacts_resolved} total={change.impacts_total} />
            </li>
          ))}
        </ul>
      )}

      {tenantId && (
        <Sheet open={adding} onClose={() => setAdding(false)} title="New change"
          subtitle="Opening it lists the records the change touches.">
          {adding && (
            <ChangeForm tenantId={tenantId} facilityChosen={facilityId !== null} onCancel={() => setAdding(false)}
              onOpened={change => { setAdding(false); router.push(`/environmental/changes/${change.id}`) }} />
          )}
        </Sheet>
      )}
    </div>
  )
}
