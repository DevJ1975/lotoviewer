'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { energyCodeFor } from '@/lib/energyCodes'
import type { LotoEnergyStep } from '@/lib/types'
import { Sheet } from '@/components/ui/sheet'

interface Props {
  equipmentId: string
  steps:       LotoEnergyStep[]
  onChange:    (updated: LotoEnergyStep[]) => void
  onToast:     (msg: string, kind: 'success' | 'error') => void
}

function EnergyBadge({ code }: { code: string }) {
  const { hex, textHex, labelEn } = energyCodeFor(code)
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold shrink-0"
      style={{ backgroundColor: hex, color: textHex }}
      title={labelEn}
    >
      <span className="font-mono">{code}</span>
      <span className="font-semibold">{labelEn}</span>
    </span>
  )
}

export default function EnergyStepsSection({ equipmentId, steps, onChange, onToast }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState<LotoEnergyStep[]>(steps)
  const [saving,  setSaving]  = useState(false)

  function openEditor() {
    setDraft(steps.map(s => ({ ...s })))
    setEditing(true)
  }

  function patchDraft(id: string, patch: Partial<LotoEnergyStep>) {
    setDraft(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  async function handleSave() {
    setSaving(true)
    const changed = draft.filter(d => {
      const original = steps.find(s => s.id === d.id)
      if (!original) return false
      return (
        original.tag_description        !== d.tag_description ||
        original.isolation_procedure    !== d.isolation_procedure ||
        original.method_of_verification !== d.method_of_verification
      )
    })

    if (changed.length === 0) {
      setEditing(false)
      setSaving(false)
      return
    }

    const results = await Promise.all(changed.map(row =>
      supabase
        .from('loto_energy_steps')
        .update({
          tag_description:        row.tag_description,
          isolation_procedure:    row.isolation_procedure,
          method_of_verification: row.method_of_verification,
        })
        .eq('id', row.id)
    ))

    const anyError = results.some(r => r.error)
    if (anyError) {
      onToast('Some steps failed to save.', 'error')
    } else {
      onChange(draft)
      onToast(`Saved ${changed.length} step${changed.length === 1 ? '' : 's'}.`, 'success')
      setEditing(false)
    }
    setSaving(false)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Energy Steps</h2>
        <button
          type="button"
          onClick={openEditor}
          disabled={steps.length === 0}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors"
        >
          ✎ Edit Steps
        </button>
      </div>

      {steps.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No energy steps defined for this equipment.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-2 pr-4 w-1/3">Energy Tag &amp; Description</th>
                <th className="py-2 pr-4 w-1/3">Isolation Procedure &amp; Lockout Devices</th>
                <th className="py-2 w-1/3">Method of Verification</th>
              </tr>
            </thead>
            <tbody>
              {steps.map(step => (
                <tr key={step.id} className="border-b border-slate-50 last:border-0 align-top">
                  <td className="py-3 pr-4">
                    <div className="flex items-start gap-2">
                      <EnergyBadge code={step.energy_type} />
                      <span className="text-[11px] text-slate-400 font-mono pt-0.5">#{step.step_number}</span>
                    </div>
                    <p className="mt-1.5 text-[13px] text-slate-700 whitespace-pre-wrap">{step.tag_description || '—'}</p>
                  </td>
                  <td className="py-3 pr-4 text-[13px] text-slate-700 whitespace-pre-wrap">{step.isolation_procedure || '—'}</td>
                  <td className="py-3 text-[13px] text-slate-700 whitespace-pre-wrap">{step.method_of_verification || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={editing} onClose={() => !saving && setEditing(false)} title="Edit Energy Steps" subtitle={equipmentId}>
        <div className="space-y-6">
          {draft.map(step => {
            const { labelEn } = energyCodeFor(step.energy_type)
            return (
              <div key={step.id} className="rounded-xl border border-slate-100 p-4 space-y-3">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-50">
                  <EnergyBadge code={step.energy_type} />
                  <span className="text-sm font-semibold text-slate-700">Step {step.step_number}</span>
                  <span className="text-xs text-slate-400 ml-auto">{labelEn}</span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Tag &amp; Description</label>
                  <textarea
                    rows={2}
                    value={step.tag_description ?? ''}
                    onChange={e => patchDraft(step.id, { tag_description: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Isolation Procedure &amp; Lockout Devices</label>
                  <textarea
                    rows={3}
                    value={step.isolation_procedure ?? ''}
                    onChange={e => patchDraft(step.id, { isolation_procedure: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Method of Verification</label>
                  <textarea
                    rows={2}
                    value={step.method_of_verification ?? ''}
                    onChange={e => patchDraft(step.id, { method_of_verification: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div className="sticky bottom-0 bg-white pt-4 mt-6 border-t border-slate-100 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </Sheet>
    </div>
  )
}
