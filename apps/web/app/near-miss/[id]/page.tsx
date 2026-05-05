'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, ArrowUpRight } from 'lucide-react'
import EscalateModal from '../_components/EscalateModal'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'

// Edit gate uses the legacy is_admin / is_superadmin flags on the
// profile (same posture as /risk/[id]). The API enforces the
// tenant-membership role independently — this is just a UX gate
// that hides the controls from users who can't use them.
import {
  NEAR_MISS_STATUSES,
  ageInDays,
  type NearMissRow,
  type NearMissSeverity,
  type NearMissStatus,
} from '@soteria/core/nearMiss'
import { SEVERITY_TW } from '@soteria/core/severityColors'

interface AuditEvent {
  id:           number
  event_type:   'insert' | 'update' | 'delete'
  before_row:   Record<string, unknown> | null
  after_row:    Record<string, unknown> | null
  actor_id:     string | null
  actor_email:  string | null
  context:      string | null
  occurred_at:  string
}

interface DetailBundle {
  report: NearMissRow
  audit:  AuditEvent[]
}

// SEVERITY_PILL replaced by SEVERITY_TW from @soteria/core/severityColors

const STATUS_LABEL: Record<NearMissStatus, string> = {
  new:                 'New',
  triaged:             'Triaged',
  investigating:       'Investigating',
  closed:              'Closed',
  escalated_to_risk:   'Escalated',
}

export default function NearMissDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canEdit = !!profile?.is_admin || !!profile?.is_superadmin

  const [bundle,        setBundle]        = useState<DetailBundle | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [saving,        setSaving]        = useState(false)
  const [showEscalate,  setShowEscalate]  = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/near-miss/${id}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setBundle(body as DetailBundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id, id])

  useEffect(() => { void load() }, [load])

  async function patch(update: Record<string, unknown>) {
    if (!tenant?.id) return
    setSaving(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/near-miss/${id}`, {
        method: 'PATCH', headers, body: JSON.stringify(update),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  if (!bundle && !error) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link
        href="/near-miss"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to reports
      </Link>

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
                <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{bundle.report.report_number}</p>
                <h1 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                  {bundle.report.description.length > 80
                    ? bundle.report.description.slice(0, 80) + '…'
                    : bundle.report.description}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase ${SEVERITY_TW[bundle.report.severity_potential]}`}>
                  {bundle.report.severity_potential}
                </span>
                <span className="rounded-md px-2 py-1 text-[11px] font-semibold uppercase bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  {STATUS_LABEL[bundle.report.status]}
                </span>
              </div>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <Meta label="Occurred"   value={formatDate(bundle.report.occurred_at)} />
              <Meta label="Reported"   value={formatDate(bundle.report.reported_at)} />
              <Meta label="Age"        value={`${ageInDays(bundle.report)} d`} />
              <Meta label="Hazard"     value={bundle.report.hazard_category} capitalize />
              <Meta label="Location"   value={bundle.report.location ?? '—'} />
              <Meta
                label="Linked risk"
                value={bundle.report.linked_risk_id ?? '—'}
                href={bundle.report.linked_risk_id ? `/risk/${bundle.report.linked_risk_id}` : undefined}
              />
            </dl>
          </header>

          <Section title="What happened">
            <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
              {bundle.report.description}
            </p>
          </Section>

          {bundle.report.immediate_action_taken && (
            <Section title="Immediate action taken">
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                {bundle.report.immediate_action_taken}
              </p>
            </Section>
          )}

          {bundle.report.resolution_notes && (
            <Section title="Resolution notes">
              <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
                {bundle.report.resolution_notes}
              </p>
            </Section>
          )}

          {canEdit && (
            <Section title="Triage">
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-sm text-slate-600 dark:text-slate-300">Status</label>
                <select
                  value={bundle.report.status}
                  disabled={saving || bundle.report.status === 'escalated_to_risk'}
                  onChange={e => patch({ status: e.target.value as NearMissStatus })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-sm"
                >
                  {NEAR_MISS_STATUSES.map(s => (
                    <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                  ))}
                </select>
                {saving && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}

                {bundle.report.status !== 'escalated_to_risk' && (
                  <button
                    type="button"
                    onClick={() => setShowEscalate(true)}
                    className="ml-auto inline-flex items-center gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 px-3 py-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                    Escalate to Risk Register
                  </button>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                Status changes are logged to the audit timeline below.
                {bundle.report.status === 'escalated_to_risk' && ' Escalated reports are read-only.'}
              </p>
            </Section>
          )}

          {showEscalate && (
            <EscalateModal
              nearMissId={bundle.report.id}
              onClose={() => setShowEscalate(false)}
            />
          )}

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h2>
      {children}
    </section>
  )
}

function Meta({ label, value, capitalize, href }: { label: string; value: string; capitalize?: boolean; href?: string }) {
  const cls = 'text-sm text-slate-700 dark:text-slate-300 ' + (capitalize ? 'capitalize' : '')
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className={cls}>
        {href ? (
          <Link href={href} className="text-brand-navy hover:underline font-mono text-xs">
            {value.slice(0, 8)}…
          </Link>
        ) : value}
      </dd>
    </div>
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
