'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, FlaskConical, Loader2, Plus, ShieldCheck, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ppeGapAnalysis,
  unionChemicalPpe,
} from '@soteria/core/chemicals'
import type { GhsPictogram } from '@soteria/core/chemicals'

// Per-JHA-step panel rendered on /jha/[id]/page.tsx that lets the
// editor link chemicals to the step. The panel surfaces:
//
//   - chips for each linked chemical (signal-word + GHS pictograms)
//   - a "derived PPE" pill row (union of every linked chemical's
//     ppe_required, deduped + lowercase-folded)
//   - missing-PPE warnings vs whatever the JHA's PPE list contains
//   - a chemical picker filtered by the tenant catalog
//
// The JHA's PPE list is currently a free-text aggregate column on
// jhas (`ppe_required` denormalized roll-up) — we treat the listed
// PPE as canonical and flag deltas against derived PPE.

interface ProductLink {
  id:         string
  product_id: string
  step_id:    string
  usage_notes: string | null
  chemical_products: {
    id:              string
    name:            string
    manufacturer:    string | null
    ghs_signal_word: string | null
    ghs_pictograms:  GhsPictogram[] | null
    ppe_required:    string[] | null
    storage_class:   string | null
    archived_at:     string | null
  } | null
}

interface CatalogProduct {
  id:           string
  name:         string
  manufacturer: string | null
  ppe_required: string[] | null
}

interface Props {
  jhaId:           string
  stepId:          string
  /** PPE the JHA currently lists. Used for the gap analysis. */
  jhaListedPpe:    readonly string[]
  /** Editor toggle — view-only mode hides the picker + remove buttons. */
  canEdit:         boolean
}

export default function StepChemicalsPanel(props: Props) {
  const { tenant } = useTenant()
  const [links,    setLinks]    = useState<ProductLink[] | null>(null)
  const [catalog,  setCatalog]  = useState<CatalogProduct[]>([])
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState(false)
  const [showAdd,  setShowAdd]  = useState(false)
  const [pickedId, setPickedId] = useState('')
  const [usage,    setUsage]    = useState('')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const [lRes, pRes] = await Promise.all([
      fetch(`/api/jha/${props.jhaId}/steps/${props.stepId}/chemicals`, { headers }),
      fetch('/api/chemicals/products?limit=500', { headers }),
    ])
    if (!lRes.ok) {
      const body = await lRes.json().catch(() => ({}))
      setError(body.error ?? `HTTP ${lRes.status}`)
      setLinks([])
      return
    }
    const lBody = await lRes.json()
    setLinks(lBody.links ?? [])
    if (pRes.ok) {
      const pBody = await pRes.json()
      setCatalog(pBody.products ?? [])
    }
  }, [tenant, props.jhaId, props.stepId, buildHeaders])

  useEffect(() => { void load() }, [load])

  async function add() {
    if (!pickedId) {
      setError('Pick a chemical')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch(
        `/api/jha/${props.jhaId}/steps/${props.stepId}/chemicals`,
        {
          method:  'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body:    JSON.stringify({
            product_id:  pickedId,
            usage_notes: usage.trim() || undefined,
          }),
        },
      )
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setShowAdd(false)
      setPickedId('')
      setUsage('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function unlink(linkId: string) {
    if (!confirm('Unlink this chemical from the step?')) return
    setBusy(true)
    try {
      const headers = await buildHeaders()
      const res = await fetch(
        `/api/jha/${props.jhaId}/steps/${props.stepId}/chemicals/${linkId}`,
        { method: 'DELETE', headers },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  const derivedPpe = useMemo(() => unionChemicalPpe(
    (links ?? []).map(l => l.chemical_products).filter(Boolean) as { ppe_required?: string[] | null }[],
  ), [links])

  const gap = useMemo(
    () => ppeGapAnalysis(derivedPpe, props.jhaListedPpe),
    [derivedPpe, props.jhaListedPpe],
  )

  if (links === null) {
    return (
      <div className="mt-2 text-xs text-slate-500 flex items-center gap-1">
        <Loader2 className="w-3 h-3 animate-spin" /> loading chemicals…
      </div>
    )
  }

  return (
    <div className="mt-3 rounded border border-slate-200 dark:border-slate-700 px-3 py-2 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase text-slate-500 flex items-center gap-1">
          <FlaskConical className="w-3 h-3" /> Chemicals
        </div>
        {props.canEdit && !showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Link chemical
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-2 py-1 text-xs text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded border border-slate-200 dark:border-slate-700 px-2 py-2 space-y-2 bg-slate-50 dark:bg-slate-900">
          <select
            value={pickedId}
            onChange={e => setPickedId(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            <option value="">— pick a chemical —</option>
            {catalog.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.manufacturer ? ` · ${p.manufacturer}` : ''}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={usage}
            onChange={e => setUsage(e.target.value)}
            placeholder="Usage notes (optional) — e.g. 5% solution, decanted from drum"
            className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <div className="flex justify-end gap-1">
            <button
              onClick={() => { setShowAdd(false); setPickedId(''); setUsage('') }}
              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700"
            >Cancel</button>
            <button
              onClick={() => void add()}
              disabled={busy || !pickedId}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Link
            </button>
          </div>
        </div>
      )}

      {links.length === 0 ? (
        <div className="text-xs italic text-slate-400">No chemicals linked.</div>
      ) : (
        <ul className="space-y-1">
          {links.map(link => {
            const p = link.chemical_products
            return (
              <li key={link.id} className="text-xs flex flex-wrap items-center gap-2">
                {p ? (
                  <Link
                    href={`/chemicals/${p.id}`}
                    className="font-medium text-slate-900 dark:text-slate-100 hover:underline"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="italic text-slate-400">(deleted chemical)</span>
                )}
                {p?.manufacturer && (
                  <span className="text-slate-500">· {p.manufacturer}</span>
                )}
                {p?.ghs_signal_word === 'danger' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    DANGER
                  </span>
                )}
                {p?.ghs_signal_word === 'warning' && (
                  <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    WARNING
                  </span>
                )}
                {(p?.ghs_pictograms ?? []).map(g => (
                  <span
                    key={g}
                    className="inline-flex items-center px-1 py-0.5 text-[10px] font-mono rounded border bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"
                    title={g}
                  >{g}</span>
                ))}
                {link.usage_notes && (
                  <span className="text-slate-500 italic">— {link.usage_notes}</span>
                )}
                {props.canEdit && (
                  <button
                    onClick={() => void unlink(link.id)}
                    disabled={busy}
                    className="ml-auto text-slate-400 hover:text-rose-600 disabled:opacity-50"
                    title="Unlink"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {derivedPpe.length > 0 && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-1">
          <div className="text-xs font-semibold uppercase text-slate-500 flex items-center gap-1">
            <ShieldCheck className="w-3 h-3" /> Derived PPE
          </div>
          <div className="flex flex-wrap gap-1">
            {derivedPpe.map(ppe => {
              const isCovered  = gap.covered.some(c => c.toLowerCase() === ppe.toLowerCase())
              return (
                <span
                  key={ppe}
                  className={`inline-flex items-center px-2 py-0.5 text-[11px] rounded border ${
                    isCovered
                      ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                      : 'bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                  }`}
                >
                  {ppe}
                </span>
              )
            })}
          </div>

          {gap.missing.length > 0 && (
            <div className="rounded border border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20 px-2 py-1.5 text-[11px] text-rose-800 dark:text-rose-300 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
              <span>
                <strong>Missing from JHA PPE:</strong> {gap.missing.join(', ')}.
                Add to the JHA&apos;s PPE list to close the gap.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
