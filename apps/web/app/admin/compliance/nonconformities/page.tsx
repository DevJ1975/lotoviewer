'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  canVerifyAction,
  summarizeActions,
  NONCONFORMITY_SOURCE_TYPES,
  NONCONFORMITY_CLASSIFICATIONS,
  ACTION_TYPES,
  type NonconformitySourceType,
  type NonconformityClassification,
  type NonconformityStatus,
  type ActionType,
  type ActionStatus,
} from '@soteria/core/nonconformity'

// /admin/compliance/nonconformities — source-agnostic finding + CAPA
// register (ISO 14001 §10.2 / §9.2). Each finding holds corrective actions
// with the §10.2 verification loop: a different user must verify the close.

interface NcRow {
  id:             string
  title:          string
  source_type:    NonconformitySourceType
  classification: NonconformityClassification
  clause_ref:     string | null
  status:         NonconformityStatus
  identified_at:  string
}

interface ActionRow {
  id:                   string
  nonconformity_id:     string
  description:          string
  action_type:          ActionType
  due_at:               string | null
  status:               ActionStatus
  completed_by_user_id: string | null
}

const CLASS_BADGE: Record<NonconformityClassification, string> = {
  observation: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  minor:       'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  major:       'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
}
const ACTION_BADGE: Record<ActionStatus, string> = {
  open:        'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  in_progress: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  completed:   'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
  verified:    'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  cancelled:   'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
}

const sourceLabel = (v: NonconformitySourceType) =>
  NONCONFORMITY_SOURCE_TYPES.find(o => o.value === v)?.label ?? v

export default function NonconformitiesPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [rows, setRows]           = useState<NcRow[] | null>(null)
  const [actions, setActions]     = useState<ActionRow[]>([])
  const [userId, setUserId]       = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // New-finding form.
  const [showForm, setShowForm]   = useState(false)
  const [title, setTitle]                 = useState('')
  const [sourceType, setSourceType]       = useState<NonconformitySourceType>('internal_audit')
  const [classification, setClassification] = useState<NonconformityClassification>('minor')
  const [clauseRef, setClauseRef]         = useState('')

  // New-action form (per expanded finding).
  const [actionDesc, setActionDesc]       = useState('')
  const [actionType, setActionType]       = useState<ActionType>('corrective')
  const [actionDue, setActionDue]         = useState('')

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const [{ data: { user } }, nc, act] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from('nonconformities')
          .select('id, title, source_type, classification, clause_ref, status, identified_at')
          .eq('tenant_id', tenantId)
          .order('identified_at', { ascending: false })
          .limit(1000),
        supabase
          .from('nonconformity_actions')
          .select('id, nonconformity_id, description, action_type, due_at, status, completed_by_user_id')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: true })
          .limit(5000),
      ])
      if (nc.error)  throw new Error(formatSupabaseError(nc.error, 'load nonconformities'))
      if (act.error) throw new Error(formatSupabaseError(act.error, 'load actions'))
      setUserId(user?.id ?? null)
      setRows((nc.data ?? []) as NcRow[])
      setActions((act.data ?? []) as ActionRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the register.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  const actionsByNc = useMemo(() => {
    const m = new Map<string, ActionRow[]>()
    for (const a of actions) {
      const list = m.get(a.nonconformity_id) ?? []
      list.push(a)
      m.set(a.nonconformity_id, list)
    }
    return m
  }, [actions])

  function resetFindingForm() {
    setTitle(''); setSourceType('internal_audit'); setClassification('minor'); setClauseRef('')
  }

  async function addFinding() {
    if (!tenantId || !title.trim()) return
    setSaving(true); setLoadError(null)
    try {
      const { error } = await supabase.from('nonconformities').insert({
        tenant_id:      tenantId,
        title:          title.trim(),
        source_type:    sourceType,
        classification,
        clause_ref:     clauseRef.trim() || null,
        identified_by:  userId,
        created_by:     userId,
        updated_by:     userId,
      })
      if (error) throw new Error(formatSupabaseError(error, 'add finding'))
      resetFindingForm(); setShowForm(false)
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not add the finding.')
    } finally {
      setSaving(false)
    }
  }

  async function removeFinding(id: string) {
    if (!tenantId) return
    if (!confirm('Delete this finding and its actions?')) return
    setSaving(true); setLoadError(null)
    try {
      const { error } = await supabase.from('nonconformities').delete().eq('id', id).eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'delete finding'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not delete the finding.')
    } finally {
      setSaving(false)
    }
  }

  async function addAction(ncId: string) {
    if (!tenantId || !actionDesc.trim()) return
    setSaving(true); setLoadError(null)
    try {
      const { error } = await supabase.from('nonconformity_actions').insert({
        tenant_id:          tenantId,
        nonconformity_id:   ncId,
        description:        actionDesc.trim(),
        action_type:        actionType,
        due_at:             actionDue || null,
        created_by_user_id: userId,
      })
      if (error) throw new Error(formatSupabaseError(error, 'add action'))
      setActionDesc(''); setActionType('corrective'); setActionDue('')
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not add the action.')
    } finally {
      setSaving(false)
    }
  }

  async function completeAction(id: string) {
    if (!tenantId) return
    setSaving(true); setLoadError(null)
    try {
      const { error } = await supabase
        .from('nonconformity_actions')
        .update({ status: 'completed', completed_at: new Date().toISOString(), completed_by_user_id: userId })
        .eq('id', id).eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'complete action'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not complete the action.')
    } finally {
      setSaving(false)
    }
  }

  async function verifyAction(id: string) {
    if (!tenantId) return
    setSaving(true); setLoadError(null)
    try {
      const { error } = await supabase
        .from('nonconformity_actions')
        .update({ status: 'verified', verified_effective_at: new Date().toISOString(), verified_by_user_id: userId })
        .eq('id', id).eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'verify action'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not verify the action.')
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">
        Admins only.
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-brand-navy" />
          Nonconformities &amp; CAPA
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Findings from audits, management review, compliance, inspections, or aspects — with corrective
          actions. Per ISO §10.2, a <span className="font-semibold">different user</span> must verify each close.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={() => setShowForm(v => !v)}
          className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90">
          {showForm ? 'Cancel' : 'New finding'}
        </button>
      </div>

      {showForm && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Finding</span>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Spill kit missing from solvent store"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Source</span>
              <select value={sourceType} onChange={e => setSourceType(e.target.value as NonconformitySourceType)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {NONCONFORMITY_SOURCE_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Classification</span>
              <select value={classification} onChange={e => setClassification(e.target.value as NonconformityClassification)}
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm">
                {NONCONFORMITY_CLASSIFICATIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">ISO clause (optional)</span>
              <input type="text" value={clauseRef} onChange={e => setClauseRef(e.target.value)}
                placeholder="e.g. 8.1"
                className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono" />
            </label>
          </div>
          <div className="flex justify-end">
            <button type="button" onClick={() => void addFinding()} disabled={saving || !title.trim()}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90">
              {saving ? 'Saving…' : 'Add finding'}
            </button>
          </div>
        </section>
      )}

      <div className="space-y-3">
        {rows === null ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400 italic rounded-xl border border-slate-100 dark:border-slate-800">
            No findings yet — raise the first one above.
          </p>
        ) : (
          rows.map(nc => {
            const ncActions = actionsByNc.get(nc.id) ?? []
            const tally = summarizeActions(ncActions)
            const expanded = expandedId === nc.id
            return (
              <div key={nc.id} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${CLASS_BADGE[nc.classification]}`}>
                        {nc.classification}
                      </span>
                      <span className="font-medium text-slate-900 dark:text-slate-100">{nc.title}</span>
                      {nc.clause_ref && <span className="font-mono text-[11px] text-slate-400">§{nc.clause_ref}</span>}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {sourceLabel(nc.source_type)} · {new Date(nc.identified_at).toLocaleDateString()} · {nc.status.replace(/_/g, ' ')}
                      {' · '}
                      <span className={tally.outstanding > 0 ? 'text-amber-600 dark:text-amber-300 font-semibold' : 'text-emerald-600 dark:text-emerald-300'}>
                        {tally.outstanding} outstanding / {tally.total} action{tally.total === 1 ? '' : 's'}
                      </span>
                    </div>
                  </div>
                  <button type="button" onClick={() => setExpandedId(expanded ? null : nc.id)}
                    className="shrink-0 text-xs text-brand-navy hover:underline">
                    {expanded ? 'Hide' : 'Actions'}
                  </button>
                  <button type="button" onClick={() => void removeFinding(nc.id)} disabled={saving}
                    className="shrink-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md p-1">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {expanded && (
                  <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-3 space-y-3 bg-slate-50/50 dark:bg-slate-950/20">
                    {ncActions.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 italic">No actions yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {ncActions.map(a => {
                          const completedByMe = a.completed_by_user_id !== null && a.completed_by_user_id === userId
                          return (
                            <li key={a.id} className="flex items-center gap-3 text-sm">
                              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACTION_BADGE[a.status]}`}>
                                {a.status.replace(/_/g, ' ')}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="text-slate-800 dark:text-slate-200">{a.description}</span>
                                <span className="text-[10px] text-slate-400 ml-2">{a.action_type}{a.due_at ? ` · due ${new Date(a.due_at).toLocaleDateString()}` : ''}</span>
                              </div>
                              {(a.status === 'open' || a.status === 'in_progress') && (
                                <button type="button" onClick={() => void completeAction(a.id)} disabled={saving}
                                  className="shrink-0 text-[11px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800">
                                  Mark complete
                                </button>
                              )}
                              {a.status === 'completed' && (
                                <button
                                  type="button"
                                  onClick={() => void verifyAction(a.id)}
                                  disabled={saving || !canVerifyAction(a, userId)}
                                  title={completedByMe ? 'A different user must verify (separation of duty)' : 'Verify effectiveness'}
                                  className="shrink-0 inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white disabled:opacity-40 hover:bg-emerald-700"
                                >
                                  <ShieldCheck className="h-3 w-3" /> Verify
                                </button>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    )}

                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      <input type="text" value={expanded ? actionDesc : ''} onChange={e => setActionDesc(e.target.value)}
                        placeholder="New corrective action"
                        className="flex-1 min-w-[12rem] rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs" />
                      <select value={actionType} onChange={e => setActionType(e.target.value as ActionType)}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs">
                        {ACTION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      <input type="date" value={actionDue} onChange={e => setActionDue(e.target.value)}
                        className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs" />
                      <button type="button" onClick={() => void addAction(nc.id)} disabled={saving || !actionDesc.trim()}
                        className="text-[11px] px-2 py-1 rounded-md bg-brand-navy text-white font-semibold disabled:opacity-40">
                        Add
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
