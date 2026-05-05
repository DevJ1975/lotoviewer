'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, FileText, ShieldCheck, Pencil } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  groupHazardsByStep,
  groupControlsByHazard,
  highestPotentialSeverity,
  type JhaRow,
  type JhaStep,
  type JhaHazard,
  type JhaHazardControl,
  type JhaSeverity,
  type JhaStatus,
  type JhaFrequency,
} from '@soteria/core/jha'
import { HIERARCHY_LABELS } from '@soteria/core/risk'

interface AuditEvent {
  id:           number
  event_type:   'insert' | 'update' | 'delete'
  actor_email:  string | null
  actor_id:     string | null
  occurred_at:  string
}

interface DetailBundle {
  jha:      JhaRow
  steps:    JhaStep[]
  hazards:  JhaHazard[]
  controls: JhaHazardControl[]
  audit:    AuditEvent[]
}

const SEVERITY_PILL: Record<JhaSeverity, string> = {
  extreme:  'bg-rose-600 text-white',
  high:     'bg-orange-500 text-white',
  moderate: 'bg-amber-400 text-slate-900',
  low:      'bg-emerald-500 text-white',
}

const STATUS_PILL: Record<JhaStatus, string> = {
  draft:       'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_review:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  approved:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  superseded:  'bg-slate-100 text-slate-500 dark:bg-slate-900 dark:text-slate-500',
}

const FREQUENCY_LABEL: Record<JhaFrequency, string> = {
  continuous: 'Continuous',
  daily:      'Daily',
  weekly:     'Weekly',
  monthly:    'Monthly',
  quarterly:  'Quarterly',
  annually:   'Annually',
  as_needed:  'As needed',
}

export default function JhaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canEdit = !!profile?.is_admin || !!profile?.is_superadmin

  const [bundle, setBundle] = useState<DetailBundle | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/jha/${id}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setBundle(body as DetailBundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id, id])

  useEffect(() => { void load() }, [load])

  if (!bundle && !error) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/jha"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to JHAs
        </Link>
        {canEdit && bundle && bundle.jha.status !== 'superseded' && (
          <Link
            href={`/jha/${id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit breakdown
          </Link>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {bundle && (
        <>
          <header className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{bundle.jha.job_number}</p>
                <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                  {bundle.jha.title}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase ${STATUS_PILL[bundle.jha.status]}`}>
                  {bundle.jha.status.replace('_', ' ')}
                </span>
              </div>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Meta label="Frequency"     value={FREQUENCY_LABEL[bundle.jha.frequency]} />
              <Meta label="Location"      value={bundle.jha.location ?? '—'} />
              <Meta label="Performed by"  value={bundle.jha.performed_by ?? '—'} />
              <Meta label="Steps"         value={String(bundle.steps.length)} />
              <Meta label="Hazards"       value={String(bundle.hazards.length)} />
              <Meta label="Worst case"    value={highestPotentialSeverity(bundle.hazards) ?? '—'} capitalize />
              <Meta label="Next review"   value={bundle.jha.next_review_date ?? '—'} />
              <Meta label="Approved"      value={bundle.jha.approved_at ? formatDate(bundle.jha.approved_at) : '—'} />
            </dl>
          </header>

          {bundle.jha.description && (
            <Section title="Description">
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">{bundle.jha.description}</p>
            </Section>
          )}

          {bundle.jha.required_ppe.length > 0 && (
            <Section title="Required PPE">
              <ul className="flex flex-wrap gap-2">
                {bundle.jha.required_ppe.map(p => (
                  <li key={p} className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/40 text-amber-900 dark:text-amber-100 px-2 py-1 text-xs font-semibold">
                    <ShieldCheck className="h-3 w-3" />
                    {p}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`Steps & hazards (${bundle.steps.length} ${bundle.steps.length === 1 ? 'step' : 'steps'})`}>
            {bundle.steps.length === 0 && bundle.hazards.length === 0 ? (
              <EmptyBreakdown />
            ) : (
              <StepsAndHazards bundle={bundle} />
            )}
          </Section>

          <Section title="Audit timeline">
            {bundle.audit.length === 0 ? (
              <p className="text-sm italic text-slate-400">No events.</p>
            ) : (
              <ol className="space-y-2 text-xs">
                {bundle.audit.map(ev => (
                  <li key={ev.id} className="flex items-baseline gap-3 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                    <span className="font-mono text-slate-400 shrink-0 tabular-nums">{formatDate(ev.occurred_at)}</span>
                    <span className="font-semibold uppercase text-slate-700 dark:text-slate-300">{ev.event_type}</span>
                    <span className="text-slate-500 dark:text-slate-400">{ev.actor_email ?? ev.actor_id ?? 'system'}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function StepsAndHazards({ bundle }: { bundle: DetailBundle }) {
  const grouped = groupHazardsByStep(bundle.steps, bundle.hazards)
  const controlsByHazard = groupControlsByHazard(bundle.hazards, bundle.controls)
  return (
    <ol className="space-y-4">
      {grouped.map((g, i) => (
        <li key={g.step?.id ?? `general-${i}`} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
          <div className="flex items-baseline gap-2">
            {g.step ? (
              <>
                <span className="font-mono text-xs text-slate-400 tabular-nums">{g.step.sequence}.</span>
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{g.step.description}</span>
              </>
            ) : (
              <span className="text-xs uppercase tracking-wider font-bold text-slate-400">General hazards</span>
            )}
          </div>
          {g.step?.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{g.step.notes}</p>}

          {g.hazards.length === 0 ? (
            <p className="mt-2 text-xs italic text-slate-400">No hazards identified.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {g.hazards.map(h => (
                <li key={h.id} className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_PILL[h.potential_severity]}`}>
                      {h.potential_severity}
                    </span>
                    <span className="text-[11px] capitalize text-slate-500 dark:text-slate-400">{h.hazard_category}</span>
                    <span className="text-sm text-slate-800 dark:text-slate-200">{h.description}</span>
                  </div>
                  {h.notes && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{h.notes}</p>}
                  <ControlList controls={controlsByHazard.get(h.id) ?? []} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

function ControlList({ controls }: { controls: JhaHazardControl[] }) {
  if (controls.length === 0) {
    return <p className="mt-2 text-[11px] italic text-rose-700 dark:text-rose-400">No controls — needs attention.</p>
  }
  return (
    <ul className="mt-2 space-y-1">
      {controls.map(c => (
        <li key={c.id} className="flex items-baseline gap-2 text-xs">
          <span className="font-bold text-[10px] uppercase text-slate-500 dark:text-slate-400 w-24 shrink-0">
            {HIERARCHY_LABELS[c.hierarchy_level]}
          </span>
          <span className="text-slate-700 dark:text-slate-300">{c.custom_name ?? c.control_id}</span>
        </li>
      ))}
    </ul>
  )
}

function EmptyBreakdown() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
      <FileText className="h-6 w-6 mx-auto text-slate-300 dark:text-slate-600" />
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        No steps or hazards yet. Click <span className="font-semibold">Edit breakdown</span> to add them.
      </p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

function Meta({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={'text-sm text-slate-700 dark:text-slate-300 ' + (capitalize ? 'capitalize' : '')}>{value}</dd>
    </div>
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
