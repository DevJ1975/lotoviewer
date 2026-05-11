'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Clock,
  ExternalLink,
  Loader2,
  ShieldAlert,
  UserRound,
} from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  STATUS_LABEL,
  type IncidentRow,
} from '@soteria/core/incident'
import type {
  CommandCenterAlertStatus,
  CommandCenterAlertTone,
  CommandCenterSafetyAlertDetail,
} from '@soteria/core/incidentSafetyAlerts'

interface SafetyAlertPersonRow {
  id:          string
  person_role: string
  full_name:   string | null
  email:       string | null
  job_title:   string | null
  is_primary:  boolean
}

interface SafetyAlertNotificationRow {
  id:              number
  rule_id:         string | null
  trigger_type:    string
  channel:         string
  recipient_email: string | null
  status:          string
  error_text:      string | null
  sent_at:         string
}

interface SafetyAlertDetailResponse {
  alert:         CommandCenterSafetyAlertDetail
  incident:      IncidentRow
  people:        SafetyAlertPersonRow[]
  notifications: SafetyAlertNotificationRow[]
}

const ALERT_STATUS_LABEL: Record<CommandCenterAlertStatus, string> = {
  new:          'New',
  acknowledged: 'Acknowledged',
  in_review:   'In review',
  escalated:   'Escalated',
  resolved:    'Resolved',
  dismissed:   'Dismissed',
}

const TONE_LABEL: Record<CommandCenterAlertTone, string> = {
  critical:  'Critical',
  warning:   'Warning',
  attention: 'Attention',
}

export default function SafetyAlertDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()

  const [data, setData] = useState<SafetyAlertDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch(`/api/safety-alerts/${id}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body as SafetyAlertDetailResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <BackLink />
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  const { alert, incident, people, notifications } = data
  const Icon = iconForTone(alert.severity_tone)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <BackLink />

      <section className="rounded-lg border-2 border-rose-500 bg-rose-700 text-white shadow-sm">
        <div className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide text-rose-100">
                <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1">
                  <Icon className="h-3.5 w-3.5" />
                  {TONE_LABEL[alert.severity_tone]} safety alert
                </span>
                <span>{ALERT_STATUS_LABEL[alert.status]}</span>
                <span>{alert.report_number}</span>
              </div>
              <h1 className="mt-3 text-2xl font-black tracking-normal sm:text-3xl">
                {alert.title}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-rose-50 sm:text-base">
                {alert.summary}
              </p>
            </div>
            <Link
              href={`/incidents/${incident.id}`}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-bold text-rose-700 hover:bg-rose-50"
            >
              Incident file
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <FactTile label="Occurred" value={formatDateTime(incident.occurred_at)} />
        <FactTile label="Reported" value={formatDateTime(incident.reported_at)} />
        <FactTile label="Incident status" value={STATUS_LABEL[incident.status]} />
        <FactTile label="Alert priority" value={String(alert.priority)} />
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          What happened
        </h2>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">
          {incident.description}
        </p>
        {incident.immediate_action_taken && (
          <>
            <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Immediate action taken
            </h3>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800 dark:text-slate-100">
              {incident.immediate_action_taken}
            </p>
          </>
        )}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Incident details">
          <DetailRow label="Type" value={INCIDENT_TYPE_LABEL[incident.incident_type]} />
          <DetailRow label="Location" value={incident.location_text || 'Not provided'} />
          <DetailRow label="Actual severity" value={SEVERITY_ACTUAL_LABEL[incident.severity_actual]} />
          <DetailRow label="Potential severity" value={incident.severity_potential ?? 'Not assessed'} />
          <DetailRow label="Probability" value={incident.probability ?? 'Not assessed'} />
          <DetailRow label="Shift" value={incident.shift ?? 'Not recorded'} />
          <DetailRow label="Anonymous report" value={incident.is_anonymous ? 'Yes' : 'No'} />
        </Panel>

        <Panel title="Alert record">
          <DetailRow label="Alert id" value={alert.id} mono />
          <DetailRow label="Source" value={alert.source.replaceAll('_', ' ')} />
          <DetailRow label="Created" value={formatDateTime(alert.created_at)} />
          <DetailRow label="Updated" value={formatDateTime(alert.updated_at)} />
          <DetailRow label="Acknowledged" value={alert.acknowledged_at ? formatDateTime(alert.acknowledged_at) : 'Not acknowledged'} />
          <DetailRow label="Resolved" value={alert.resolved_at ? formatDateTime(alert.resolved_at) : 'Open'} />
          {alert.resolution_note && <DetailRow label="Resolution note" value={alert.resolution_note} />}
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={`People involved (${people.length})`}>
          {people.length === 0 ? (
            <EmptyLine icon={<UserRound className="h-4 w-4" />} text="No people have been attached to this incident yet." />
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {people.map(person => (
                <div key={person.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {person.full_name || person.email || 'Unnamed person'}
                    {person.is_primary && <span className="ml-2 text-xs text-rose-700 dark:text-rose-300">Primary</span>}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {person.person_role.replaceAll('_', ' ')}
                    {person.job_title ? ` · ${person.job_title}` : ''}
                    {person.email ? ` · ${person.email}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title={`Notifications (${notifications.length})`}>
          {notifications.length === 0 ? (
            <EmptyLine icon={<BellRing className="h-4 w-4" />} text="No notification delivery records are attached yet." />
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {notifications.map(notification => (
                <div key={notification.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {notification.channel} · {notification.status}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {notification.recipient_email || 'No recipient'} · {formatDateTime(notification.sent_at)}
                  </p>
                  {notification.error_text && (
                    <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{notification.error_text}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/?dashboard=1" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
      <ArrowLeft className="h-4 w-4" />
      Back to dashboard
    </Link>
  )
}

function FactTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-slate-100 py-2 text-sm last:border-0 dark:border-slate-800">
      <span className="text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`${mono ? 'font-mono text-xs' : ''} min-w-0 break-words font-medium text-slate-900 dark:text-slate-100`}>
        {value}
      </span>
    </div>
  )
}

function EmptyLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
      {icon}
      {text}
    </p>
  )
}

function iconForTone(tone: CommandCenterAlertTone) {
  if (tone === 'critical') return ShieldAlert
  if (tone === 'warning') return AlertTriangle
  return Clock
}

function formatDateTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}
