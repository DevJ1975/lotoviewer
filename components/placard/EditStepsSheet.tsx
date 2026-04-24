'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ENERGY_CODES, energyCodeFor } from '@/lib/energyCodes'
import { Sheet } from '@/components/ui/sheet'
import type { Equipment, LotoEnergyStep } from '@/lib/types'

interface Props {
  open:         boolean
  onClose:      () => void
  equipment:    Equipment
  steps:        LotoEnergyStep[]
  onSaved:      (updated: LotoEnergyStep[]) => void
  onToast:      (msg: string, kind: 'success' | 'error') => void
}

// Drafts track both existing DB rows (dbId set) and rows added in-session
// (dbId undefined). Using a distinct React key — not the DB id — so new rows
// have a stable identity before they've been assigned one by Postgres.
type Draft = {
  key:                    string
  dbId?:                  string
  energy_type:            string
  step_number:            number
  tag_description:        string
  isolation_procedure:    string
  method_of_verification: string
}

function toDraft(step: LotoEnergyStep): Draft {
  return {
    key:                    step.id,
    dbId:                   step.id,
    energy_type:            step.energy_type,
    step_number:            step.step_number,
    tag_description:        step.tag_description        ?? '',
    isolation_procedure:    step.isolation_procedure    ?? '',
    method_of_verification: step.method_of_verification ?? '',
  }
}

// Next step_number for an energy type within a draft list. Ignores `excludeKey`
// so a row can recompute its own position when its energy_type changes
// without colliding with itself.
function nextStepNumber(drafts: Draft[], energy_type: string, excludeKey?: string): number {
  const taken = drafts
    .filter(d => d.key !== excludeKey && d.energy_type === energy_type)
    .map(d => d.step_number)
  return taken.length > 0 ? Math.max(...taken) + 1 : 1
}

let newRowCounter = 0
function makeNewKey(): string {
  newRowCounter += 1
  return `new-${Date.now()}-${newRowCounter}`
}

export default function EditStepsSheet({ open, onClose, equipment, steps, onSaved, onToast }: Props) {
  const equipmentId = equipment.equipment_id
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDrafts(steps.map(toDraft))
  }, [open, steps])

  function patch(key: string, updates: Partial<Draft>) {
    setDrafts(prev => prev.map(d => d.key === key ? { ...d, ...updates } : d))
  }

  function changeEnergyType(key: string, energy_type: string) {
    setDrafts(prev => prev.map(d => {
      if (d.key !== key) return d
      // Only new rows reassign step_number; existing DB rows keep their
      // original number even if the energy code were ever editable.
      const step_number = d.dbId ? d.step_number : nextStepNumber(prev, energy_type, key)
      return { ...d, energy_type, step_number }
    }))
  }

  function addStep() {
    setDrafts(prev => {
      const energy_type = 'E'
      const newDraft: Draft = {
        key:                    makeNewKey(),
        energy_type,
        step_number:            nextStepNumber(prev, energy_type),
        tag_description:        '',
        isolation_procedure:    '',
        method_of_verification: '',
      }
      return [...prev, newDraft]
    })
  }

  function removeNew(key: string) {
    setDrafts(prev => prev.filter(d => d.key !== key))
  }

  async function handleSave() {
    setSaving(true)

    // Partition: inserts are new rows with at least one non-empty field
    // (silently drop blank rows so an accidental Add Step doesn't create
    // garbage). Updates are existing rows whose text fields drifted from
    // what we loaded.
    const inserts = drafts.filter(d =>
      !d.dbId && (
        d.tag_description.trim()
        || d.isolation_procedure.trim()
        || d.method_of_verification.trim()
      ),
    )

    const updates = drafts.filter(d => {
      if (!d.dbId) return false
      const o = steps.find(s => s.id === d.dbId)
      if (!o) return false
      return (
        (o.tag_description        ?? '') !== d.tag_description        ||
        (o.isolation_procedure    ?? '') !== d.isolation_procedure    ||
        (o.method_of_verification ?? '') !== d.method_of_verification
      )
    })

    if (inserts.length === 0 && updates.length === 0) {
      setSaving(false)
      onClose()
      return
    }

    let inserted: LotoEnergyStep[] = []
    if (inserts.length > 0) {
      const insertRows = inserts.map(d => ({
        equipment_id:           equipmentId,
        energy_type:            d.energy_type,
        step_number:            d.step_number,
        tag_description:        d.tag_description.trim()        || null,
        isolation_procedure:    d.isolation_procedure.trim()    || null,
        method_of_verification: d.method_of_verification.trim() || null,
      }))
      const { data, error } = await supabase
        .from('loto_energy_steps')
        .insert(insertRows)
        .select('*')
      if (error) {
        onToast('Could not save. Check your connection and try again.', 'error')
        setSaving(false)
        return
      }
      inserted = (data ?? []) as LotoEnergyStep[]
    }

    if (updates.length > 0) {
      const updateResults = await Promise.all(updates.map(d =>
        supabase.from('loto_energy_steps').update({
          tag_description:        d.tag_description.trim()        || null,
          isolation_procedure:    d.isolation_procedure.trim()    || null,
          method_of_verification: d.method_of_verification.trim() || null,
        }).eq('id', d.dbId!),
      ))
      if (updateResults.some(r => r.error)) {
        onToast('Some step edits could not be saved. Please retry.', 'error')
        setSaving(false)
        return
      }
    }

    // Rebuild the full step list: start from existing DB rows (with the
    // edits applied), then append the newly inserted rows using their
    // server-assigned ids so the parent sees a clean LotoEnergyStep[].
    const touched = new Map(updates.map(d => [d.dbId!, d]))
    const updated: LotoEnergyStep[] = steps.map(s => {
      const d = touched.get(s.id)
      if (!d) return s
      return {
        ...s,
        tag_description:        d.tag_description.trim()        || null,
        isolation_procedure:    d.isolation_procedure.trim()    || null,
        method_of_verification: d.method_of_verification.trim() || null,
      }
    })

    // Match the fetch order (energy_type, step_number) so a freshly-added
    // E3 lands between E2 and P1, not appended at the tail, in the current
    // session — the next reload would sort them server-side anyway.
    const merged = [...updated, ...inserted].sort((a, b) =>
      a.energy_type === b.energy_type
        ? a.step_number - b.step_number
        : a.energy_type.localeCompare(b.energy_type)
    )
    const changedCount = inserts.length + updates.length
    onSaved(merged)
    onToast(
      `Saved ${changedCount} step${changedCount === 1 ? '' : 's'}.`,
      'success',
    )
    onClose()
    setSaving(false)
  }

  const hasAnyChanges = drafts.some(d => {
    if (!d.dbId) return (
      d.tag_description.trim()
      || d.isolation_procedure.trim()
      || d.method_of_verification.trim()
    )
    const o = steps.find(s => s.id === d.dbId)
    if (!o) return false
    return (
      (o.tag_description        ?? '') !== d.tag_description        ||
      (o.isolation_procedure    ?? '') !== d.isolation_procedure    ||
      (o.method_of_verification ?? '') !== d.method_of_verification
    )
  })

  return (
    <Sheet open={open} onClose={() => !saving && onClose()} title="Edit Energy Steps" subtitle={equipmentId}>
      {drafts.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-slate-500">No energy steps defined yet.</p>
          <button
            type="button"
            onClick={addStep}
            className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            + Add first step
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {drafts.map(draft => {
            const { hex, textHex, labelEn } = energyCodeFor(draft.energy_type)
            const isNew = !draft.dbId
            return (
              <div key={draft.key} className="rounded-xl border border-slate-100 p-4 space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-50">
                  {isNew ? (
                    <select
                      value={draft.energy_type}
                      onChange={e => changeEnergyType(draft.key, e.target.value)}
                      aria-label="Energy type"
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                    >
                      {ENERGY_CODES.map(c => (
                        <option key={c.code} value={c.code}>{c.code} — {c.labelEn}</option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold"
                      style={{ backgroundColor: hex, color: textHex }}
                    >
                      <span className="font-mono">{draft.energy_type}</span>
                      <span>{labelEn}</span>
                    </span>
                  )}
                  <span className="text-sm font-semibold text-slate-700">Step {draft.step_number}</span>
                  {isNew && (
                    <>
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">New</span>
                      <button
                        type="button"
                        onClick={() => removeNew(draft.key)}
                        disabled={saving}
                        aria-label="Remove this new step"
                        className="ml-auto text-slate-400 hover:text-rose-500 text-lg leading-none px-1"
                      >
                        ×
                      </button>
                    </>
                  )}
                </div>

                <FieldArea label="Tag & Description"                    value={draft.tag_description}        onChange={v => patch(draft.key, { tag_description: v })}        rows={2} />
                <FieldArea label="Isolation Procedure & Lockout Devices" value={draft.isolation_procedure}    onChange={v => patch(draft.key, { isolation_procedure: v })}    rows={3} />
                <FieldArea label="Method of Verification"                value={draft.method_of_verification} onChange={v => patch(draft.key, { method_of_verification: v })} rows={2} />
              </div>
            )
          })}

          <button
            type="button"
            onClick={addStep}
            disabled={saving}
            className="w-full rounded-lg border border-dashed border-slate-300 py-2.5 text-sm font-semibold text-slate-600 hover:text-brand-navy hover:border-brand-navy/40 transition-colors"
          >
            + Add another step
          </button>
        </div>
      )}

      <div className="sticky bottom-0 bg-white pt-4 mt-6 border-t border-slate-100 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !hasAnyChanges}
          className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </Sheet>
  )
}

function FieldArea({ label, value, onChange, rows }: { label: string; value: string; onChange: (v: string) => void; rows: number }) {
  return (
    <div className="space-y-1.5">
      <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
      <textarea
        rows={rows}
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
      />
    </div>
  )
}
