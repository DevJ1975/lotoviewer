'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import {
  HIERARCHY_LABELS,
  HIERARCHY_ORDER,
  evaluatePpeAloneRule,
  type HierarchyLevel,
} from '@soteria/core/risk'
import type { WizardState, WizardControl } from '@/lib/risk-wizard'

// Wizard step 4 — Hierarchy of Controls selector with PPE-alone
// enforcement.
//
// Three bands of UI:
//   1. Suggested-controls panel: pulls from /api/risk/controls-library,
//      filtered by the selected hazard category. Click to attach.
//   2. Custom-control row: free-text entry + hierarchy-level picker.
//   3. Selected-controls list: chips per added control, removable.
//
// Live PPE-alone check below the list. When inherent_score >= 8 AND
// every selected control is PPE, we surface a required justification
// textarea inline (matches the migration-039 DB constraint trigger).

interface LibraryControl {
  id:               string
  hierarchy_level:  HierarchyLevel
  name:             string
  description:      string | null
  regulatory_ref:   string | null
}

interface Props {
  state: WizardState
  set:   <K extends keyof WizardState>(k: K, v: WizardState[K]) => void
}

export default function StepControls({ state, set }: Props) {
  const { tenant } = useTenant()
  const inherentScore = state.inherent_severity * state.inherent_likelihood

  // Load library controls filtered by the selected hazard category.
  const [library,   setLibrary]   = useState<LibraryControl[] | null>(null)
  const [libError,  setLibError]  = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const headers: Record<string, string> = {}
        if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
        if (tenant?.id)            headers['x-active-tenant'] = tenant.id
        const url = state.hazard_category
          ? `/api/risk/controls-library?hazard_category=${state.hazard_category}`
          : `/api/risk/controls-library`
        const res = await fetch(url, { headers })
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
        setLibrary(body.controls ?? [])
      } catch (e) {
        if (cancelled) return
        setLibError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    return () => { cancelled = true }
  }, [state.hazard_category, tenant?.id])

  // PPE-alone status — drives the inline justification field.
  const ppeAlone = useMemo(() => evaluatePpeAloneRule({
    inherentScore,
    controlLevels: state.controls.map(c => c.hierarchy_level),
    hasPpeOnlyJustification: state.ppe_only_justification.trim().length > 0,
  }), [inherentScore, state.controls, state.ppe_only_justification])

  function addLibraryControl(c: LibraryControl) {
    if (state.controls.some(x => x.control_id === c.id)) return  // already added
    set('controls', [
      ...state.controls,
      {
        localId:         localId(),
        control_id:      c.id,
        hierarchy_level: c.hierarchy_level,
        display_name:    c.name,
        notes:           '',
      },
    ])
  }

  function removeControl(localId: string) {
    set('controls', state.controls.filter(c => c.localId !== localId))
  }

  function addCustomControl() {
    set('controls', [
      ...state.controls,
      {
        localId:         localId(),
        control_id:      null,
        hierarchy_level: 'engineering',
        display_name:    '',
        notes:           '',
      },
    ])
  }

  function updateControl(localId: string, patch: Partial<WizardControl>) {
    set('controls', state.controls.map(c => c.localId === localId ? { ...c, ...patch } : c))
  }

  // Group library by hierarchy level for the suggested panel.
  const libraryByLevel = useMemo(() => {
    const groups: Record<HierarchyLevel, LibraryControl[]> = {
      elimination: [], substitution: [], engineering: [], administrative: [], ppe: [],
    }
    if (library) for (const c of library) groups[c.hierarchy_level].push(c)
    return groups
  }, [library])

  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 px-3 py-2 text-xs text-sky-900 dark:text-sky-200">
        Controls follow the <strong>Hierarchy of Controls</strong> (ISO 45001 8.1.2). Higher-level
        controls — Elimination &gt; Substitution &gt; Engineering &gt; Administrative &gt; PPE — are
        always preferred. PPE alone is the lowest tier and triggers a justification when the
        inherent score is high (≥ 8).
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
          Suggested controls {state.hazard_category ? `for ${state.hazard_category} hazards` : ''}
        </div>
        {library === null && !libError && (
          <p className="text-xs text-slate-400 italic">Loading library…</p>
        )}
        {libError && (
          <p className="text-xs text-rose-700 bg-rose-50 px-2 py-1 rounded">{libError}</p>
        )}
        {library && library.length === 0 && (
          <p className="text-xs text-slate-400 italic">
            No library entries yet for this category. Add custom controls below.
          </p>
        )}
        {library && library.length > 0 && (
          <div className="space-y-3">
            {HIERARCHY_ORDER.map(level => {
              const items = libraryByLevel[level]
              if (items.length === 0) return null
              return (
                <div key={level}>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">
                    {HIERARCHY_LABELS[level]}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map(c => {
                      const added = state.controls.some(x => x.control_id === c.id)
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={added}
                          onClick={() => addLibraryControl(c)}
                          title={c.description ?? c.name}
                          className={
                            'text-xs px-2 py-1 rounded-md border transition-colors text-left max-w-xs ' +
                            (added
                              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 cursor-default'
                              : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700')
                          }
                        >
                          {added ? '✓ ' : '+ '}{c.name}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Selected controls ({state.controls.length})
          </div>
          <button
            type="button"
            onClick={addCustomControl}
            className="text-xs font-semibold inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Plus className="h-3 w-3" /> Add custom control
          </button>
        </div>

        {state.controls.length === 0 ? (
          <p className="text-xs text-slate-400 italic py-3 text-center">
            No controls selected yet. You can pick from the suggestions above, add a custom control, or proceed and add controls later.
          </p>
        ) : (
          <div className="space-y-2">
            {state.controls.map(c => (
              <div key={c.localId} className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                <select
                  value={c.hierarchy_level}
                  onChange={e => updateControl(c.localId, { hierarchy_level: e.target.value as HierarchyLevel })}
                  className="text-xs rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-2 py-1"
                >
                  {HIERARCHY_ORDER.map(l => (
                    <option key={l} value={l}>{HIERARCHY_LABELS[l]}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={c.display_name}
                  onChange={e => updateControl(c.localId, { display_name: e.target.value })}
                  placeholder={c.control_id ? '' : 'Custom control name'}
                  disabled={!!c.control_id}
                  className={
                    'flex-1 text-sm rounded border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 ' +
                    (c.control_id ? 'bg-slate-50 dark:bg-slate-900' : '')
                  }
                />
                <button
                  type="button"
                  onClick={() => removeControl(c.localId)}
                  className="shrink-0 text-slate-400 hover:text-rose-700 w-7 h-7 flex items-center justify-center"
                  title="Remove this control"
                  aria-label="Remove control"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* PPE-alone justification — appears when the rule applies. */}
      {ppeAlone.applies && (
        <div className={
          'rounded-lg border px-3 py-3 space-y-2 ' +
          (ppeAlone.allowed
            ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
            : 'bg-rose-50 dark:bg-rose-900/20 border-rose-300 dark:border-rose-800')
        }>
          <div className="text-xs font-bold uppercase tracking-wider">
            {ppeAlone.allowed ? '✓ ' : '⚠ '}PPE-alone rule (ISO 45001 8.1.2)
          </div>
          <p className="text-[12px] leading-5 text-slate-700 dark:text-slate-300">
            All your selected controls are PPE-level, and the inherent score
            ({inherentScore}) is high enough that ISO 45001 8.1.2 + OSHA 1910.132(a)
            require documented justification for why higher-level controls are not
            feasible.
          </p>
          <textarea
            value={state.ppe_only_justification}
            onChange={e => set('ppe_only_justification', e.target.value)}
            rows={3}
            placeholder="Explain why elimination, substitution, engineering, or administrative controls are not feasible for this hazard."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </div>
      )}
    </div>
  )
}

function localId(): string {
  return Math.random().toString(36).slice(2, 12)
}
