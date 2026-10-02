'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import {
  getObligation,
  openEvaluation,
  reviewObligation,
  type EvaluationRow,
  type EvidenceRow,
  type LinkedAspect,
  type ObligationRow,
} from '@/lib/environmental/client'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR } from '../../_components/formStyles'
import { EvidenceList } from '../../_components/EvidenceUpload'
import { EvaluationPanel } from './EvaluationPanel'
import { ObligationForm } from './ObligationForm'
import { ResultBadge } from './ResultBadge'

// One obligation in the register: why it applies, which aspects it bears on,
// the open evaluation (with evidence and the result form), and every past
// evaluation with its evidence. Used by the register's sheet and by
// /environmental/obligations/[id], where the "evaluations to complete"
// email lands.

export function ObligationDetail({ tenantId, obligationId, canEdit, onChanged }: {
  tenantId: string; obligationId: string; canEdit: boolean; onChanged?: () => void
}) {
  const { userId } = useAuth()
  const [obligation, setObligation] = useState<ObligationRow | null>(null)
  const [evaluations, setEvaluations] = useState<EvaluationRow[]>([])
  const [evidence, setEvidence] = useState<EvidenceRow[]>([])
  const [aspects, setAspects] = useState<LinkedAspect[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const detail = await getObligation(tenantId, obligationId)
      setObligation(detail.obligation)
      setEvaluations(detail.evaluations)
      setEvidence(detail.evidence)
      setAspects(detail.linkedAspects)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the obligation.')
    }
  }, [tenantId, obligationId])

  useEffect(() => { void load() }, [load])

  const changed = async () => {
    setEditing(false)
    await load()
    onChanged?.()
  }

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true)
    setActionError(null)
    try { await run(); await changed() }
    catch (err) { setActionError(err instanceof Error ? err.message : 'That did not work.') }
    finally { setBusy(false) }
  }

  if (loadError) return <p className={FIELD_ERROR} role="alert">{loadError}</p>
  if (!obligation) return <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  if (editing) {
    return <ObligationForm tenantId={tenantId} initial={obligation} onSaved={() => void changed()} onCancel={() => setEditing(false)} />
  }

  const open = evaluations.find(e => e.completed_at === null) ?? null
  const completed = evaluations.filter(e => e.completed_at !== null)
  const evidenceFor = (evaluationId: string) => evidence.filter(e => e.subject_id === evaluationId)
  const mayEvaluate = open !== null && (canEdit || (userId !== null && open.assigned_to === userId))

  return (
    <div className="space-y-6 text-sm">
      <section className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300">
        <Fact label="Source" value={obligation.source_kind ?? '—'} />
        <Fact label="Jurisdiction" value={obligation.jurisdiction ?? '—'} />
        <Fact label="Citation" value={obligation.regulatory_ref ?? '—'} />
        <Fact label="Next deadline" value={`${obligation.next_due_at} (${obligation.cadence})`} />
        <Fact label="Evaluated every" value={obligation.evaluation_cadence_days ? `${obligation.evaluation_cadence_days} days` : 'Not scheduled'} />
        <Fact label="Next register review" value={obligation.next_review_due} />
        <Fact label="Why it applies" value={obligation.applicability_rationale ?? 'Not recorded'} wide />
        {obligation.permit_id && (
          <p className="col-span-2">
            <Link href={`/environmental/permits/${obligation.permit_id}`} className="text-brand-navy hover:underline dark:text-brand-yellow">
              A condition of a permit: open the permit
            </Link>
          </p>
        )}
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Aspects it bears on</h3>
        {aspects.length === 0 ? (
          <p className="text-xs italic text-slate-500">None linked. Link them from the aspects register.</p>
        ) : (
          <ul className="list-disc pl-5 text-xs">
            {aspects.map(a => (
              <li key={a.id} className={a.obsolete_at ? 'text-slate-400' : undefined}>
                <Link href="/environmental/aspects" className="hover:underline">{a.activity} — {a.aspect}</Link>
                {a.obsolete_at && ' (obsolete)'}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Evaluation of compliance</h3>
        {open ? (
          <EvaluationPanel tenantId={tenantId} evaluation={open} evidence={evidenceFor(open.id)}
            canAct={mayEvaluate} onChanged={() => void changed()} />
        ) : canEdit && obligation.status !== 'dismissed' ? (
          <button type="button" className={BUTTON_PRIMARY} disabled={busy}
            onClick={() => void act(() => openEvaluation(tenantId, obligation.id))}>
            Start an evaluation now
          </button>
        ) : (
          <p className="text-xs italic text-slate-500">No evaluation is open.</p>
        )}
        {completed.length > 0 && (
          <ul className="space-y-2">
            {completed.map(e => (
              <li key={e.id} className="space-y-1 rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <ResultBadge result={e.result} />
                  <span className="text-slate-500">{e.completed_at?.slice(0, 10)}</span>
                  {e.nonconformity_id && (
                    <Link href="/environmental/nonconformities" className="text-rose-700 hover:underline dark:text-rose-300">
                      Nonconformity opened
                    </Link>
                  )}
                </div>
                {e.notes && <p className="text-xs text-slate-600 dark:text-slate-300">{e.notes}</p>}
                <EvidenceList tenantId={tenantId} evidence={evidenceFor(e.id)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {actionError && <p className={FIELD_ERROR} role="alert">{actionError}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
          <button type="button" className={BUTTON_SECONDARY} disabled={busy}
            onClick={() => void act(() => reviewObligation(tenantId, obligation.id))}>Mark reviewed</button>
          <button type="button" className={BUTTON_SECONDARY} onClick={() => setEditing(true)}>Edit</button>
          <Link href="/admin/compliance/calendar" className={BUTTON_SECONDARY}>Deadlines in the calendar</Link>
        </div>
      )}
    </div>
  )
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      <span className="text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  )
}
