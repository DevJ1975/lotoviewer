'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, GitPullRequestArrow, Loader2 } from 'lucide-react'
import { CHANGE_KIND_LABELS } from '@soteria/core/managementOfChange'
import { useTenant } from '@/components/TenantProvider'
import {
  cancelChange,
  closeChange,
  getChange,
  type ChangeRow,
  type EvidenceRow,
  type ImpactRow,
} from '@/lib/environmental/client'
import { useCanEditRegisters } from '../../_components/access'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR } from '../../_components/formStyles'
import { ReasonPrompt } from '../../_components/ReasonPrompt'
import { ImpactItem } from '../_components/ImpactItem'
import { Progress } from '../_components/Progress'

// /environmental/changes/[id] — the checklist of a change. Impacts are grouped
// by the record they point at, so an ownership change reads as one card per
// permit with its three steps, then the scope and the policy.

interface Group { key: string; label: string; href: string | null; impacts: ImpactRow[] }

function groupImpacts(impacts: readonly ImpactRow[]): Group[] {
  const groups = new Map<string, Group>()
  for (const impact of impacts) {
    const key = `${impact.target_type}:${impact.target_id}`
    const group = groups.get(key) ?? { key, label: impact.target_label, href: impact.target_href, impacts: [] }
    group.impacts.push(impact)
    groups.set(key, group)
  }
  for (const group of groups.values()) group.impacts.sort((a, b) => a.step_order - b.step_order)
  return [...groups.values()]
}

export default function ChangeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { tenantId } = useTenant()
  const canEdit = useCanEditRegisters()

  const [change, setChange] = useState<ChangeRow | null>(null)
  const [impacts, setImpacts] = useState<ImpactRow[]>([])
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [closeBlockers, setCloseBlockers] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState(false)

  // The newest load wins: each resolve reloads, and a slower earlier load must not overwrite a later one.
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!tenantId || !id) return
    const current = ++generation.current
    try {
      const detail = await getChange(tenantId, id)
      if (current !== generation.current) return
      setChange(detail.change)
      setImpacts(detail.impacts)
      setEvidence(detail.evidence)
      setCloseBlockers(detail.closeBlockers)
      setLoadError(null)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load the change.')
    }
  }, [tenantId, id])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => groupImpacts(impacts), [impacts])

  if (loadError && !change) {
    return <div className="mx-auto max-w-4xl px-4 py-6"><p className={FIELD_ERROR} role="alert">{loadError}</p></div>
  }
  if (!change || !tenantId) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }

  const open = change.status === 'open'
  const resolved = impacts.filter(impact => impact.resolved_at !== null).length

  async function close() {
    setBusy(true)
    setActionError(null)
    try { await closeChange(tenantId!, change!.id); await load() }
    catch (err) { setActionError(err instanceof Error ? err.message : 'Could not close the change.') }
    finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental/changes" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Management of change
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
              <GitPullRequestArrow className="h-6 w-6 shrink-0 text-brand-navy" />
              {change.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {CHANGE_KIND_LABELS[change.kind]} · opened {change.opened_at.slice(0, 10)}
              {change.effective_on && ` · effective ${change.effective_on}`}
              {!open && ` · ${change.status} ${change.ended_at?.slice(0, 10) ?? ''}`}
            </p>
          </div>
          <Progress resolved={resolved} total={impacts.length} />
        </div>
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{change.description}</p>
        {change.new_legal_entity && (
          <p className="mt-1 text-xs text-slate-500">New legal entity: <span className="font-medium text-slate-800 dark:text-slate-100">{change.new_legal_entity}</span></p>
        )}
        {change.cancelled_reason && <p className="mt-1 text-xs text-slate-500">Cancelled: {change.cancelled_reason}</p>}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm italic text-slate-500">This change touched no records automatically, so its checklist is empty.</p>
      ) : groups.map(group => (
        <section key={group.key} aria-label={group.label}
          className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {group.href
              ? <Link href={group.href} className="hover:underline">{group.label}</Link>
              : group.label}
          </h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {group.impacts.map(impact => (
              <ImpactItem key={impact.id} tenantId={tenantId} changeId={change.id} impact={impact}
                evidence={evidence.filter(e => e.subject_id === impact.id)}
                canResolve={canEdit} open={open} onChanged={() => void load()} />
            ))}
          </ul>
        </section>
      ))}

      {actionError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{actionError}</span>
        </div>
      )}
      {canEdit && open && (
        <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          {closeBlockers.length > 0 && <p className="text-xs text-amber-800 dark:text-amber-200">{closeBlockers.join(' ')}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_PRIMARY} disabled={busy || closeBlockers.length > 0} onClick={() => void close()}>Close change</button>
            {!cancelling && <button type="button" className={BUTTON_SECONDARY} onClick={() => setCancelling(true)}>Cancel change</button>}
          </div>
          {cancelling && (
            <ReasonPrompt
              explanation="A cancelled change keeps its impacts as history. Say why it is not going ahead."
              label="Why the change is cancelled" placeholder="e.g. The sale did not complete" confirmLabel="Cancel change"
              onCancel={() => setCancelling(false)}
              onSubmit={async reason => { await cancelChange(tenantId, change.id, reason); setCancelling(false); await load() }} />
          )}
        </div>
      )}
    </div>
  )
}
