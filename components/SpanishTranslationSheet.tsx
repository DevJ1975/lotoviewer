'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { energyCodeFor } from '@/lib/energyCodes'
import { Sheet } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'
import type { LotoEnergyStep } from '@/lib/types'

interface Props {
  open:         boolean
  onClose:      () => void
  equipmentId:  string
  notesEs:      string
  reviewed:     boolean
  steps:        LotoEnergyStep[]
  onSaved:      (notesEs: string, reviewed: boolean, steps: LotoEnergyStep[]) => void
  onToast:      (msg: string, kind: 'success' | 'error') => void
}

export default function SpanishTranslationSheet({
  open, onClose, equipmentId, notesEs, reviewed, steps, onSaved, onToast
}: Props) {
  const [draftNotes, setDraftNotes]     = useState(notesEs)
  const [draftReviewed, setDraftRev]    = useState(reviewed)
  const [draftSteps, setDraftSteps]     = useState<LotoEnergyStep[]>(steps)
  const [saving, setSaving]             = useState(false)

  // Reset drafts when sheet opens
  useEffect(() => {
    if (!open) return
    setDraftNotes(notesEs)
    setDraftRev(reviewed)
    setDraftSteps(steps.map(s => ({ ...s })))
  }, [open, notesEs, reviewed, steps])

  function patchStep(id: string, patch: Partial<LotoEnergyStep>) {
    setDraftSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  async function handleSave() {
    setSaving(true)

    const equipPromise = supabase
      .from('loto_equipment')
      .update({
        notes_es:         draftNotes || null,
        spanish_reviewed: draftReviewed,
        updated_at:       new Date().toISOString(),
      })
      .eq('equipment_id', equipmentId)

    const changedSteps = draftSteps.filter(d => {
      const o = steps.find(s => s.id === d.id)
      if (!o) return false
      return (
        o.tag_description_es        !== d.tag_description_es ||
        o.isolation_procedure_es    !== d.isolation_procedure_es ||
        o.method_of_verification_es !== d.method_of_verification_es
      )
    })

    const stepPromises = changedSteps.map(row =>
      supabase
        .from('loto_energy_steps')
        .update({
          tag_description_es:        row.tag_description_es,
          isolation_procedure_es:    row.isolation_procedure_es,
          method_of_verification_es: row.method_of_verification_es,
        })
        .eq('id', row.id)
    )

    const results = await Promise.all([equipPromise, ...stepPromises])
    const anyError = results.some(r => r.error)

    if (anyError) {
      onToast('Some Spanish fields failed to save.', 'error')
    } else {
      onSaved(draftNotes, draftReviewed, draftSteps)
      onToast('Spanish translations saved.', 'success')
      onClose()
    }
    setSaving(false)
  }

  return (
    <Sheet open={open} onClose={() => !saving && onClose()} title="Español — Translations" subtitle={equipmentId}>
      <div className="space-y-6">
        {/* Notes */}
        <div className="rounded-xl border border-slate-100 p-4 space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Notas (Spanish notes)</label>
            <textarea
              rows={3}
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
            />
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-50">
            <div>
              <p className="text-sm font-medium text-slate-700">Spanish Reviewed</p>
              <p className="text-xs text-slate-400">Mark when a bilingual reviewer has verified the translations.</p>
            </div>
            <Switch checked={draftReviewed} onChange={setDraftRev} ariaLabel="Spanish reviewed" />
          </div>
        </div>

        {/* Steps */}
        {draftSteps.map(step => {
          const { hex, textHex, labelEs } = energyCodeFor(step.energy_type)
          return (
            <div key={step.id} className="rounded-xl border border-slate-100 p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-50">
                <span
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-bold"
                  style={{ backgroundColor: hex, color: textHex }}
                >
                  <span className="font-mono">{step.energy_type}</span>
                  <span>{labelEs}</span>
                </span>
                <span className="text-sm font-semibold text-slate-700">Paso {step.step_number}</span>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Etiqueta y Descripción</label>
                <textarea
                  rows={2}
                  value={step.tag_description_es ?? ''}
                  placeholder={step.tag_description || 'Traducción al español…'}
                  aria-label="Etiqueta y Descripción"
                  onChange={e => patchStep(step.id, { tag_description_es: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Procedimiento de Aislamiento y Dispositivos de Bloqueo</label>
                <textarea
                  rows={3}
                  value={step.isolation_procedure_es ?? ''}
                  placeholder={step.isolation_procedure || 'Traducción al español…'}
                  aria-label="Procedimiento de Aislamiento"
                  onChange={e => patchStep(step.id, { isolation_procedure_es: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Método de Verificación</label>
                <textarea
                  rows={2}
                  value={step.method_of_verification_es ?? ''}
                  placeholder={step.method_of_verification || 'Traducción al español…'}
                  aria-label="Método de Verificación"
                  onChange={e => patchStep(step.id, { method_of_verification_es: e.target.value })}
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
          onClick={onClose}
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
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Sheet>
  )
}
