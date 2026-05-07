'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  STATUS_LABEL,
  type IncidentRow,
  type IncidentStatus,
  INCIDENT_STATUSES,
} from '@soteria/core/incident'

// /incidents/[id] — Phase 1 overview shell. The full investigation /
// RCA / CAPA / care / OSHA tabs ship in later phases — this page lands
// the core info + a status transition button so the on-shift workflow
// works end-to-end today.

const STATUS_OPTIONS: ReadonlyArray<IncidentStatus> = [
  'reported', 'triaged', 'investigating', 'pending_review', 'closed', 'reopened',
]

interface PersonRow {
  id:           string
  person_role:  string
  full_name:    string | null
  email:        string | null
  job_title:    string | null
  is_primary:   boolean
}

interface NotificationRow {
  id:               number
  rule_id:          string | null
  trigger_type:     string
  channel:          string
  recipient_email:  string | null
  status:           string
  error_text:       string | null
  sent_at:          string
}

export default function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()

  const [incident, setIncident] = useState<IncidentRow | null>(null)
  const [people,   setPeople]   = useState<PersonRow[]>([])
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy,  setBusy]  = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const [incRes, peopleRes] = await Promise.all([
        fetch(`/api/incidents/${id}`, { headers }),
        fetch(`/api/incidents/${id}/people`, { headers }),
      ])
      const incBody    = await incRes.json()
      const peopleBody = await peopleRes.json()
      if (!incRes.ok)    throw new Error(incBody.error    ?? `HTTP ${incRes.status}`)
      if (!peopleRes.ok) throw new Error(peopleBody.error ?? `HTTP ${peopleRes.status}`)

      setIncident(incBody.report as IncidentRow)
      setPeople(peopleBody.people as PersonRow[])

      // Best-effort load of the per-incident notifications log. The
      // table is RLS-scoped to tenant members so we hit it directly
      // via the supabase client rather than a dedicated API route.
      const { data: notifs } = await supabase
        .from('incident_notifications')
        .select('id, rule_id, trigger_type, channel, recipient_email, status, error_text, sent_at')
        .eq('incident_id', id)
        .order('sent_at', { ascending: false })
        .limit(50)
      setNotifications((notifs as NotificationRow[] | null) ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  async function patchStatus(next: IncidentStatus) {
    if (!tenant?.id || !id) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: next }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setIncident(body.report as IncidentRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-slate-500">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (!incident) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incidents
      </Link>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <nav className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800 -mb-2">
        <span className="border-b-2 border-brand-navy px-3 py-1.5 text-xs font-semibold text-brand-navy">Overview</span>
        <Link href={`/incidents/${id}/investigate`} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
          Investigate
        </Link>
        <Link href={`/incidents/${id}/rca`} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
          RCA
        </Link>
        <Link href={`/incidents/${id}/actions`} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
          Actions
        </Link>
        {incident.incident_type === 'injury_illness' && (
          <Link href={`/incidents/${id}/care`} className="px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
            Care
          </Link>
        )}
      </nav>

      {/* ── Header ───────────────────────────────────────────────── */}
      <header className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-slate-500 dark:text-slate-400">{incident.report_number}</span>
          <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {INCIDENT_TYPE_LABEL[incident.incident_type]}
          </span>
          <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {STATUS_LABEL[incident.status]}
          </span>
          {incident.severity_actual !== 'none' && (
            <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200">
              {SEVERITY_ACTUAL_LABEL[incident.severity_actual]}
            </span>
          )}
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
          {incident.location_text || 'Incident'}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Occurred {new Date(incident.occurred_at).toLocaleString()}
          {' · Reported '}{new Date(incident.reported_at).toLocaleString()}
        </p>
      </header>

      {/* ── Description ──────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          What happened
        </h2>
        <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{incident.description}</p>
        {incident.immediate_action_taken && (
          <>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              Immediate action taken
            </h3>
            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{incident.immediate_action_taken}</p>
          </>
        )}
      </section>

      {/* ── Status transition ────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          Status
        </h2>
        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              type="button"
              disabled={busy || s === incident.status || !INCIDENT_STATUSES.includes(s)}
              onClick={() => patchStatus(s)}
              className={
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ' +
                (s === incident.status
                  ? 'border-brand-navy bg-brand-navy text-white cursor-default'
                  : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-600 disabled:opacity-50')
              }
            >
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Changing status to anything other than <em>Reported</em> requires admin/owner.
        </p>
      </section>

      {/* ── People ──────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          People involved ({people.length})
        </h2>
        {people.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No people attached yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {people.map(p => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-slate-800 dark:text-slate-200">
                    {p.full_name || '—'}
                  </span>
                  {p.is_primary && (
                    <span className="ml-2 inline-block rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 text-[10px] px-1.5 py-0.5">PRIMARY</span>
                  )}
                  <span className="ml-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {p.person_role.replace(/_/g, ' ')}
                  </span>
                </div>
                {p.email && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{p.email}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Notifications log ────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          Notifications sent
        </h2>
        {notifications.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">No notifications fired.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {notifications.map(n => (
              <li key={n.id} className="grid grid-cols-[80px_60px_1fr_auto] gap-3 py-2 text-xs items-center">
                <span className="font-mono text-slate-500 dark:text-slate-400">{n.channel}</span>
                <span className={
                  'inline-block rounded-full px-1.5 py-0.5 text-[10px] font-semibold ' +
                  (n.status === 'sent' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
                   : n.status === 'failed' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
                   : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300')
                }>
                  {n.status}
                </span>
                <span className="truncate text-slate-700 dark:text-slate-300">
                  {n.recipient_email ?? '(role recipient)'}
                  {n.error_text && (
                    <span className="ml-2 text-rose-500">{n.error_text}</span>
                  )}
                </span>
                <span className="text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  {new Date(n.sent_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-slate-400 dark:text-slate-500">
        Investigation, RCA, CAPA actions, care management, and OSHA classification ship in later phases.
      </p>
    </div>
  )
}
