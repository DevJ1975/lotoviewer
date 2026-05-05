'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, Plus, X, ChevronUp, ChevronDown, ShieldAlert } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  JHA_HAZARD_CATEGORIES,
  JHA_SEVERITY_BANDS,
  countPpeAloneWarnings,
  type JhaHazardCategory,
  type JhaSeverity,
  type JhaRow,
  type JhaStep,
  type JhaHazard,
  type JhaHazardControl,
} from '@soteria/core/jha'
import { HIERARCHY_ORDER, HIERARCHY_LABELS, type HierarchyLevel } from '@soteria/core/risk'

// /jha/[id]/edit — Full breakdown editor.
//
// State is held in component state with local_id strings; the
// "Save" button POSTs the whole tree to PUT /api/jha/[id]/breakdown
// which replaces the existing breakdown atomically (-ish, see route
// notes).

interface ControlsLibraryEntry {
  id:              string
  hierarchy_level: HierarchyLevel
  name:            string
  applicable_categories: string[]
}

interface DraftStep   { local_id: string; sequence: number; description: string; notes: string | null }
interface DraftHazard { local_id: string; step_local_id: string | null; hazard_category: JhaHazardCategory; description: string; potential_severity: JhaSeverity; notes: string | null }
interface DraftControl { local_id: string; hazard_local_id: string; control_id: string | null; custom_name: string | null; hierarchy_level: HierarchyLevel; notes: string | null }

let nextId = 1
const localId = (prefix: string) => `${prefix}-${nextId++}-${Math.random().toString(36).slice(2, 7)}`

export default function JhaEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenant } = useTenant()

  const [jha,      setJha]      = useState<JhaRow | null>(null)
  const [steps,    setSteps]    = useState<DraftStep[]>([])
  const [hazards,  setHazards]  = useState<DraftHazard[]>([])
  const [controls, setControls] = useState<DraftControl[]>([])
  const [library,  setLibrary]  = useState<ControlsLibraryEntry[]>([])

  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Hydrate the editor from the DB bundle. Each row gets a stable
  // local_id so the in-memory tree can be linked across the three
  // arrays without re-keying on every render.
  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    async function load() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const headers: Record<string, string> = { 'x-active-tenant': tenant!.id }
        if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

        const [bundleRes, libRes] = await Promise.all([
          fetch(`/api/jha/${id}`, { headers }),
          fetch('/api/risk/controls-library', { headers }),
        ])
        const bundleBody = await bundleRes.json()
        const libBody    = await libRes.json()
        if (cancelled) return
        if (!bundleRes.ok) throw new Error(bundleBody.error ?? `JHA load HTTP ${bundleRes.status}`)
        if (!libRes.ok)    throw new Error(libBody.error    ?? `Library load HTTP ${libRes.status}`)

        setJha(bundleBody.jha as JhaRow)
        setLibrary((libBody.controls ?? []) as ControlsLibraryEntry[])

        const stepIdMap = new Map<string, string>()
        const dbSteps   = (bundleBody.steps    ?? []) as JhaStep[]
        const dbHazards = (bundleBody.hazards  ?? []) as JhaHazard[]
        const dbCtrls   = (bundleBody.controls ?? []) as JhaHazardControl[]

        const draftSteps: DraftStep[] = dbSteps.map(s => {
          const lid = localId('s')
          stepIdMap.set(s.id, lid)
          return { local_id: lid, sequence: s.sequence, description: s.description, notes: s.notes }
        })

        const hazardIdMap = new Map<string, string>()
        const draftHazards: DraftHazard[] = dbHazards.map(h => {
          const lid = localId('h')
          hazardIdMap.set(h.id, lid)
          return {
            local_id:           lid,
            step_local_id:      h.step_id ? stepIdMap.get(h.step_id) ?? null : null,
            hazard_category:    h.hazard_category,
            description:        h.description,
            potential_severity: h.potential_severity,
            notes:              h.notes,
          }
        })

        const draftControls: DraftControl[] = dbCtrls.map(c => ({
          local_id:        localId('c'),
          hazard_local_id: hazardIdMap.get(c.hazard_id) ?? '',
          control_id:      c.control_id,
          custom_name:     c.custom_name,
          hierarchy_level: c.hierarchy_level,
          notes:           c.notes,
        })).filter(c => c.hazard_local_id !== '')

        setSteps(draftSteps)
        setHazards(draftHazards)
        setControls(draftControls)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [tenant?.id, id])

  // ─── Mutators ───────────────────────────────────────────────────────────
  const addStep = useCallback(() => {
    setSteps(prev => [...prev, { local_id: localId('s'), sequence: prev.length + 1, description: '', notes: null }])
  }, [])

  const updateStep = useCallback((sid: string, patch: Partial<DraftStep>) => {
    setSteps(prev => prev.map(s => s.local_id === sid ? { ...s, ...patch } : s))
  }, [])

  const moveStep = useCallback((sid: string, dir: -1 | 1) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.local_id === sid)
      const target = idx + dir
      if (idx < 0 || target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next.map((s, i) => ({ ...s, sequence: i + 1 }))
    })
  }, [])

  const removeStep = useCallback((sid: string) => {
    setSteps(prev => prev.filter(s => s.local_id !== sid).map((s, i) => ({ ...s, sequence: i + 1 })))
    // Orphan hazards (those tied to this step) become "general".
    setHazards(prev => prev.map(h => h.step_local_id === sid ? { ...h, step_local_id: null } : h))
  }, [])

  const addHazard = useCallback((stepLocalId: string | null) => {
    setHazards(prev => [...prev, {
      local_id: localId('h'), step_local_id: stepLocalId, hazard_category: 'physical',
      description: '', potential_severity: 'moderate', notes: null,
    }])
  }, [])

  const updateHazard = useCallback((hid: string, patch: Partial<DraftHazard>) => {
    setHazards(prev => prev.map(h => h.local_id === hid ? { ...h, ...patch } : h))
  }, [])

  const removeHazard = useCallback((hid: string) => {
    setHazards(prev => prev.filter(h => h.local_id !== hid))
    setControls(prev => prev.filter(c => c.hazard_local_id !== hid))
  }, [])

  const addControl = useCallback((hazardLocalId: string) => {
    setControls(prev => [...prev, {
      local_id: localId('c'), hazard_local_id: hazardLocalId, control_id: null,
      custom_name: '', hierarchy_level: 'engineering', notes: null,
    }])
  }, [])

  const updateControl = useCallback((cid: string, patch: Partial<DraftControl>) => {
    setControls(prev => prev.map(c => c.local_id === cid ? { ...c, ...patch } : c))
  }, [])

  const removeControl = useCallback((cid: string) => {
    setControls(prev => prev.filter(c => c.local_id !== cid))
  }, [])

  // Editor-side check that mirrors countPpeAloneWarnings. We pass a
  // synthetic hazard set with the local_ids re-mapped to the API's
  // hazard_id so the helper works without reshaping.
  const ppeWarnings = useMemo(
    () => countPpeAloneWarnings(
      hazards.map(h => ({ ...h, id: h.local_id, jha_id: '', tenant_id: '', step_id: null, created_at: '' })),
      controls.map(c => ({ ...c, id: c.local_id, hazard_id: c.hazard_local_id, jha_id: '', tenant_id: '', created_at: '' })),
    ),
    [hazards, controls],
  )

  // ─── Save ───────────────────────────────────────────────────────────────
  async function onSave() {
    if (!tenant?.id) return
    // Light client-side validation — the API does the same checks
    // and is the authority.
    for (const s of steps) if (!s.description.trim()) { setError('Every step needs a description.'); return }
    for (const h of hazards) if (!h.description.trim()) { setError('Every hazard needs a description.'); return }
    for (const c of controls) if (!c.control_id && !(c.custom_name?.trim())) {
      setError('Every control needs either a library entry or a custom name.'); return
    }

    setSaving(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch(`/api/jha/${id}/breakdown`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          steps:    steps.map(s => ({ local_id: s.local_id, sequence: s.sequence, description: s.description, notes: s.notes })),
          hazards:  hazards.map(h => ({
            local_id:           h.local_id,
            step_local_id:      h.step_local_id,
            hazard_category:    h.hazard_category,
            description:        h.description,
            potential_severity: h.potential_severity,
            notes:              h.notes,
          })),
          controls: controls.map(c => ({
            hazard_local_id: c.hazard_local_id,
            control_id:      c.control_id,
            custom_name:     c.custom_name,
            hierarchy_level: c.hierarchy_level,
            notes:           c.notes,
          })),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.push(`/jha/${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={`/jha/${id}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to JHA
        </Link>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-5 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save breakdown
        </button>
      </div>

      <header>
        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{jha?.job_number}</p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{jha?.title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Edit steps, identify hazards within each, and apply controls from the hierarchy.
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {ppeWarnings > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">PPE-alone warning</p>
            <p>
              {ppeWarnings} high/extreme {ppeWarnings === 1 ? 'hazard is' : 'hazards are'} covered only by PPE.
              ISO 45001 8.1.2 requires you to consider higher-level controls first. You can save anyway —
              the warning is a flag, not a block.
            </p>
          </div>
        </div>
      )}

      <section className="space-y-3">
        {steps.map(s => (
          <StepCard
            key={s.local_id}
            step={s}
            hazards={hazards.filter(h => h.step_local_id === s.local_id)}
            controls={controls}
            library={library}
            onUpdate={updateStep}
            onMove={moveStep}
            onRemove={removeStep}
            onAddHazard={() => addHazard(s.local_id)}
            onUpdateHazard={updateHazard}
            onRemoveHazard={removeHazard}
            onAddControl={addControl}
            onUpdateControl={updateControl}
            onRemoveControl={removeControl}
            isFirst={s.sequence === 1}
            isLast={s.sequence === steps.length}
          />
        ))}

        <button
          type="button"
          onClick={addStep}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-3 text-sm font-medium text-slate-600 dark:text-slate-300 hover:border-brand-navy hover:text-brand-navy"
        >
          <Plus className="h-4 w-4" />
          Add step
        </button>

        {/* General hazards (step_local_id=null). Render as a separate
            card so they're visually distinct from per-step hazards. */}
        <GeneralHazardsCard
          hazards={hazards.filter(h => h.step_local_id === null)}
          controls={controls}
          library={library}
          onAddHazard={() => addHazard(null)}
          onUpdateHazard={updateHazard}
          onRemoveHazard={removeHazard}
          onAddControl={addControl}
          onUpdateControl={updateControl}
          onRemoveControl={removeControl}
        />
      </section>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Step card
// ──────────────────────────────────────────────────────────────────────────

interface StepCardProps {
  step:           DraftStep
  hazards:        DraftHazard[]
  controls:       DraftControl[]
  library:        ControlsLibraryEntry[]
  onUpdate:       (sid: string, patch: Partial<DraftStep>) => void
  onMove:         (sid: string, dir: -1 | 1) => void
  onRemove:       (sid: string) => void
  onAddHazard:    () => void
  onUpdateHazard: (hid: string, patch: Partial<DraftHazard>) => void
  onRemoveHazard: (hid: string) => void
  onAddControl:   (hazardLocalId: string) => void
  onUpdateControl: (cid: string, patch: Partial<DraftControl>) => void
  onRemoveControl: (cid: string) => void
  isFirst:        boolean
  isLast:         boolean
}

function StepCard(props: StepCardProps) {
  const { step, hazards, isFirst, isLast } = props
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-start gap-2">
        <span className="font-mono text-sm text-slate-500 dark:text-slate-400 w-6 tabular-nums shrink-0 mt-2">{step.sequence}.</span>
        <input
          type="text"
          value={step.description}
          onChange={e => props.onUpdate(step.local_id, { description: e.target.value })}
          placeholder="What does the worker do at this step?"
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-medium"
        />
        <div className="flex items-center gap-1">
          <IconBtn label="Move up"   icon={<ChevronUp   className="h-4 w-4" />} disabled={isFirst} onClick={() => props.onMove(step.local_id, -1)} />
          <IconBtn label="Move down" icon={<ChevronDown className="h-4 w-4" />} disabled={isLast}  onClick={() => props.onMove(step.local_id,  1)} />
          <IconBtn label="Remove step" icon={<X className="h-4 w-4 text-rose-500" />} onClick={() => props.onRemove(step.local_id)} />
        </div>
      </div>

      <textarea
        value={step.notes ?? ''}
        onChange={e => props.onUpdate(step.local_id, { notes: e.target.value || null })}
        placeholder="Notes (optional)"
        rows={1}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-500"
      />

      <HazardList
        hazards={hazards}
        controls={props.controls}
        library={props.library}
        onAddHazard={props.onAddHazard}
        onUpdateHazard={props.onUpdateHazard}
        onRemoveHazard={props.onRemoveHazard}
        onAddControl={props.onAddControl}
        onUpdateControl={props.onUpdateControl}
        onRemoveControl={props.onRemoveControl}
      />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// General-hazards card (step_local_id=null bucket)
// ──────────────────────────────────────────────────────────────────────────

function GeneralHazardsCard(props: Omit<StepCardProps, 'step' | 'onUpdate' | 'onMove' | 'onRemove' | 'isFirst' | 'isLast'>) {
  if (props.hazards.length === 0) {
    return (
      <button
        type="button"
        onClick={props.onAddHazard}
        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 px-4 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 hover:border-amber-300 hover:text-amber-700"
      >
        <Plus className="h-4 w-4" />
        Add general (job-wide) hazard
      </button>
    )
  }
  return (
    <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
        General hazards (job-wide)
      </h3>
      <HazardList {...props} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Hazard list within a step (or the general bucket)
// ──────────────────────────────────────────────────────────────────────────

function HazardList(props: Pick<StepCardProps, 'hazards' | 'controls' | 'library' | 'onAddHazard' | 'onUpdateHazard' | 'onRemoveHazard' | 'onAddControl' | 'onUpdateControl' | 'onRemoveControl'>) {
  return (
    <div className="space-y-2">
      {props.hazards.map(h => (
        <HazardRow
          key={h.local_id}
          hazard={h}
          controls={props.controls.filter(c => c.hazard_local_id === h.local_id)}
          library={props.library}
          onUpdate={props.onUpdateHazard}
          onRemove={props.onRemoveHazard}
          onAddControl={() => props.onAddControl(h.local_id)}
          onUpdateControl={props.onUpdateControl}
          onRemoveControl={props.onRemoveControl}
        />
      ))}
      <button
        type="button"
        onClick={props.onAddHazard}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-navy hover:underline"
      >
        <Plus className="h-3 w-3" /> Add hazard
      </button>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Single hazard
// ──────────────────────────────────────────────────────────────────────────

interface HazardRowProps {
  hazard:          DraftHazard
  controls:        DraftControl[]
  library:         ControlsLibraryEntry[]
  onUpdate:        (hid: string, patch: Partial<DraftHazard>) => void
  onRemove:        (hid: string) => void
  onAddControl:    () => void
  onUpdateControl: (cid: string, patch: Partial<DraftControl>) => void
  onRemoveControl: (cid: string) => void
}

function HazardRow({ hazard, controls, library, onUpdate, onRemove, onAddControl, onUpdateControl, onRemoveControl }: HazardRowProps) {
  return (
    <div className="rounded-lg bg-slate-50 dark:bg-slate-950 p-3 space-y-2">
      <div className="flex items-start gap-2">
        <input
          type="text"
          value={hazard.description}
          onChange={e => onUpdate(hazard.local_id, { description: e.target.value })}
          placeholder="What can go wrong?"
          className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-1.5 text-sm"
        />
        <IconBtn label="Remove hazard" icon={<X className="h-4 w-4 text-rose-500" />} onClick={() => onRemove(hazard.local_id)} />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        <select
          value={hazard.hazard_category}
          onChange={e => onUpdate(hazard.local_id, { hazard_category: e.target.value as JhaHazardCategory })}
          className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 capitalize"
        >
          {JHA_HAZARD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          value={hazard.potential_severity}
          onChange={e => onUpdate(hazard.local_id, { potential_severity: e.target.value as JhaSeverity })}
          className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 capitalize"
        >
          {JHA_SEVERITY_BANDS.map(s => <option key={s} value={s}>{s} severity</option>)}
        </select>
      </div>

      <div className="space-y-1.5 pl-3 border-l-2 border-slate-200 dark:border-slate-800">
        {controls.map(c => (
          <ControlRow
            key={c.local_id}
            control={c}
            library={library}
            hazardCategory={hazard.hazard_category}
            onUpdate={onUpdateControl}
            onRemove={onRemoveControl}
          />
        ))}
        <button
          type="button"
          onClick={onAddControl}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-brand-navy hover:underline"
        >
          <Plus className="h-3 w-3" /> Add control
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Single control
// ──────────────────────────────────────────────────────────────────────────

interface ControlRowProps {
  control:        DraftControl
  library:        ControlsLibraryEntry[]
  hazardCategory: JhaHazardCategory
  onUpdate:       (cid: string, patch: Partial<DraftControl>) => void
  onRemove:       (cid: string) => void
}

function ControlRow({ control, library, hazardCategory, onUpdate, onRemove }: ControlRowProps) {
  // Filter the library by the hazard's category if a filter applies,
  // else show everything (the user may want to attach a generic
  // control like "Training").
  const filtered = useMemo(() => {
    return library.filter(l => {
      if (!Array.isArray(l.applicable_categories) || l.applicable_categories.length === 0) return true
      return l.applicable_categories.includes(hazardCategory)
    })
  }, [library, hazardCategory])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr_1fr_auto] gap-2 items-center">
      <select
        value={control.hierarchy_level}
        onChange={e => onUpdate(control.local_id, { hierarchy_level: e.target.value as HierarchyLevel })}
        className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[11px] capitalize"
      >
        {HIERARCHY_ORDER.map(h => <option key={h} value={h}>{HIERARCHY_LABELS[h]}</option>)}
      </select>

      <select
        value={control.control_id ?? ''}
        onChange={e => onUpdate(control.local_id, { control_id: e.target.value || null, custom_name: e.target.value ? null : (control.custom_name ?? '') })}
        className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[11px]"
      >
        <option value="">— from library —</option>
        {filtered.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>

      <input
        type="text"
        value={control.custom_name ?? ''}
        onChange={e => onUpdate(control.local_id, { custom_name: e.target.value, control_id: e.target.value ? null : control.control_id })}
        placeholder="…or custom name"
        className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-[11px]"
      />

      <IconBtn label="Remove control" icon={<X className="h-3.5 w-3.5 text-rose-500" />} onClick={() => onRemove(control.local_id)} />
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────

function IconBtn({ label, icon, onClick, disabled }: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {icon}
    </button>
  )
}
