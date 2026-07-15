'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, Download, Loader2, Plus, Sparkles, Star, Trash2, Wrench, X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  assessEcfaCompleteness,
  buildCausalFactorActionDraft,
  detectSymptomLanguage,
  CAUSAL_FACTOR_CATEGORIES,
  CAUSAL_FACTOR_CATEGORY_LABEL,
  ECFA_LANES,
  HIERARCHY_OF_CONTROLS,
  HIERARCHY_LABEL,
  type EcfaNodeRow,
  type EcfaLane,
  type CausalFactorCategory,
  type HierarchyOfControls,
} from '@soteria/core/ecfaSchemas'
import EcfaChart from './EcfaChart'

// EcfaBoard — the interactive Events & Causal Factors editor. (Chart geometry
// is computed inside EcfaChart via the pure layoutEcfaChart from core.) Owns the node
// data + all mutations (add / patch / delete), the human-approved AI
// co-pilot, causal-factor coding, the completeness assessment, and one-click
// CAPA creation. It mirrors RcaSection's container conventions (authed
// fetches to the API routes, busy/error/notice state) and renders the pure
// SVG chart from EcfaChart. ECFA is self-contained: a causal factor is coded
// and turns directly into a tracked corrective action.

interface Props {
  incidentId: string
  tenantId:   string
  isAdmin:    boolean
  readOnly:   boolean
}

interface DraftSequence {
  events: Array<{ title: string; conditions?: string[] }>
  incident?: string
  rationale?: string
}
interface CausalFactorSuggestion {
  causal_factors: Array<{ node_id: string; category?: CausalFactorCategory; reason: string }>
  unverified_gaps?: string[]
  rationale?: string
}

export default function EcfaBoard({ incidentId, tenantId, isAdmin, readOnly }: Props) {
  const [nodes, setNodes] = useState<EcfaNodeRow[]>([])
  const [actionSourceIds, setActionSourceIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [seqPanel, setSeqPanel] = useState<DraftSequence | null>(null)
  const [cfPanel, setCfPanel] = useState<CausalFactorSuggestion | null>(null)
  const [aiBusy, setAiBusy] = useState<null | 'draft_sequence' | 'suggest_causal_factors'>(null)

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = { 'content-type': 'application/json', 'x-active-tenant': tenantId }
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  const load = useCallback(async () => {
    if (!tenantId || !incidentId) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenantId }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const [ecfaRes, actRes] = await Promise.all([
        fetch(`/api/incidents/${incidentId}/ecfa`, { headers }),
        fetch(`/api/incidents/${incidentId}/actions`, { headers }),
      ])
      const ecfaBody = await ecfaRes.json()
      if (!ecfaRes.ok) throw new Error(ecfaBody.error ?? `HTTP ${ecfaRes.status}`)
      setNodes((ecfaBody.nodes ?? []) as EcfaNodeRow[])
      if (actRes.ok) {
        const actBody = await actRes.json()
        const ids = ((actBody.actions ?? []) as Array<{ source_ecfa_node_id: string | null }>)
          .map(a => a.source_ecfa_node_id)
          .filter((v): v is string => !!v)
        setActionSourceIds(ids)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId, incidentId])

  useEffect(() => { void load() }, [load])

  const events = useMemo(
    () => nodes.filter(n => n.node_type === 'event').sort((a, b) => a.sequence_index - b.sequence_index),
    [nodes],
  )
  const incident = useMemo(() => nodes.find(n => n.node_type === 'incident') ?? null, [nodes])
  const condsByEvent = useMemo(() => {
    const m = new Map<string, EcfaNodeRow[]>()
    for (const n of nodes) {
      if (n.node_type !== 'condition' || !n.parent_event_id) continue
      const list = m.get(n.parent_event_id) ?? []
      list.push(n)
      m.set(n.parent_event_id, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.sequence_index - b.sequence_index)
    return m
  }, [nodes])

  const completeness = useMemo(
    () => assessEcfaCompleteness({ nodes, actionSourceEcfaIds: actionSourceIds }),
    [nodes, actionSourceIds],
  )

  // ── Mutations ────────────────────────────────────────────────────────────

  async function addNode(node: Record<string, unknown>): Promise<EcfaNodeRow | null> {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/ecfa`, {
        method: 'POST', headers: await authedHeaders(), body: JSON.stringify({ node }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
      return (body.node as EcfaNodeRow) ?? null
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); return null
    } finally { setBusy(false) }
  }

  async function patchNode(nodeId: string, patch: Record<string, unknown>): Promise<boolean> {
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/ecfa`, {
        method: 'PATCH', headers: await authedHeaders(), body: JSON.stringify({ nodeId, patch }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e)); return false
    } finally { setBusy(false) }
  }

  async function removeNode(nodeId: string) {
    setBusy(true); setError(null)
    try {
      const res = await fetch(
        `/api/incidents/${incidentId}/ecfa?nodeId=${encodeURIComponent(nodeId)}`,
        { method: 'DELETE', headers: await authedHeaders() },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function createCapa(node: EcfaNodeRow) {
    setBusy(true); setError(null); setNotice(null)
    try {
      const draft = buildCausalFactorActionDraft({
        title: node.title,
        hierarchy_of_controls: node.cf_hierarchy_control ?? null,
      })
      const res = await fetch(`/api/incidents/${incidentId}/actions`, {
        method: 'POST', headers: await authedHeaders(),
        body: JSON.stringify({ ...draft, source_ecfa_node_id: node.id }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setNotice('Corrective action created — see the Actions tab.')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function pullSequenceIntoNarrative() {
    if (events.length === 0) return
    setBusy(true); setError(null); setNotice(null)
    try {
      const composed = events.map((e, i) => `${i + 1}. ${e.title}`).join('\n')
      const res = await fetch(`/api/incidents/${incidentId}/investigation`, {
        method: 'PATCH', headers: await authedHeaders(),
        body: JSON.stringify({ sequence_of_events: composed }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setNotice('Sequence written to the investigation narrative.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  // ── AI co-pilot ──────────────────────────────────────────────────────────

  async function runAssist(mode: 'draft_sequence' | 'suggest_causal_factors') {
    setAiBusy(mode); setError(null)
    try {
      const res = await fetch(`/api/incidents/${incidentId}/ecfa/assist`, {
        method: 'POST', headers: await authedHeaders(), body: JSON.stringify({ mode }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      if (mode === 'draft_sequence') setSeqPanel(body.suggestion as DraftSequence)
      else setCfPanel(body.suggestion as CausalFactorSuggestion)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setAiBusy(null) }
  }

  function nextSeq(): number {
    return events.reduce((m, e) => Math.max(m, e.sequence_index), 0) + 1
  }

  async function downloadPdf() {
    // Dynamic import keeps pdf-lib out of the page's initial bundle.
    const { downloadEcfaChartPdf } = await import('@/lib/pdfEcfaChart')
    await downloadEcfaChartPdf(nodes, {
      title: 'Events & Causal Factors Analysis',
      subtitle: `Incident ${incidentId}`,
    })
  }

  if (loading) {
    return <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }

  return (
    <section className="space-y-4">
      {error && <Banner tone="error"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span></Banner>}
      {notice && <Banner tone="ok"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /><span>{notice}</span></Banner>}

      {/* Chart */}
      <EcfaChart nodes={nodes} />

      {/* Quality + AI actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <QualityPill c={completeness} />
        <div className="flex flex-wrap items-center gap-2">
          {nodes.length > 0 && (
            <button type="button" onClick={() => void downloadPdf()} disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
              <Download className="h-3 w-3" /> Download PDF
            </button>
          )}
          {!readOnly && events.length > 0 && (
            <button type="button" onClick={() => void pullSequenceIntoNarrative()} disabled={busy}
              className="inline-flex items-center gap-1 rounded-md border border-brand-navy/40 px-2.5 py-1 text-[11px] font-semibold text-brand-navy hover:bg-brand-navy/5 disabled:opacity-50">
              <Sparkles className="h-3 w-3" /> Pull sequence into narrative
            </button>
          )}
          {isAdmin && !readOnly && (
            <>
              <AiButton label="Draft sequence" busy={aiBusy === 'draft_sequence'} disabled={busy || !!aiBusy}
                onClick={() => void runAssist('draft_sequence')} />
              <AiButton label="Suggest causal factors" busy={aiBusy === 'suggest_causal_factors'} disabled={busy || !!aiBusy || nodes.length === 0}
                onClick={() => void runAssist('suggest_causal_factors')} />
            </>
          )}
        </div>
      </div>

      {completeness.issues.length > 0 && (
        <ul className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
          {completeness.issues.map((it, i) => (
            <li key={i} className="flex items-start gap-1.5"><span className="mt-1 inline-block h-1 w-1 rounded-full bg-amber-500 shrink-0" />{it}</li>
          ))}
        </ul>
      )}

      {/* AI panels */}
      {seqPanel && !readOnly && (
        <AiSequencePanel
          draft={seqPanel} busy={busy} hasIncident={!!incident}
          onClose={() => setSeqPanel(null)}
          onAddEvent={async (title, conditions) => {
            const ev = await addNode({ node_type: 'event', title, sequence_index: nextSeq(), ai_origin: true })
            if (ev && conditions) for (const c of conditions)
              await addNode({ node_type: 'condition', parent_event_id: ev.id, lane: 'below', title: c, ai_origin: true })
          }}
          onSetIncident={async (title) => { await addNode({ node_type: 'incident', title, ai_origin: true }) }}
        />
      )}
      {cfPanel && !readOnly && (
        <AiCausalFactorPanel
          draft={cfPanel} busy={busy} nodes={nodes}
          onClose={() => setCfPanel(null)}
          onFlag={(nodeId, category) => patchNode(nodeId, { is_causal_factor: true, ...(category ? { cf_category: category } : {}) })}
        />
      )}

      {/* Editor: events + conditions */}
      <div className="space-y-3">
        {events.map((ev, i) => (
          <EventRow
            key={ev.id}
            index={i}
            event={ev}
            conditions={condsByEvent.get(ev.id) ?? []}
            hasAction={actionSourceIds.includes(ev.id)}
            actionSourceIds={actionSourceIds}
            readOnly={readOnly}
            busy={busy}
            onPatch={patchNode}
            onDelete={removeNode}
            onAddCondition={(title, lane) => addNode({
              node_type: 'condition', parent_event_id: ev.id, lane, title, sequence_index: (condsByEvent.get(ev.id)?.length ?? 0) + 1,
            })}
            onCreateCapa={createCapa}
          />
        ))}

        {!readOnly && (
          <AddEventForm busy={busy} onAdd={(title, verified) => addNode({
            node_type: 'event', title, sequence_index: nextSeq(),
            verification_status: verified ? 'verified' : 'presumptive',
          })} />
        )}

        {/* Terminal loss */}
        <div className="rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20 p-3">
          {incident ? (
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Loss / incident</p>
                <p className="text-sm text-slate-800 dark:text-slate-200">{incident.title}</p>
              </div>
              {!readOnly && <DeleteButton onClick={() => void removeNode(incident.id)} disabled={busy} />}
            </div>
          ) : !readOnly ? (
            <AddIncidentForm busy={busy} onAdd={(title) => addNode({ node_type: 'incident', title })} />
          ) : (
            <p className="text-[11px] text-slate-500">No loss node recorded.</p>
          )}
        </div>
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Event row — the event + its conditions + verification + causal-factor coding
// ──────────────────────────────────────────────────────────────────────────

function EventRow({
  index, event, conditions, hasAction, actionSourceIds, readOnly, busy,
  onPatch, onDelete, onAddCondition, onCreateCapa,
}: {
  index: number
  event: EcfaNodeRow
  conditions: EcfaNodeRow[]
  hasAction: boolean
  actionSourceIds: string[]
  readOnly: boolean
  busy: boolean
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onDelete: (id: string) => void
  onAddCondition: (title: string, lane: EcfaLane) => Promise<EcfaNodeRow | null>
  onCreateCapa: (node: EcfaNodeRow) => void
}) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 dark:text-slate-200">{event.title}</p>
          <NodeChips node={event} hasAction={hasAction} />
        </div>
        {!readOnly && <DeleteButton onClick={() => onDelete(event.id)} disabled={busy} />}
      </div>

      {!readOnly && (
        <NodeControls node={event} busy={busy} onPatch={onPatch} onCreateCapa={onCreateCapa} hasAction={hasAction} />
      )}

      {/* Conditions */}
      {conditions.length > 0 && (
        <ul className="ml-8 space-y-1.5 border-l border-dashed border-slate-200 dark:border-slate-700 pl-3">
          {conditions.map(c => (
            <li key={c.id} className="space-y-1">
              <div className="flex items-start gap-2">
                <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-sky-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-slate-700 dark:text-slate-200">{c.title} <span className="text-[10px] text-slate-400">({c.lane ?? 'below'})</span></p>
                  <NodeChips node={c} hasAction={actionSourceIds.includes(c.id)} />
                </div>
                {!readOnly && <DeleteButton onClick={() => onDelete(c.id)} disabled={busy} small />}
              </div>
              {!readOnly && (
                <div className="ml-4"><NodeControls node={c} busy={busy} onPatch={onPatch} onCreateCapa={onCreateCapa} hasAction={actionSourceIds.includes(c.id)} /></div>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        adding ? (
          <div className="ml-8"><AddConditionForm busy={busy} onCancel={() => setAdding(false)}
            onAdd={async (title, lane) => { const ok = await onAddCondition(title, lane); if (ok) setAdding(false) }} /></div>
        ) : (
          <button type="button" onClick={() => setAdding(true)} disabled={busy}
            className="ml-8 inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
            <Plus className="h-3 w-3" /> Add condition
          </button>
        )
      )}
    </div>
  )
}

// Verified toggle + flag-causal-factor + coding + create-CAPA controls.
function NodeControls({
  node, busy, onPatch, onCreateCapa, hasAction,
}: {
  node: EcfaNodeRow
  busy: boolean
  onPatch: (id: string, patch: Record<string, unknown>) => Promise<boolean>
  onCreateCapa: (node: EcfaNodeRow) => void
  hasAction: boolean
}) {
  const [barrier, setBarrier] = useState(node.failed_barrier ?? '')
  const verified = node.verification_status === 'verified'
  const flag = detectSymptomLanguage(node.title)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <button type="button" disabled={busy}
          onClick={() => void onPatch(node.id, { verification_status: verified ? 'presumptive' : 'verified' })}
          className={'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 disabled:opacity-50 ' +
            (verified ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800')}>
          <Check className="h-3 w-3" /> {verified ? 'Verified' : 'Mark verified'}
        </button>
        <button type="button" disabled={busy}
          onClick={() => void onPatch(node.id, { is_causal_factor: !node.is_causal_factor })}
          className={'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 disabled:opacity-50 ' +
            (node.is_causal_factor ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                                   : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800')}>
          <Star className="h-3 w-3" /> {node.is_causal_factor ? 'Causal factor' : 'Flag causal factor'}
        </button>
      </div>

      {flag.flagged && (
        <p className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{flag.reason}
        </p>
      )}

      {node.is_causal_factor && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-2 space-y-1.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            <select value={node.cf_category ?? ''} disabled={busy}
              onChange={e => void onPatch(node.id, { cf_category: e.target.value || null })}
              className="rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[11px]">
              <option value="">Category…</option>
              {CAUSAL_FACTOR_CATEGORIES.map(c => <option key={c} value={c}>{CAUSAL_FACTOR_CATEGORY_LABEL[c]}</option>)}
            </select>
            <select value={node.cf_hierarchy_control ?? ''} disabled={busy}
              onChange={e => void onPatch(node.id, { cf_hierarchy_control: (e.target.value || null) as HierarchyOfControls | null })}
              className="rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[11px]">
              <option value="">Control level…</option>
              {HIERARCHY_OF_CONTROLS.map(h => <option key={h} value={h}>{HIERARCHY_LABEL[h]}</option>)}
            </select>
          </div>
          <input type="text" value={barrier} disabled={busy}
            onChange={e => setBarrier(e.target.value)}
            onBlur={() => { if ((node.failed_barrier ?? '') !== barrier) void onPatch(node.id, { failed_barrier: barrier.trim() || null }) }}
            placeholder="Failed / missing barrier (e.g. interlock bypassed)"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[11px]" />
          <button type="button" disabled={busy || hasAction} onClick={() => onCreateCapa(node)}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
            {hasAction ? <Check className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
            {hasAction ? 'Action created' : 'Create corrective action'}
          </button>
        </div>
      )}
    </div>
  )
}

function NodeChips({ node, hasAction }: { node: EcfaNodeRow; hasAction: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1 pt-0.5">
      {node.verification_status === 'presumptive'
        ? <Chip tone="slate">Presumptive</Chip>
        : <Chip tone="emerald">Verified</Chip>}
      {node.is_causal_factor && <Chip tone="amber">★ Causal factor</Chip>}
      {node.cf_category && <Chip tone="slate">{CAUSAL_FACTOR_CATEGORY_LABEL[node.cf_category]}</Chip>}
      {hasAction && <Chip tone="emerald">CAPA</Chip>}
      {node.ai_origin && <Chip tone="violet"><Sparkles className="h-2.5 w-2.5" /> {node.ai_edited ? 'AI · edited' : 'AI'}</Chip>}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Add forms
// ──────────────────────────────────────────────────────────────────────────

function AddEventForm({ busy, onAdd }: { busy: boolean; onAdd: (title: string, verified: boolean) => Promise<EcfaNodeRow | null> }) {
  const [title, setTitle] = useState('')
  const [verified, setVerified] = useState(false)
  const flag = detectSymptomLanguage(title)
  async function submit() {
    if (!title.trim()) return
    const ok = await onAdd(title.trim(), verified)
    if (ok) { setTitle(''); setVerified(false) }
  }
  return (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 space-y-1.5">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Add event (one subject + one action verb)</p>
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Operator opened the guard door"
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm" />
      {flag.flagged && <p className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{flag.reason}</p>}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> Verified (evidence-backed)
        </label>
        <AddButton onClick={() => void submit()} disabled={busy || !title.trim()} />
      </div>
    </div>
  )
}

function AddConditionForm({ busy, onAdd, onCancel }: { busy: boolean; onAdd: (title: string, lane: EcfaLane) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [lane, setLane] = useState<EcfaLane>('below')
  return (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-2 space-y-1.5">
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Condition (a state, not an action)…"
        className="w-full rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[13px]" />
      <div className="flex items-center justify-between">
        <select value={lane} onChange={e => setLane(e.target.value as EcfaLane)}
          className="rounded-md border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[11px]">
          {ECFA_LANES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-[11px] text-slate-500 hover:text-slate-700">Cancel</button>
          <AddButton small onClick={() => { if (title.trim()) void onAdd(title.trim(), lane) }} disabled={busy || !title.trim()} />
        </div>
      </div>
    </div>
  )
}

function AddIncidentForm({ busy, onAdd }: { busy: boolean; onAdd: (title: string) => Promise<EcfaNodeRow | null> }) {
  const [title, setTitle] = useState('')
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Loss / incident (the harm)</p>
      <div className="flex items-center gap-2">
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Amputation of index finger"
          className="flex-1 rounded-lg border border-rose-300 dark:border-rose-800 dark:bg-rose-950/30 px-3 py-1.5 text-sm" />
        <AddButton onClick={() => { if (title.trim()) void onAdd(title.trim()) }} disabled={busy || !title.trim()} />
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// AI panels
// ──────────────────────────────────────────────────────────────────────────

function AiSequencePanel({
  draft, busy, hasIncident, onClose, onAddEvent, onSetIncident,
}: {
  draft: DraftSequence
  busy: boolean
  hasIncident: boolean
  onClose: () => void
  onAddEvent: (title: string, conditions?: string[]) => Promise<void>
  onSetIncident: (title: string) => Promise<void>
}) {
  const [done, setDone] = useState<Set<number>>(new Set())
  const [incidentDone, setIncidentDone] = useState(false)
  return (
    <PanelShell title="AI-drafted sequence — accept what fits" onClose={onClose}>
      {draft.rationale && <p className="text-[11px] italic text-slate-500 dark:text-slate-400">{draft.rationale}</p>}
      <ul className="space-y-1.5">
        {draft.events.map((e, i) => (
          <li key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 p-2">
            <p className="text-sm text-slate-800 dark:text-slate-200">{i + 1}. {e.title}</p>
            {e.conditions && e.conditions.length > 0 && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">conditions: {e.conditions.join('; ')}</p>
            )}
            <button type="button" disabled={busy || done.has(i)}
              onClick={async () => { await onAddEvent(e.title, e.conditions); setDone(p => new Set(p).add(i)) }}
              className="mt-1 inline-flex items-center gap-1 rounded-md border border-brand-navy/40 px-2 py-0.5 text-[11px] font-semibold text-brand-navy hover:bg-brand-navy/5 disabled:opacity-50">
              {done.has(i) ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {done.has(i) ? 'Added' : 'Add event'}
            </button>
          </li>
        ))}
      </ul>
      {draft.incident && !hasIncident && (
        <button type="button" disabled={busy || incidentDone}
          onClick={async () => { await onSetIncident(draft.incident!); setIncidentDone(true) }}
          className="inline-flex items-center gap-1 rounded-md border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-2 py-1 text-[11px] font-semibold text-rose-800 dark:text-rose-200 hover:bg-rose-100 disabled:opacity-50">
          {incidentDone ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {incidentDone ? 'Loss set' : `Set loss: ${draft.incident.slice(0, 40)}`}
        </button>
      )}
    </PanelShell>
  )
}

function AiCausalFactorPanel({
  draft, busy, nodes, onClose, onFlag,
}: {
  draft: CausalFactorSuggestion
  busy: boolean
  nodes: EcfaNodeRow[]
  onClose: () => void
  onFlag: (nodeId: string, category?: CausalFactorCategory) => Promise<boolean>
}) {
  const [done, setDone] = useState<Set<string>>(new Set())
  const byId = new Map(nodes.map(n => [n.id, n]))
  return (
    <PanelShell title="AI-suggested causal factors — flag what you agree with" onClose={onClose}>
      {draft.rationale && <p className="text-[11px] italic text-slate-500 dark:text-slate-400">{draft.rationale}</p>}
      <ul className="space-y-1.5">
        {draft.causal_factors.map((cf, i) => {
          const node = byId.get(cf.node_id)
          if (!node) return null
          return (
            <li key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 p-2">
              <p className="text-sm text-slate-800 dark:text-slate-200">{node.title}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{cf.reason}{cf.category ? ` · ${CAUSAL_FACTOR_CATEGORY_LABEL[cf.category]}` : ''}</p>
              <button type="button" disabled={busy || done.has(cf.node_id)}
                onClick={async () => { const ok = await onFlag(cf.node_id, cf.category); if (ok) setDone(p => new Set(p).add(cf.node_id)) }}
                className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 disabled:opacity-50">
                {done.has(cf.node_id) ? <Check className="h-3 w-3" /> : <Star className="h-3 w-3" />} {done.has(cf.node_id) ? 'Flagged' : 'Flag as causal factor'}
              </button>
            </li>
          )
        })}
      </ul>
      {draft.unverified_gaps && draft.unverified_gaps.length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Still presumptive — get evidence</p>
          <ul className="mt-1 space-y-0.5">
            {draft.unverified_gaps.map((g, i) => <li key={i} className="text-[11px] text-slate-600 dark:text-slate-300">• {g}</li>)}
          </ul>
        </div>
      )}
    </PanelShell>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Small shared widgets
// ──────────────────────────────────────────────────────────────────────────

function PanelShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/20 p-4 space-y-2">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5 text-violet-900 dark:text-violet-100"><Sparkles className="h-4 w-4" /> {title}</h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
      </header>
      {children}
    </div>
  )
}

function QualityPill({ c }: { c: ReturnType<typeof assessEcfaCompleteness> }) {
  const tone = c.score >= 80 ? 'emerald' : c.score >= 50 ? 'amber' : 'rose'
  const cls = tone === 'emerald' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200'
    : tone === 'amber' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    : 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
      Investigation quality {c.score}%
      <span className="font-normal opacity-80">· {c.causalFactorsWithAction}/{c.causalFactorCount} causal factors actioned</span>
    </span>
  )
}

function AiButton({ label, busy, disabled, onClick }: { label: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 text-xs font-semibold text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50">
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {label}
    </button>
  )
}

function Banner({ tone, children }: { tone: 'error' | 'ok'; children: React.ReactNode }) {
  const cls = tone === 'error'
    ? 'border-rose-200 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
  return <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${cls}`}>{children}</div>
}

function Chip({ tone, children }: { tone: 'slate' | 'emerald' | 'amber' | 'violet'; children: React.ReactNode }) {
  const cls = {
    slate:   'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
    amber:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    violet:  'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  }[tone]
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{children}</span>
}

function AddButton({ onClick, disabled, small }: { onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={'inline-flex items-center gap-1 rounded-lg bg-brand-navy text-white font-semibold hover:bg-brand-navy/90 disabled:opacity-50 ' + (small ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1.5 text-xs')}>
      <Plus className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} /> Add
    </button>
  )
}

function DeleteButton({ onClick, disabled, small }: { onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title="Delete"
      className={'shrink-0 rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 ' + (small ? 'p-0.5' : 'p-1')}>
      <Trash2 className={small ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
    </button>
  )
}
