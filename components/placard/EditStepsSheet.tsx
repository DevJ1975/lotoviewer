'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { energyCodeFor } from '@/lib/energyCodes'
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

export default function EditStepsSheet({ open, onClose, equipment, steps, onSaved, onToast }: Props) {
  const equipmentId = equipment.equipment_id
  const [draft, setDraft]   = useState<LotoEnergyStep[]>(steps)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setDraft(steps.map(s => ({ ...s })))
  }, [open, steps])

  function patch(id: string, updates: Partial<LotoEnergyStep>) {
    setDraft(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))
  }

  async function handleSave() {
    setSaving(true)
    const changed = draft.filter(d => {
      const o = steps.find(s => s.id === d.id)
      if (!o) return false
      return (
        o.tag_description        !== d.tag_description ||
        o.isolation_procedure    !== d.isolation_procedure ||
        o.method_of_verification !== d.method_of_verification
      )
    })

    if (changed.length === 0) {
      setSaving(false)
      onClose()
      return
    }

    const results = await Promise.all(changed.map(row =>
      supabase.from('loto_energy_steps').update({
        tag_description:        row.tag_description,
        isolation_procedure:    row.isolation_procedure,
        method_of_verification: row.method_of_verification,
      }).eq('id', row.id),
    ))

    if (results.some(r => r.error)) {
      onToast('Could not save. Check your connection and try again.', 'error')
    } else {
      onSaved(draft)
      onToast(`Saved ${changed.length} step${changed.length === 1 ? '' : 's'}.`, 'success')
      onClose()
    }
    setSaving(false)
  }

  return (
    <Sheet open={open} onClose={() => !saving && onClose()} title="Edit Energy Steps" subtitle={equipmentId}>
      {steps.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No energy steps defined for this equipment.</p>
      ) : (
        <div className="space-y-6">
          {draft.map(step => {
            const { hex, textHex, labelEn } = energyCodeFor(step.energy_type)
            return (
              <div key={step.id} className="rounded-xl border border-slate-100 p-4 space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-50">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold"
                    style={{ backgroundColor: hex, color: textHex }}
                  >
                    <span className="font-mono">{step.energy_type}</span>
                    <span>{labelEn}</span>
                  </span>
                  <span className="text-sm font-semibold text-slate-700">Step {step.step_number}</span>
                </div>

                <FieldArea label="Tag & Description"                    value={step.tag_description ?? ''}         onChange={v => patch(step.id, { tag_description: v })}        rows={2} />
                <FieldArea label="Isolation Procedure & Lockout Devices" value={step.isolation_procedure ?? ''}     onChange={v => patch(step.id, { isolation_procedure: v })}    rows={3} />
                <FieldArea label="Method of Verification"                value={step.method_of_verification ?? ''}  onChange={v => patch(step.id, { method_of_verification: v })} rows={2} />
              </div>
            )
          })}
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
          disabled={saving || steps.length === 0}
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
