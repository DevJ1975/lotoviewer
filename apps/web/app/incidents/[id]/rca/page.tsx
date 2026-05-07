'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, Loader2, Plus, Trash2, Crown } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  RCA_METHODS,
  RCA_METHOD_LABEL,
  RCA_METHOD_HELP,
  FISHBONE_CATEGORIES,
  FISHBONE_CATEGORY_LABEL,
  TAPROOT_FACTOR_TYPES,
  TAPROOT_FACTOR_LABEL,
  ICAM_LAYERS,
  ICAM_LAYER_LABEL,
  type RcaMethod,
  type FiveWhysRow,
  type FishboneRow,
  type TaprootFactorRow,
  type IcamFactorRow,
  type FishboneCategory,
  type TaprootFactorType,
  type IcamLayer,
} from '@soteria/core/rcaSchemas'

// /incidents/[id]/rca — Method-aware RCA editor.
//
// One investigation row picks one method; this page renders the
// editor for that method (5 Whys chain, Fishbone categories,
// TapRooT tree, ICAM layers). Switching methods is allowed at any
// point — the previous method's nodes remain in the DB, just hidden,
// so a team can compare findings later.
//
// All four editors share a node lifecycle:
//   - POST  /api/incidents/[id]/rca  { method, node }
//   - DELETE /api/incidents/[id]/rca?nodeId=&method=
// The "mark as root" toggle is enforced single-root server-side.

interface RcaState {
  investigation_id: string | null
  method:           RcaMethod
  five_whys:        FiveWhysRow[]
  fishbone:         FishboneRow[]
  taproot:          TaprootFactorRow[]
  icam:             IcamFactorRow[]
}

const EMPTY_STATE: RcaState = {
  investigation_id: null,
  method:           'none_yet',
  five_whys: [], fishbone: [], taproot: [], icam: [],
}

export default function RcaPage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()

  const [state, setState] = useState<RcaState>(EMPTY_STATE)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const [invRes, rcaRes] = await Promise.all([
        fetch(`/api/incidents/${id}/investigation`, { headers }),
        fetch(`/api/incidents/${id}/rca`, { headers }),
      ])
      const invBody = await invRes.json()
      const rcaBody = await rcaRes.json()
      if (!invRes.ok) throw new Error(invBody.error ?? `HTTP ${invRes.status}`)
      if (!rcaRes.ok) throw new Error(rcaBody.error ?? `HTTP ${rcaRes.status}`)

      setState({
        investigation_id: rcaBody.investigation_id ?? null,
        method:           (invBody.investigation?.rca_method as RcaMethod) ?? 'none_yet',
        five_whys: rcaBody.five_whys ?? [],
        fishbone:  rcaBody.fishbone  ?? [],
        taproot:   rcaBody.taproot   ?? [],
        icam:      rcaBody.icam      ?? [],
      })
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

  async function changeMethod(method: RcaMethod) {
    if (!tenant?.id || !id || method === state.method) return
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/investigation`, {
        method: 'PATCH',
        headers,
        body:   JSON.stringify({ rca_method: method }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setState(s => ({ ...s, method }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function addNode(method: RcaMethod, node: Record<string, unknown>): Promise<boolean> {
    if (!tenant?.id || !id) return false
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${id}/rca`, {
        method: 'POST',
        headers,
        body:   JSON.stringify({ method, node }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      // Reload to pick up single-root-side-effect on the server.
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function removeNode(method: RcaMethod, nodeId: string) {
    if (!tenant?.id || !id) return
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(
        `/api/incidents/${id}/rca?nodeId=${encodeURIComponent(nodeId)}&method=${encodeURIComponent(method)}`,
        { method: 'DELETE', headers },
      )
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      await load()
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

  if (!state.investigation_id) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No investigation has been started for this incident.
          </p>
          <Link
            href={`/incidents/${id}/investigate`}
            className="mt-3 inline-block text-sm font-medium text-brand-navy hover:underline"
          >
            Start investigation →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incident
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Root cause analysis</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Build the analysis tree. Mark one node as the identified root before completing the investigation on the{' '}
          <Link href={`/incidents/${id}/investigate`} className="text-brand-navy hover:underline">Investigate tab</Link>.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          Method
        </p>
        <div className="flex flex-wrap gap-2">
          {RCA_METHODS.filter(m => m !== 'none_yet').map(m => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => void changeMethod(m)}
              className={
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ' +
                (state.method === m
                  ? 'border-brand-navy bg-brand-navy text-white'
                  : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-slate-400 dark:hover:border-slate-600 disabled:opacity-50')
              }
            >
              {RCA_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          {RCA_METHOD_HELP[state.method]}
        </p>
      </section>

      {state.method === '5_whys'   && <FiveWhysEditor   rows={state.five_whys} onAdd={n => addNode('5_whys',  n)} onDelete={id => void removeNode('5_whys',   id)} busy={busy} />}
      {state.method === 'fishbone' && <FishboneEditor   rows={state.fishbone}  onAdd={n => addNode('fishbone', n)} onDelete={id => void removeNode('fishbone', id)} busy={busy} />}
      {state.method === 'taproot'  && <TaprootEditor    rows={state.taproot}   onAdd={n => addNode('taproot',  n)} onDelete={id => void removeNode('taproot',  id)} busy={busy} />}
      {state.method === 'icam'     && <IcamEditor       rows={state.icam}      onAdd={n => addNode('icam',     n)} onDelete={id => void removeNode('icam',     id)} busy={busy} />}
      {state.method === 'none_yet' && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Pick a method above to start the analysis.</p>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// 5 Whys editor
// ──────────────────────────────────────────────────────────────────────────

function FiveWhysEditor({
  rows, onAdd, onDelete, busy,
}: {
  rows:     FiveWhysRow[]
  onAdd:    (n: Record<string, unknown>) => Promise<boolean>
  onDelete: (id: string) => void
  busy:     boolean
}) {
  const sorted = useMemo(() => [...rows].sort((a, b) => a.ordinal - b.ordinal), [rows])
  const nextOrdinal = sorted.length > 0 ? sorted[sorted.length - 1]!.ordinal + 1 : 1
  const [answer, setAnswer] = useState('')
  const [isRoot, setIsRoot] = useState(false)

  async function submit() {
    if (!answer.trim()) return
    const ok = await onAdd({
      ordinal: nextOrdinal,
      question: nextOrdinal === 1 ? 'What happened?' : 'Why did that happen?',
      answer:   answer.trim(),
      is_root:  isRoot,
    })
    if (ok) {
      setAnswer('')
      setIsRoot(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">5 Whys chain</h2>
      <ul className="space-y-2">
        {sorted.map(r => (
          <li key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
              {r.ordinal}
            </span>
            <div className="flex-1 min-w-0">
              {r.question && <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{r.question}</p>}
              <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{r.answer}</p>
            </div>
            {r.is_root && <RootBadge />}
            <DeleteButton onClick={() => onDelete(r.id)} disabled={busy} />
          </li>
        ))}
      </ul>
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {nextOrdinal === 1 ? 'What happened?' : `Why #${nextOrdinal}`}
        </p>
        <textarea
          value={answer}
          onChange={e => setAnswer(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={isRoot} onChange={e => setIsRoot(e.target.checked)} />
            Mark as identified root
          </label>
          <AddButton onClick={() => void submit()} disabled={busy || !answer.trim()} />
        </div>
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Fishbone editor
// ──────────────────────────────────────────────────────────────────────────

function FishboneEditor({
  rows, onAdd, onDelete, busy,
}: {
  rows:     FishboneRow[]
  onAdd:    (n: Record<string, unknown>) => Promise<boolean>
  onDelete: (id: string) => void
  busy:     boolean
}) {
  const grouped = useMemo(() => {
    const m = new Map<FishboneCategory, FishboneRow[]>()
    for (const c of FISHBONE_CATEGORIES) m.set(c, [])
    for (const r of rows) m.get(r.category)?.push(r)
    for (const list of m.values()) list.sort((a, b) => a.ordinal - b.ordinal)
    return m
  }, [rows])

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Fishbone categories</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FISHBONE_CATEGORIES.map(cat => (
          <FishboneCategoryCard
            key={cat}
            category={cat}
            rows={grouped.get(cat) ?? []}
            onAdd={onAdd}
            onDelete={onDelete}
            busy={busy}
          />
        ))}
      </div>
    </section>
  )
}

function FishboneCategoryCard({
  category, rows, onAdd, onDelete, busy,
}: {
  category: FishboneCategory
  rows:     FishboneRow[]
  onAdd:    (n: Record<string, unknown>) => Promise<boolean>
  onDelete: (id: string) => void
  busy:     boolean
}) {
  const [cause, setCause] = useState('')
  const [isRoot, setIsRoot] = useState(false)

  async function submit() {
    if (!cause.trim()) return
    const ok = await onAdd({
      category,
      cause:   cause.trim(),
      ordinal: rows.length + 1,
      is_root: isRoot,
    })
    if (ok) { setCause(''); setIsRoot(false) }
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
        {FISHBONE_CATEGORY_LABEL[category]}
      </p>
      <ul className="space-y-1.5">
        {rows.map(r => (
          <li key={r.id} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
            <span className="flex-1 text-slate-700 dark:text-slate-200">{r.cause}</span>
            {r.is_root && <RootBadge />}
            <DeleteButton onClick={() => onDelete(r.id)} disabled={busy} small />
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-1">
        <input
          type="text"
          value={cause}
          onChange={e => setCause(e.target.value)}
          placeholder="Add a cause…"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-xs"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={isRoot} onChange={e => setIsRoot(e.target.checked)} />
            Root
          </label>
          <AddButton onClick={() => void submit()} disabled={busy || !cause.trim()} small />
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// TapRooT editor
// ──────────────────────────────────────────────────────────────────────────

function TaprootEditor({
  rows, onAdd, onDelete, busy,
}: {
  rows:     TaprootFactorRow[]
  onAdd:    (n: Record<string, unknown>) => Promise<boolean>
  onDelete: (id: string) => void
  busy:     boolean
}) {
  // Render as a flat list grouped by parent — Phase 2 keeps the
  // depiction simple. A proper tree visualization ships later.
  const sorted = useMemo(() => [...rows].sort((a, b) => a.ordinal - b.ordinal), [rows])
  const [factorType, setFactorType] = useState<TaprootFactorType>('event')
  const [parentId, setParentId] = useState<string>('')
  const [description, setDescription] = useState('')
  const [taprootCategory, setTaprootCategory] = useState('')
  const [isRoot, setIsRoot] = useState(false)

  async function submit() {
    if (!description.trim()) return
    const ok = await onAdd({
      factor_type:      factorType,
      parent_id:        parentId || null,
      description:      description.trim(),
      taproot_category: taprootCategory.trim() || null,
      ordinal:          rows.length + 1,
      is_root:          isRoot,
    })
    if (ok) {
      setDescription('')
      setTaprootCategory('')
      setIsRoot(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">TapRooT causal-factor tree</h2>
      <ul className="space-y-2">
        {sorted.map(r => (
          <li key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <span className={
              'mt-0.5 inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
              (r.factor_type === 'root_cause' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200' :
               r.factor_type === 'generic_cause' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200' :
               r.factor_type === 'causal_factor' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' :
               r.factor_type === 'condition' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' :
               'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200')
            }>
              {TAPROOT_FACTOR_LABEL[r.factor_type]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{r.description}</p>
              {r.taproot_category && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Category: {r.taproot_category}</p>
              )}
              {r.parent_id && (
                <p className="text-[10px] text-slate-400">↳ child of {r.parent_id.slice(0, 8)}</p>
              )}
            </div>
            {r.is_root && <RootBadge />}
            <DeleteButton onClick={() => onDelete(r.id)} disabled={busy} />
          </li>
        ))}
      </ul>
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select
            value={factorType}
            onChange={e => setFactorType(e.target.value as TaprootFactorType)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
          >
            {TAPROOT_FACTOR_TYPES.map(t => (
              <option key={t} value={t}>{TAPROOT_FACTOR_LABEL[t]}</option>
            ))}
          </select>
          <select
            value={parentId}
            onChange={e => setParentId(e.target.value)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-xs"
          >
            <option value="">(no parent — top of tree)</option>
            {sorted.map(r => (
              <option key={r.id} value={r.id}>
                {TAPROOT_FACTOR_LABEL[r.factor_type]}: {r.description.slice(0, 40)}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe this factor"
          rows={2}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
        <input
          type="text"
          value={taprootCategory}
          onChange={e => setTaprootCategory(e.target.value)}
          placeholder="Generic-cause category (training, procedures, HPI, communication…)"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-xs"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={isRoot} onChange={e => setIsRoot(e.target.checked)} />
            Mark as identified root
          </label>
          <AddButton onClick={() => void submit()} disabled={busy || !description.trim()} />
        </div>
      </div>
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// ICAM editor
// ──────────────────────────────────────────────────────────────────────────

function IcamEditor({
  rows, onAdd, onDelete, busy,
}: {
  rows:     IcamFactorRow[]
  onAdd:    (n: Record<string, unknown>) => Promise<boolean>
  onDelete: (id: string) => void
  busy:     boolean
}) {
  const grouped = useMemo(() => {
    const m = new Map<IcamLayer, IcamFactorRow[]>()
    for (const l of ICAM_LAYERS) m.set(l, [])
    for (const r of rows) m.get(r.layer)?.push(r)
    for (const list of m.values()) list.sort((a, b) => a.ordinal - b.ordinal)
    return m
  }, [rows])

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">ICAM contributing factors</h2>
      <div className="space-y-3">
        {ICAM_LAYERS.map(layer => (
          <IcamLayerCard
            key={layer}
            layer={layer}
            rows={grouped.get(layer) ?? []}
            onAdd={onAdd}
            onDelete={onDelete}
            busy={busy}
          />
        ))}
      </div>
    </section>
  )
}

function IcamLayerCard({
  layer, rows, onAdd, onDelete, busy,
}: {
  layer: IcamLayer
  rows:  IcamFactorRow[]
  onAdd:    (n: Record<string, unknown>) => Promise<boolean>
  onDelete: (id: string) => void
  busy:     boolean
}) {
  const [factor,   setFactor]   = useState('')
  const [evidence, setEvidence] = useState('')
  const [isRoot,   setIsRoot]   = useState(false)

  async function submit() {
    if (!factor.trim()) return
    const ok = await onAdd({
      layer,
      factor:   factor.trim(),
      evidence: evidence.trim() || null,
      ordinal:  rows.length + 1,
      is_root:  isRoot,
    })
    if (ok) { setFactor(''); setEvidence(''); setIsRoot(false) }
  }

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300 mb-2">
        {ICAM_LAYER_LABEL[layer]}
      </p>
      <ul className="space-y-1.5">
        {rows.map(r => (
          <li key={r.id} className="flex items-start gap-2 text-sm">
            <span className="mt-1.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
            <div className="flex-1">
              <p className="text-slate-700 dark:text-slate-200">{r.factor}</p>
              {r.evidence && <p className="text-[11px] text-slate-500 dark:text-slate-400">Evidence: {r.evidence}</p>}
            </div>
            {r.is_root && <RootBadge />}
            <DeleteButton onClick={() => onDelete(r.id)} disabled={busy} />
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-1">
        <input
          type="text"
          value={factor}
          onChange={e => setFactor(e.target.value)}
          placeholder="Add a factor…"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-xs"
        />
        <input
          type="text"
          value={evidence}
          onChange={e => setEvidence(e.target.value)}
          placeholder="Evidence (optional)"
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-xs"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
            <input type="checkbox" checked={isRoot} onChange={e => setIsRoot(e.target.checked)} />
            Root
          </label>
          <AddButton onClick={() => void submit()} disabled={busy || !factor.trim()} small />
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Shared widgets
// ──────────────────────────────────────────────────────────────────────────

function RootBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
      <Crown className="h-3 w-3" />
      ROOT
    </span>
  )
}

function DeleteButton({ onClick, disabled, small }: { onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Delete"
      className={
        'shrink-0 rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 ' +
        (small ? 'p-0.5' : 'p-1')
      }
    >
      <Trash2 className={small ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
    </button>
  )
}

function AddButton({ onClick, disabled, small }: { onClick: () => void; disabled?: boolean; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={
        'inline-flex items-center gap-1 rounded-lg bg-brand-navy text-white font-semibold hover:bg-brand-navy/90 disabled:opacity-50 ' +
        (small ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1.5 text-xs')
      }
    >
      <Plus className={small ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      Add
    </button>
  )
}
