'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Sheet } from '@/components/ui/sheet'

interface Props {
  open:         boolean
  onClose:      () => void
  equipmentId:  string
  description:  string
  notes:        string
  onSaved:      (description: string, notes: string) => void
  onToast:      (msg: string, kind: 'success' | 'error') => void
}

export default function PlacardDetailsSheet({ open, onClose, equipmentId, description, notes, onSaved, onToast }: Props) {
  const [draftDesc, setDraftDesc]   = useState(description)
  const [draftNotes, setDraftNotes] = useState(notes)
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    if (!open) return
    setDraftDesc(description)
    setDraftNotes(notes)
  }, [open, description, notes])

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from('loto_equipment')
      .update({
        description: draftDesc.trim() || description,
        notes:       draftNotes.trim() || null,
        updated_at:  new Date().toISOString(),
      })
      .eq('equipment_id', equipmentId)

    if (error) {
      onToast('Could not save. Check your connection and try again.', 'error')
    } else {
      onSaved(draftDesc.trim() || description, draftNotes.trim())
      onToast('Changes saved.', 'success')
      onClose()
    }
    setSaving(false)
  }

  return (
    <Sheet open={open} onClose={() => !saving && onClose()} title="Edit Details" subtitle={equipmentId} widthClass="max-w-md">
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600" htmlFor="plc-desc">Description</label>
          <input
            id="plc-desc"
            type="text"
            value={draftDesc}
            onChange={e => setDraftDesc(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600" htmlFor="plc-notes">
            Notes <span className="text-slate-400 font-normal">(shown in red warning block)</span>
          </label>
          <textarea
            id="plc-notes"
            rows={4}
            value={draftNotes}
            onChange={e => setDraftNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
          />
        </div>
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
