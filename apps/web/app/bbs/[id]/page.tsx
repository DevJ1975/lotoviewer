'use client'

import { useCallback, useEffect, useState, use } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  BBS_KIND_LABEL,
  BBS_STATUS_LABEL,
  type BBSKind,
  type BBSStatus,
} from '@soteria/core/bbs'
import { KindBadge, RiskScoreBadge } from '../_components/KindBadge'

interface Observation {
  id:                     string
  report_number:          string
  kind:                   BBSKind
  status:                 BBSStatus
  description:            string
  immediate_action_taken: string | null
  abc_antecedent:         string | null
  abc_behavior:           string | null
  abc_consequence:        string | null
  category:               string | null
  department:             string | null
  location_text:          string | null
  severity:               string | null
  likelihood:             string | null
  risk_score:             number | null
  observed_at:            string
  created_at:             string
  closed_at:              string | null
  submitted_by:           string | null
  submitted_name:         string | null
  anonymous:              boolean
  points_awarded:         number
  corrective_action:      string | null
  due_date:               string | null
  assigned_to:            string | null
}

interface ActionRow {
  id:           number
  action_type:  string
  body:         string | null
  meta:         Record<string, unknown> | null
  created_at:   string
}

export default function BBSDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { tenant } = useTenant()
  const [obs, setObs] = useState<Observation | null>(null)
  const [actions, setActions] = useState<ActionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [correctiveAction, setCorrectiveAction] = useState('')
  const [dueDate, setDueDate] = useState('')

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(`/api/bbs/observations/${id}`, { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    setObs(body.observation)
    setActions(body.actions ?? [])
    setCorrectiveAction(body.observation.corrective_action ?? '')
    setDueDate(body.observation.due_date ?? '')
  }, [tenant?.id, id])

  useEffect(() => { void load() }, [load])

  async function patch(update: Record<string, unknown>) {
    if (!tenant?.id) return
    setSaving(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/bbs/observations/${id}`, {
        method:  'PATCH',
        headers,
        body:    JSON.stringify(update),
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

  if (error) return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
        {error}
      </div>
    </div>
  )

  if (!obs) return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex items-center gap-2 text-slate-500">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading…
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/bbs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" />
        Back to BBS
      </Link>

      <header className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-xs text-slate-500">{obs.report_number}</span>
          <KindBadge kind={obs.kind} />
          <RiskScoreBadge score={obs.risk_score} />
          <span className="px-2 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
            {BBS_STATUS_LABEL[obs.status]}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
          {BBS_KIND_LABEL[obs.kind]}
        </h1>
        <div className="text-xs text-slate-500">
          Submitted {obs.anonymous ? 'anonymously' : `by ${obs.submitted_name ?? 'a team member'}`}
          {' · '}
          {new Date(obs.created_at).toLocaleString()}
          {obs.points_awarded > 0 && !obs.anonymous && <> · <span className="font-semibold">+{obs.points_awarded} pts</span></>}
        </div>
      </header>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <div>
          <div className="text-xs uppercase text-slate-500 mb-1">Description</div>
          <p className="text-sm whitespace-pre-wrap">{obs.description}</p>
        </div>
        {obs.immediate_action_taken && (
          <div>
            <div className="text-xs uppercase text-slate-500 mb-1">Immediate action taken</div>
            <p className="text-sm whitespace-pre-wrap">{obs.immediate_action_taken}</p>
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {obs.location_text && <div><span className="text-slate-500">Location:</span> {obs.location_text}</div>}
          {obs.department    && <div><span className="text-slate-500">Department:</span> {obs.department}</div>}
          {obs.category      && <div><span className="text-slate-500">Category:</span> {obs.category}</div>}
          {obs.severity      && <div><span className="text-slate-500">Severity:</span> {obs.severity}</div>}
          {obs.likelihood    && <div><span className="text-slate-500">Likelihood:</span> {obs.likelihood}</div>}
        </div>
        {(obs.abc_antecedent || obs.abc_behavior || obs.abc_consequence) && (
          <div className="border-t border-slate-200 dark:border-slate-800 pt-3">
            <div className="text-xs uppercase text-slate-500 mb-1">ABC analysis</div>
            <dl className="text-sm space-y-1">
              {obs.abc_antecedent && <div><dt className="inline font-medium">Antecedent: </dt><dd className="inline">{obs.abc_antecedent}</dd></div>}
              {obs.abc_behavior   && <div><dt className="inline font-medium">Behavior: </dt><dd className="inline">{obs.abc_behavior}</dd></div>}
              {obs.abc_consequence && <div><dt className="inline font-medium">Consequence: </dt><dd className="inline">{obs.abc_consequence}</dd></div>}
            </dl>
          </div>
        )}
      </section>

      {/* Close-out panel — admins only via API; the button is shown
          to everyone but the API enforces. */}
      {obs.kind !== 'safe_behavior' && obs.status !== 'closed' && obs.status !== 'invalid' && (
        <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Close-out</h2>
          <div>
            <label className="block text-sm font-medium mb-1">Corrective action</label>
            <textarea
              value={correctiveAction}
              onChange={e => setCorrectiveAction(e.target.value)}
              rows={3}
              placeholder="What was done (or will be done) to eliminate the hazard?"
              className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">Due date</label>
              <input
                type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={saving}
              onClick={() => patch({
                corrective_action: correctiveAction || null,
                due_date:          dueDate || null,
                status:            'in_progress',
              })}
              className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Save & mark in progress
            </button>
            <button
              type="button"
              disabled={saving || !correctiveAction.trim()}
              onClick={() => patch({
                corrective_action: correctiveAction,
                due_date:          dueDate || null,
                status:            'closed',
              })}
              className="px-3 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1 disabled:bg-emerald-400"
            >
              <Check className="w-4 h-4" /> Close out
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => patch({ status: 'invalid' })}
              className="px-3 py-2 text-sm rounded border border-rose-300 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 inline-flex items-center gap-1"
            >
              <X className="w-4 h-4" /> Mark invalid
            </button>
          </div>
        </section>
      )}

      {obs.status === 'closed' && obs.corrective_action && (
        <section className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4">
          <h2 className="font-semibold text-emerald-900 dark:text-emerald-100">Closed out</h2>
          <p className="text-sm mt-1 whitespace-pre-wrap">{obs.corrective_action}</p>
          {obs.closed_at && <p className="text-xs text-slate-500 mt-2">on {new Date(obs.closed_at).toLocaleDateString()}</p>}
        </section>
      )}

      {actions.length > 0 && (
        <section>
          <h2 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">Timeline</h2>
          <ol className="space-y-2">
            {actions.map(a => (
              <li key={a.id} className="text-xs text-slate-600 dark:text-slate-300">
                <span className="text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
                {' · '}
                <span className="font-medium">{a.action_type.replace('_', ' ')}</span>
                {a.body && <> — {a.body}</>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
