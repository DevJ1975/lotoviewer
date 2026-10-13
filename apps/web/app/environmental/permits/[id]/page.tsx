'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, ArrowLeft, FileBadge, Loader2 } from 'lucide-react'
import { PERMIT_PROGRAM_LABELS } from '@soteria/core/environmentalPermit'
import { CHANGE_KIND_LABELS } from '@soteria/core/managementOfChange'
import { memberName, useTenantMembers } from '@/app/risk/_components/wizard/MemberPicker'
import { useTenant } from '@/components/TenantProvider'
import { Sheet } from '@/components/ui/sheet'
import {
  getPermit,
  retirePermit,
  reviewPermit,
  type EvidenceRow,
  type PermitChangeRef,
  type PermitCondition,
  type PermitRow,
} from '@/lib/environmental/client'
import { useCanEditRegisters } from '../../_components/access'
import { EvidenceList, EvidenceUpload } from '../../_components/EvidenceUpload'
import { BUTTON_SECONDARY, FIELD_ERROR } from '../../_components/formStyles'
import { ReasonPrompt } from '../../_components/ReasonPrompt'
import { BusinessCriticalBadge, HolderMismatchBadge, RenewalBadge } from '../_components/PermitBadges'
import { ConditionsPanel } from '../_components/ConditionsPanel'
import { PermitForm } from '../_components/PermitForm'
import { RenewalPanel } from '../_components/RenewalPanel'

// /environmental/permits/[id] — one permit: its terms, its renewal, its
// documents, its conditions, and the changes that touched it. The
// "permit conditions due" email links here.

export default function PermitDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { tenantId } = useTenant()
  const canEdit = useCanEditRegisters()
  const { members } = useTenantMembers()

  const [permit, setPermit] = useState<PermitRow | null>(null)
  const [legalEntity, setLegalEntity] = useState<string | null>(null)
  const [conditions, setConditions] = useState<PermitCondition[]>([])
  const [documents, setDocuments] = useState<EvidenceRow[]>([])
  const [changes, setChanges] = useState<PermitChangeRef[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [retiring, setRetiring] = useState(false)
  const [busy, setBusy] = useState(false)

  // The newest load wins: an upload or a renewal reloads while an older load may still be in flight.
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!tenantId || !id) return
    const current = ++generation.current
    try {
      const detail = await getPermit(tenantId, id)
      if (current !== generation.current) return
      setPermit(detail.permit)
      setLegalEntity(detail.legalEntityInForce)
      setConditions(detail.conditions)
      setDocuments(detail.documents)
      setChanges(detail.changes)
      setLoadError(null)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load the permit.')
    }
  }, [tenantId, id])

  useEffect(() => { void load() }, [load])

  if (loadError && !permit) {
    return <div className="mx-auto max-w-4xl px-4 py-6"><p className={FIELD_ERROR} role="alert">{loadError}</p></div>
  }
  if (!permit || !tenantId) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }

  const retired = permit.retired_at !== null
  const owner = permit.owner_user_id && members ? members.find(m => m.user_id === permit.owner_user_id) ?? null : null
  const today = new Date().toISOString().slice(0, 10)
  const current = documents.filter(d => !d.superseded_by)

  const markReviewed = async () => {
    setBusy(true)
    setActionError(null)
    try { await reviewPermit(tenantId, permit.id); await load() }
    catch (err) { setActionError(err instanceof Error ? err.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental/permits" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Permits
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <FileBadge className="h-6 w-6 shrink-0 text-brand-navy" />
          {permit.title}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {PERMIT_PROGRAM_LABELS[permit.program]} · {permit.agency}{permit.permit_number ? ` · ${permit.permit_number}` : ''}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <RenewalBadge permit={permit} />
          <HolderMismatchBadge permit={permit} />
          <BusinessCriticalBadge permit={permit} />
        </div>
      </div>

      {permit.holder_mismatch === true && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            This permit is held by &ldquo;{permit.holder_of_record}&rdquo;, but the EMS scope names &ldquo;{legalEntity}&rdquo;.
            If the site changed hands or the company was renamed, record a change of owner or legal name to work through the transfer.
          </span>
        </div>
      )}
      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <span>{loadError} What is shown may be out of date.</span>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => void load()}>Retry</button>
        </div>
      )}
      {retired && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          Retired {permit.retired_at?.slice(0, 10)}: {permit.retired_reason}. It is kept as history.
        </p>
      )}

      <section className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
        <Fact label="Held by" value={permit.holder_of_record} />
        <Fact label="Jurisdiction" value={permit.jurisdiction} />
        <Fact label="Owner" value={owner ? memberName(owner)
          : permit.owner_user_id ? (members === null ? '…' : 'No longer a member') : 'Unassigned'} />
        <Fact label="Issued" value={permit.issued_on ?? '—'} />
        <Fact label="Expires" value={permit.expires_on ?? 'No fixed term'} />
        <Fact label="Renewal application due" value={permit.renewal_application_due_on ?? '—'} />
        <Fact label="Last reviewed" value={permit.last_reviewed_at ? permit.last_reviewed_at.slice(0, 10) : 'Never'} />
        <Fact label="Next review" value={permit.next_review_due} warn={!retired && permit.next_review_due < today} />
        {permit.notes && <Fact label="Notes" value={permit.notes} wide />}
      </section>

      {canEdit && !retired && (
        <RenewalPanel tenantId={tenantId} permit={permit} onChanged={() => void load()} />
      )}

      <section className="space-y-2" aria-label="Documents">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Documents</h3>
        <EvidenceList tenantId={tenantId} evidence={documents} canDownloadControlled={canEdit} />
        {canEdit && !retired && (
          <EvidenceUpload tenantId={tenantId} subjectType="environmental_permit" subjectId={permit.id}
            current={current} onUploaded={() => void load()} />
        )}
      </section>

      <ConditionsPanel tenantId={tenantId} permitId={permit.id} retired={retired} conditions={conditions}
        canEdit={canEdit} onChanged={() => void load()} />

      <section className="space-y-2" aria-label="Changes">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Changes that touched it</h3>
        {changes.length === 0 ? (
          <p className="text-xs italic text-slate-500">None.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {changes.map(change => (
              <li key={change.id}>
                <Link href={`/environmental/changes/${change.id}`} className="font-medium text-brand-navy hover:underline dark:text-brand-yellow">
                  {change.title}
                </Link>
                <span className="text-slate-500"> · {CHANGE_KIND_LABELS[change.kind]} · {change.status} · {change.opened_at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {actionError && <p className={FIELD_ERROR} role="alert">{actionError}</p>}
      {canEdit && !retired && (
        <div className="space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BUTTON_SECONDARY} disabled={busy} onClick={() => void markReviewed()}>Mark reviewed</button>
            <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing(true)}>Edit</button>
            {!retiring && <button type="button" className={BUTTON_SECONDARY} onClick={() => setRetiring(true)}>Retire</button>}
          </div>
          {retiring && (
            <ReasonPrompt
              explanation="A retired permit leaves the renewal countdown and its notices, and is kept as history with its documents. Its conditions stay in the obligations register until they are dismissed there. Say why it is no longer held."
              label="Why the permit is retired" placeholder="e.g. Surrendered when the process was discontinued" confirmLabel="Retire permit"
              onCancel={() => setRetiring(false)}
              onSubmit={async reason => { await retirePermit(tenantId, permit.id, reason); setRetiring(false); await load() }} />
          )}
        </div>
      )}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit permit"
        subtitle="Correct what the permit says. A renewal has its own action.">
        {editing && (
          <PermitForm tenantId={tenantId} initial={permit} defaultHolder={legalEntity}
            onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void load() }} />
        )}
      </Sheet>
    </div>
  )
}

function Fact({ label, value, wide, warn }: { label: string; value: string; wide?: boolean; warn?: boolean }) {
  return (
    <div className={wide ? 'col-span-2 sm:col-span-3' : undefined}>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <span className={warn ? 'font-semibold text-amber-700 dark:text-amber-300' : 'text-slate-800 dark:text-slate-100'}>{value}</span>
    </div>
  )
}
