'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ClipboardCheck } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { useAuth } from '@/components/AuthProvider'
import { StatusChip } from '@/components/environmental/badges'
import { ErrorList, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { errorList, getRun, submitRun, type RunView } from '@/lib/environmental/client'
import { dataUrlToFile, uploadEvidence } from '@/lib/environmental/evidence'
import {
  EMPTY_ANSWER, draftKey, groupBySection, parseDraft, progress, serializeDraft, toSubmitBody, type Answer, type Answers,
} from '@/lib/environmental/runnerView'
import { useEnvironmentalScope } from '@/lib/environmental/useEnvironmental'
import { ItemCard } from './_components/ItemCard'
import { SubmitPanel } from './_components/SubmitPanel'

// /environmental/compliance/checklists/[id] — run one checklist.
//
// Answers are kept on this device as you go (a draft per run) so a dropped signal
// or an accidental reload at the outfall loses nothing, and are sent to the server
// only on submit. A submitted checklist is a record: it opens read-only.

type Outcome = Awaited<ReturnType<typeof submitRun>>

function answersFromRun(run: RunView): Record<string, Answer> {
  return Object.fromEntries(run.responses.map(r => [r.item_id, {
    result: r.result,
    value: r.value === null || r.value === undefined ? '' : String(r.value),
    evidencePath: r.evidence_id,
    note: r.note ?? '',
  }]))
}

export default function ChecklistRunPage() {
  const { id } = useParams<{ id: string }>()
  const { scope, ready } = useEnvironmentalScope()
  const { profile } = useAuth()
  const [run, setRun] = useState<RunView | null>(null)
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  useEffect(() => {
    if (!scope || !id) return
    getRun(scope, id).then(loaded => {
      setRun(loaded)
      if (loaded.inspection.status === 'submitted') { setAnswers(answersFromRun(loaded)); return }
      let draft = null
      try { draft = parseDraft(window.localStorage.getItem(draftKey(id))) } catch { /* storage unavailable: start clean */ }
      setAnswers(draft?.answers ?? {})
      setName(draft?.signatureName || profile?.full_name || '')
    }).catch(e => setErrors(errorList(e)))
  }, [scope, id, profile?.full_name])

  useEffect(() => {
    if (!run || run.inspection.status === 'submitted' || outcome) return
    try { window.localStorage.setItem(draftKey(id), serializeDraft({ answers, signatureName: name })) } catch { /* the draft is a convenience */ }
  }, [answers, name, run, id, outcome])

  const items = useMemo(() => run?.items ?? [], [run])
  const asAnswers: Answers = answers
  const status = useMemo(() => progress(items, asAnswers), [items, asAnswers])
  const sections = useMemo(() => groupBySection(items), [items])

  const patch = useCallback((itemId: string, change: Partial<Answer>) =>
    setAnswers(prev => ({ ...prev, [itemId]: { ...EMPTY_ANSWER, ...prev[itemId], ...change } })), [])

  const jumpTo = useCallback((itemId: string) => {
    document.getElementById(`item-${itemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setFlash(itemId)
    setTimeout(() => setFlash(null), 2500)
  }, [])

  const submit = useCallback(async (drawing: string | null) => {
    if (!scope || !run) return
    setBusy(true); setErrors([])
    try {
      const imagePath = drawing ? await uploadEvidence(scope.tenantId, 'signatures', dataUrlToFile(drawing, 'signature.png')) : null
      const result = await submitRun(scope, id, toSubmitBody(items, asAnswers, { name, imagePath }))
      try { window.localStorage.removeItem(draftKey(id)) } catch { /* nothing to clear */ }
      setOutcome(result)
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }, [scope, run, id, items, asAnswers, name])

  if (!ready || !scope) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  if (!run) return errors.length > 0 ? <ErrorList errors={errors} /> : <div className="flex justify-center py-16"><OpsSpinner /></div>

  const submitted = run.inspection.status === 'submitted'
  const readOnly = submitted || outcome !== null

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ClipboardCheck} back="/environmental/compliance/checklists"
        eyebrow={run.subject_label ?? 'Environmental checklist'} title={run.template_name}
        description={submitted ? `Submitted${run.run.signature?.name ? ` by ${run.run.signature.name}` : ''}.` : `${status.requiredAnswered} of ${status.requiredTotal} required questions answered.`}
      />

      {outcome && (
        <section role="status" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
          <div className="flex items-center gap-2">
            {outcome.result === 'pass' ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-rose-600" />}
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{outcome.result === 'pass' ? 'Submitted: everything passed' : 'Submitted: some items failed'}</h2>
            <StatusChip tone={outcome.result === 'pass' ? 'good' : 'bad'}>{outcome.pct}%</StatusChip>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
            {outcome.findingsRaised > 0 && (
              <li>{outcome.findingsRaised} {outcome.findingsRaised === 1 ? 'finding was' : 'findings were'} raised for follow-up. <Link className="underline" href="/environmental/nonconformities">Open findings</Link></li>
            )}
            {outcome.completedObligation && <li>The calendar deadline this satisfies was completed and moved to its next date. <Link className="underline" href="/environmental/compliance/calendar">See the calendar</Link></li>}
            <li>A failed checklist still counts as the inspection done: what matters is that it was done, and what you found is recorded.</li>
          </ul>
          <Link href="/environmental/compliance/checklists" className={primaryButtonCls}>Back to checklists</Link>
        </section>
      )}

      {submitted && !outcome && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
          <StatusChip tone={run.inspection.result === 'fail' ? 'bad' : 'good'}>{run.inspection.result === 'fail' ? 'Findings raised' : 'Passed'}</StatusChip>
          {run.run.signature?.signed_at && <span className="text-slate-600 dark:text-slate-400">Signed {run.run.signature.signed_at.slice(0, 10)}</span>}
          <Link href="/environmental/compliance/checklists" className={`${secondaryButtonCls} ml-auto`}>Back to checklists</Link>
        </div>
      )}

      {sections.map(section => (
        <section key={section.section} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{section.section}</h2>
          <ul className="space-y-3">
            {section.items.map(item => (
              <ItemCard
                key={item.id} item={item} answer={answers[item.id] ?? EMPTY_ANSWER} readOnly={readOnly}
                tenantId={scope.tenantId} highlighted={flash === item.id} onChange={change => patch(item.id, change)}
              />
            ))}
          </ul>
        </section>
      ))}

      {!readOnly && (
        <SubmitPanel missing={status.missing} name={name} onNameChange={setName} busy={busy} errors={errors} onSubmit={d => void submit(d)} onJumpTo={jumpTo} />
      )}
    </div>
  )
}
