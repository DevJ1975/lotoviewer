'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ClipboardCheck, Loader2, Play } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { EmptyState } from '@/components/EmptyState'
import { DraftBadge, StatusChip } from '@/components/environmental/badges'
import { HowToPanel, JurisdictionBanner, SiteRequired } from '@/components/environmental/context'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import {
  errorList, listChecklists, listOutfalls, listPermits, startChecklist,
  type ChecklistRunRow, type ChecklistTemplateRow, type Outfall, type Permit,
} from '@/lib/environmental/client'
import { dueText, groupByProgram, needsSubject } from '@/lib/environmental/runnerView'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { ENV_PROGRAM_LABELS } from '@soteria/core/environmental/siteProfile'

// /environmental/compliance/checklists — what can be run at this site, and the
// recent runs. A checklist is started from here, or from a calendar deadline
// (?start=<checklist>&obligation=<id>) or an outfall (?subject_type=outfall&subject=<id>).
//
// Checklists the hazardous waste module owns (accumulation-area inspections) are
// not listed: that module runs its own, with its own area records.

const DUE_TONE = { never: 'idle', ok: 'good', due_soon: 'warn', overdue: 'bad' } as const

export default function ChecklistsPage() {
  const { facilityId, ready } = useEnvironmentalScope()
  if (!ready) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        eyebrow="ISO 14001 · 8.1 · 9.1.1"
        title="Checklists"
        description="Inspections and sampling records for this site. Each answer is kept as evidence; a failure raises a finding to follow up."
      />
      {facilityId ? <Suspense fallback={<div className="flex justify-center py-16"><OpsSpinner /></div>}><SiteChecklists /></Suspense> : <SiteRequired />}
    </>
  )
}

function SiteChecklists() {
  const { scope, facilityId } = useEnvironmentalScope()
  const { site } = useEnvironmentalSite()
  const router = useRouter()
  const params = useSearchParams()
  const startKey = params.get('start')
  const obligationId = params.get('obligation')
  const focusSubjectType = params.get('subject_type')
  const focusSubject = params.get('subject')

  const [templates, setTemplates] = useState<ChecklistTemplateRow[] | null>(null)
  const [runs, setRuns] = useState<ChecklistRunRow[]>([])
  const [outfalls, setOutfalls] = useState<Outfall[]>([])
  const [permits, setPermits] = useState<Permit[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [starting, setStarting] = useState<string | null>(null)
  const [choosing, setChoosing] = useState<string | null>(null)
  const [subjectChoice, setSubjectChoice] = useState('')
  const autoStarted = useRef(false)

  useEffect(() => {
    if (!scope) return
    listChecklists(scope).then(r => { setTemplates(r.templates.filter(t => t.subject_type !== 'hw_area')); setRuns(r.runs) }).catch(e => setErrors(errorList(e)))
  }, [scope, facilityId])

  useEffect(() => {
    if (!scope || !templates) return
    if (templates.some(t => t.subject_type === 'outfall')) listOutfalls(scope).then(r => setOutfalls(r.outfalls.filter(o => o.status !== 'removed'))).catch(() => undefined)
    if (templates.some(t => t.subject_type === 'permit')) listPermits(scope).then(r => setPermits(r.permits)).catch(() => undefined)
  }, [scope, templates])

  const start = useCallback(async (template: ChecklistTemplateRow, subjectId: string | null) => {
    if (!scope) return
    setStarting(template.library_key); setErrors([])
    try {
      const { inspection_id } = await startChecklist(scope, {
        library_key: template.library_key,
        ...(subjectId ? { subject_id: subjectId } : {}),
        ...(obligationId && startKey === template.library_key ? { obligation_id: obligationId } : {}),
      })
      router.push(`/environmental/compliance/checklists/${inspection_id}`)
    } catch (e) {
      setErrors(errorList(e)); setStarting(null)
    }
  }, [scope, router, obligationId, startKey])

  // Arriving from a deadline or an outfall: go straight in when nothing more is needed.
  useEffect(() => {
    if (!templates || autoStarted.current) return
    const wanted = startKey ? templates.find(t => t.library_key === startKey) : undefined
    if (!wanted) return
    if (!needsSubject(wanted)) { autoStarted.current = true; void start(wanted, null); return }
    if (focusSubject) { autoStarted.current = true; void start(wanted, focusSubject); return }
    setChoosing(wanted.library_key)
  }, [templates, startKey, focusSubject, start])

  if (errors.length > 0 && !templates) return <ErrorList errors={errors} />
  if (!templates) return <div className="flex justify-center py-16"><OpsSpinner /></div>

  const groups = groupByProgram(templates)
  const subjectOptions = (t: ChecklistTemplateRow) =>
    t.subject_type === 'outfall' ? outfalls.map(o => ({ id: o.id, label: `Outfall ${o.code}${o.name ? `: ${o.name}` : ''}` }))
    : permits.map(p => ({ id: p.id, label: `${p.permit_type}${p.permit_number ? ` ${p.permit_number}` : ''}` }))

  return (
    <div className="space-y-5">
      <JurisdictionBanner site={site} />
      <HowToPanel pageKey="checklists" state={site?.facility.state ?? null} />
      <ErrorList errors={errors} />

      {groups.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck} eyebrow="Nothing yet" title="No checklists apply to this site yet"
          description="Checklists depend on the site's programs. Finish the site profile and set the site up from the library on the Overview page."
          action={<Link href="/environmental/compliance" className={primaryButtonCls}>Go to Overview</Link>}
        />
      ) : groups.map(group => (
        <section key={group.program} className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ENV_PROGRAM_LABELS[group.program]}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {group.templates.map(t => {
              const options = needsSubject(t) ? subjectOptions(t) : []
              const open = choosing === t.library_key || (focusSubjectType === t.subject_type && needsSubject(t))
              return (
                <article key={t.library_key} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.name}</h3>
                    <StatusChip tone={DUE_TONE[t.due_status]} className="ml-auto">{t.due_status === 'overdue' ? 'Overdue' : t.due_status === 'due_soon' ? 'Due soon' : t.due_status === 'ok' ? 'Up to date' : 'Not started'}</StatusChip>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400">{t.description}</p>
                  <p className="text-xs text-slate-500">{t.item_count} questions · {t.cadence.replace('_', ' ')} · {dueText(t)}</p>

                  {needsSubject(t) && open ? (
                    options.length === 0 ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        Add {t.subject_type === 'outfall' ? 'an outfall' : 'a permit'} first on the{' '}
                        <Link className="underline" href={`/environmental/compliance/${t.subject_type === 'outfall' ? 'outfalls' : 'permits'}`}>{t.subject_type === 'outfall' ? 'Outfalls' : 'Permits'}</Link> page.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        <Field label={t.subject_type === 'outfall' ? 'Which outfall' : 'Which permit'}>
                          <select className={inputCls} value={subjectChoice || (focusSubject ?? '')} onChange={e => setSubjectChoice(e.target.value)}>
                            <option value="">Choose…</option>
                            {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                          </select>
                        </Field>
                        <button type="button" className={primaryButtonCls} disabled={starting !== null || !(subjectChoice || focusSubject)} onClick={() => void start(t, subjectChoice || focusSubject)}>
                          {starting === t.library_key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start
                        </button>
                      </div>
                    )
                  ) : (
                    <button
                      type="button" className={primaryButtonCls} disabled={starting !== null}
                      onClick={() => (needsSubject(t) ? setChoosing(t.library_key) : void start(t, null))}
                    >
                      {starting === t.library_key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Start checklist
                    </button>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ))}

      {site && <DraftBadge packs={site.packs} />}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent runs</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No checklists have been run at this site yet.</p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950">
            {runs.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <Link href={`/environmental/compliance/checklists/${r.id}`} className="font-medium text-brand-navy underline-offset-2 hover:underline dark:text-brand-yellow">{r.title}</Link>
                {r.status === 'in_progress'
                  ? <StatusChip tone="warn">In progress</StatusChip>
                  : <StatusChip tone={r.result === 'fail' ? 'bad' : 'good'}>{r.result === 'fail' ? 'Findings raised' : 'Passed'}</StatusChip>}
                <span className="ml-auto text-xs text-slate-500">{(r.submitted_at ?? r.started_at).slice(0, 10)}</span>
                {r.status === 'in_progress' && <Link href={`/environmental/compliance/checklists/${r.id}`} className={secondaryButtonCls}>Resume</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
