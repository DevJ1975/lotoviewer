'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Sheet } from '@/components/ui/sheet'
import type { Equipment } from '@soteria/core/types'
import { isOffline, OFFLINE_WRITE_MESSAGE } from '@/lib/netGuard'
import { useTenant } from '@/components/TenantProvider'

type PlacardPatch = {
  description:    string
  notes:          string | null
  internal_notes: string | null
  manufacturer:   string | null
  model:          string | null
}

interface Props {
  open:         boolean
  onClose:      () => void
  equipment:    Equipment
  onSaved:      (patch: PlacardPatch) => void
  onToast:      (msg: string, kind: 'success' | 'error') => void
}

export default function PlacardDetailsSheet({ open, onClose, equipment, onSaved, onToast }: Props) {
  const { tenantId } = useTenant()
  const equipmentId   = equipment.equipment_id
  const description   = equipment.description
  const notes         = equipment.notes ?? ''
  const internalNotes = equipment.internal_notes ?? ''
  const manufacturer  = equipment.manufacturer ?? ''
  const model         = equipment.model ?? ''
  const [draftDesc, setDraftDesc]                   = useState(description)
  const [draftNotes, setDraftNotes]                 = useState(notes)
  const [draftInternalNotes, setDraftInternalNotes] = useState(internalNotes)
  const [draftMfr, setDraftMfr]                     = useState(manufacturer)
  const [draftModel, setDraftModel]                 = useState(model)
  const [saving, setSaving]                         = useState(false)

  useEffect(() => {
    if (!open) return
    setDraftDesc(description)
    setDraftNotes(notes)
    setDraftInternalNotes(internalNotes)
    setDraftMfr(manufacturer)
    setDraftModel(model)
  }, [open, description, notes, internalNotes, manufacturer, model])

  async function handleSave() {
    if (isOffline()) {
      onToast(OFFLINE_WRITE_MESSAGE, 'error')
      return
    }
    if (!tenantId) {
      onToast('No active tenant selected.', 'error')
      return
    }
    setSaving(true)
    const patch: PlacardPatch = {
      description:    draftDesc.trim() || description,
      notes:          draftNotes.trim() || null,
      internal_notes: draftInternalNotes.trim() || null,
      manufacturer:   draftMfr.trim()   || null,
      model:          draftModel.trim() || null,
    }
    const { error } = await supabase
      .from('loto_equipment')
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('equipment_id', equipmentId)

    if (error) {
      onToast('Could not save. Check your connection and try again.', 'error')
    } else {
      onSaved(patch)
      onToast('Changes saved.', 'success')
      onClose()
    }
    setSaving(false)
  }

  return (
    <Sheet open={open} onClose={() => !saving && onClose()} title="Edit Details" subtitle={equipmentId} widthClass="max-w-md">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="plc-desc">Description</label>
          <input
            id="plc-desc"
            type="text"
            value={draftDesc}
            onChange={e => setDraftDesc(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="plc-mfr">
              Manufacturer <span className="text-slate-400 dark:text-slate-500 font-normal">(OEM)</span>
            </label>
            <input
              id="plc-mfr"
              type="text"
              value={draftMfr}
              onChange={e => setDraftMfr(e.target.value)}
              placeholder="e.g. Jensen, SKA Pack"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="plc-model">Model</label>
            <input
              id="plc-model"
              type="text"
              value={draftModel}
              onChange={e => setDraftModel(e.target.value)}
              placeholder="e.g. SKAP-2400, J-3000"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="plc-notes">
            Notes <span className="text-slate-400 dark:text-slate-500 font-normal">(shown in red warning block)</span>
          </label>
          <textarea
            id="plc-notes"
            rows={4}
            value={draftNotes}
            onChange={e => setDraftNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor="plc-internal-notes">
            Internal notes <span className="text-slate-400 dark:text-slate-500 font-normal">(private — never printed on the placard)</span>
          </label>
          <textarea
            id="plc-internal-notes"
            rows={4}
            value={draftInternalNotes}
            onChange={e => setDraftInternalNotes(e.target.value)}
            placeholder="Visible to staff in the app only. Won't appear on the PDF or printed placard."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="sticky bottom-0 bg-white dark:bg-slate-900 pt-4 mt-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
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
