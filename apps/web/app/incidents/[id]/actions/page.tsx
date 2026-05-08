'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Loader2, Plus, Trash2, ChevronDown } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import ActionCommentThread from '@/components/ActionCommentThread'
import type { MentionMember } from '@/components/MentionInput'
import {
  INCIDENT_ACTION_TYPES,
  ACTION_TYPE_LABEL,
  HIERARCHY_OF_CONTROLS,
  HIERARCHY_LABEL,
  INCIDENT_ACTION_STATUSES,
  ACTION_STATUS_LABEL,
  daysUntilDue,
  type IncidentActionRow,
  type IncidentActionType,
  type HierarchyOfControls,
  type IncidentActionStatus,
} from '@soteria/core/incidentAction'

// /incidents/[id]/actions — CAPA list + add form.
//
// Members can file new actions and update their own. Admins can edit
// every field. Verification gate (different user from the closer) is
// enforced server-side.

const STATUS_PILL: Record<IncidentActionStatus, string> = {
  open:        'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  in_progress: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  blocked:     'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  complete:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  verified:    'bg-emerald-200 text-emerald-900 dark:bg-emerald-700/40 dark:text-emerald-100',
  cancelled:   'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

interface MemberOption {
  user_id:    string
  email:      string | null
  full_name:  string | null
  avatar_url: string | null
}

export default function ActionsPage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()

  const [actions, setActions] = useState<IncidentActionRow[]>([])
  const [members, setMembers] = useState<MemberOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [showForm, setShowForm] = useState(false)

  // Form state.
  const [aType,  setAType]  = useState<IncidentActionType>('corrective')
  const [hier,   setHier]   = useState<HierarchyOfControls | ''>('')
  const [desc,   setDesc]   = useState('')
  const [owner,  setOwner]  = useState<string>('')
  const [dueAt,  setDueAt]  = useState<string>('')

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch(`/api/incidents/${id}/actions`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setActions(body.actions as IncidentActionRow[])

      // Best-effort member lookup for the owner picker + comment
      // mention autocomplete. We hit the tenant_memberships
      // RLS-scoped view directly via supabase.
      const { data: mems } = await supabase
        .from('tenant_memberships')
        .select('user_id, profiles:profiles!inner(email, full_name, avatar_url)')
        .eq('tenant_id', tenant.id)
      type Row = {
        user_id: string
        profiles:
          | { email: string | null; full_name: string | null; avatar_url: string | null }
          | { email: string | null; full_name: string | null; avatar_url: string | null }[]
          | null
      }
      const opts: MemberOption[] = ((mems as Row[] | null) ?? []).map(m => {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        return {
          user_id:    m.user_id,
          email:      p?.email ?? null,
          full_name:  p?.full_name ?? null,
          avatar_url: p?.avatar_url ?? null,
        }
      })
      setMembers(opts)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant!.id,
    }
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    if (!desc.trim()) { setError('Description is required'); return }
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/actions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action_type:           aType,
          hierarchy_of_controls: hier || null,
          description:           desc.trim(),
          owner_user_id:         owner || null,
          due_at:                dueAt ? new Date(dueAt).toISOString() : null,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setActions(prev => [...prev, body.action as IncidentActionRow])
      setDesc(''); setHier(''); setOwner(''); setDueAt('')
      setShowForm(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function updateAction(actionId: string, patch: Partial<{
    status: IncidentActionStatus; verification_evidence: string; cancel_reason: string
  }>) {
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/actions/${actionId}`, {
        method:  'PATCH',
        headers,
        body:    JSON.stringify(patch),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setActions(prev => prev.map(a => a.id === actionId ? (body.action as IncidentActionRow) : a))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeAction(actionId: string) {
    if (!confirm('Delete this action?')) return
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/actions/${actionId}`, {
        method:  'DELETE',
        headers,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setActions(prev => prev.filter(a => a.id !== actionId))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incident
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Corrective &amp; preventive actions</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Drive each finding to a verified close. Assignees get an email; reminders fire 3 days out and on overdue.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" />
          {showForm ? 'Cancel' : 'New action'}
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showForm && (
        <form onSubmit={submitNew} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</span>
              <select
                value={aType}
                onChange={e => setAType(e.target.value as IncidentActionType)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              >
                {INCIDENT_ACTION_TYPES.map(t => (
                  <option key={t} value={t}>{ACTION_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hierarchy of controls</span>
              <select
                value={hier}
                onChange={e => setHier(e.target.value as HierarchyOfControls)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {HIERARCHY_OF_CONTROLS.map(h => (
                  <option key={h} value={h}>{HIERARCHY_LABEL[h]}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              rows={3}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Owner</span>
              <select
                value={owner}
                onChange={e => setOwner(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              >
                <option value="">— unassigned —</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.full_name || m.email || m.user_id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Due</span>
              <input
                type="datetime-local"
                value={dueAt}
                onChange={e => setDueAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="submit"
              disabled={busy || !desc.trim()}
              className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {actions.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No actions on this incident yet.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {actions.map(a => (
            <ActionRow
              key={a.id}
              incidentId={id}
              action={a}
              members={members}
              onUpdate={updateAction}
              onDelete={removeAction}
              busy={busy}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ActionRow({
  incidentId, action, members, onUpdate, onDelete, busy,
}: {
  incidentId: string
  action:   IncidentActionRow
  members:  MemberOption[]
  onUpdate: (id: string, patch: Partial<{ status: IncidentActionStatus; verification_evidence: string; cancel_reason: string }>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  busy:     boolean
}) {
  const days = daysUntilDue(action)
  const overdue = days != null && days < 0 && (action.status === 'open' || action.status === 'in_progress' || action.status === 'blocked')
  const ownerName = members.find(m => m.user_id === action.owner_user_id)?.full_name
                 ?? members.find(m => m.user_id === action.owner_user_id)?.email
                 ?? null
  const [evidence, setEvidence] = useState(action.verification_evidence ?? '')
  const [showEvidence, setShowEvidence] = useState(false)

  return (
    <li className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_PILL[action.status]}`}>
              {ACTION_STATUS_LABEL[action.status]}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {ACTION_TYPE_LABEL[action.action_type]}
            </span>
            {action.hierarchy_of_controls && (
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                · {HIERARCHY_LABEL[action.hierarchy_of_controls]}
              </span>
            )}
            {overdue && (
              <span className="inline-block rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200 px-2 py-0.5 text-[10px] font-bold">
                OVERDUE {Math.abs(days!)}d
              </span>
            )}
          </div>
          <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{action.description}</p>
          <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Owner: {ownerName ?? '—'}</span>
            <span>Due: {action.due_at ? new Date(action.due_at).toLocaleString() : '—'}</span>
            {action.verified_at && <span>Verified {new Date(action.verified_at).toLocaleDateString()}</span>}
          </div>
          {action.verification_evidence && (
            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 italic">
              Evidence: {action.verification_evidence}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void onDelete(action.id)}
          disabled={busy}
          title="Delete (admin only)"
          className="shrink-0 rounded-md p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={action.status}
          onChange={e => void onUpdate(action.id, { status: e.target.value as IncidentActionStatus })}
          disabled={busy}
          className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-xs"
        >
          {INCIDENT_ACTION_STATUSES.map(s => (
            <option key={s} value={s}>{ACTION_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowEvidence(v => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <ChevronDown className={'h-3 w-3 transition-transform ' + (showEvidence ? 'rotate-180' : '')} />
          Verification evidence
        </button>
      </div>
      {showEvidence && (
        <div className="flex flex-col sm:flex-row gap-2">
          <textarea
            value={evidence}
            onChange={e => setEvidence(e.target.value)}
            rows={2}
            placeholder="Photo URL, work-order #, training log…"
            className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-xs"
          />
          <button
            type="button"
            disabled={busy || evidence === (action.verification_evidence ?? '')}
            onClick={() => void onUpdate(action.id, { verification_evidence: evidence })}
            className="rounded-lg bg-brand-navy text-white px-3 py-1 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      )}

      <ActionCommentThread
        incidentId={incidentId}
        actionId={action.id}
        members={members as MentionMember[]}
      />
    </li>
  )
}
