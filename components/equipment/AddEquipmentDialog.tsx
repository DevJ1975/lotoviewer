'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { useDebounce } from '@/hooks/useDebounce'

interface Props {
  equipment: Equipment[]
  onClose:   () => void
  onAdded:   (row: Equipment) => void
}

function derivePrefix(equipmentId: string): string {
  return equipmentId.includes('-') ? equipmentId.split('-')[0] : equipmentId
}

export default function AddEquipmentDialog({ equipment, onClose, onAdded }: Props) {
  const [equipmentId,  setEquipmentId]  = useState('')
  const [description,  setDescription]  = useState('')
  const [department,   setDepartment]   = useState('')
  const [prefix,       setPrefix]       = useState('')
  const [prefixDirty,  setPrefixDirty]  = useState(false)
  const [needsEquip,   setNeedsEquip]   = useState(true)
  const [needsIso,     setNeedsIso]     = useState(true)
  const [notes,        setNotes]        = useState('')
  const [submitting,   setSubmitting]   = useState(false)
  const [serverError,  setServerError]  = useState<string | null>(null)

  const existingIds = useMemo(
    () => new Set(equipment.map(e => e.equipment_id)),
    [equipment],
  )
  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const eq of equipment) set.add(eq.department)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [equipment])

  // Debounced uniqueness check for inline error display
  const debouncedId = useDebounce(equipmentId.trim(), 300)
  const duplicate   = debouncedId.length > 0 && existingIds.has(debouncedId)

  // Auto-derive prefix from equipment_id unless the user has edited it
  useEffect(() => {
    if (!prefixDirty) setPrefix(derivePrefix(equipmentId.trim()))
  }, [equipmentId, prefixDirty])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  const trimmedId   = equipmentId.trim()
  const trimmedDesc = description.trim()
  const trimmedDept = department.trim()
  const trimmedPrefix = prefix.trim() || derivePrefix(trimmedId)

  const canSubmit =
    trimmedId.length > 0 &&
    !existingIds.has(trimmedId) &&
    trimmedDesc.length > 0 &&
    trimmedDept.length > 0 &&
    !submitting

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setServerError(null)

    const payload = {
      equipment_id:       trimmedId,
      description:        trimmedDesc,
      department:         trimmedDept,
      prefix:             trimmedPrefix,
      needs_equip_photo:  needsEquip,
      needs_iso_photo:    needsIso,
      notes:              notes.trim() || null,
      has_equip_photo:    false,
      has_iso_photo:      false,
      photo_status:       'missing' as const,
      needs_verification: false,
      verified:           false,
      spanish_reviewed:   false,
    }

    const { data, error } = await supabase
      .from('loto_equipment')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      setServerError(error.message)
      setSubmitting(false)
      return
    }

    onAdded(data as Equipment)
    onClose()
  }, [canSubmit, trimmedId, trimmedDesc, trimmedDept, trimmedPrefix, needsEquip, needsIso, notes, onAdded, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget && !submitting) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add Equipment</h2>
            <p className="text-xs text-slate-400 mt-0.5">A blank placard will be created.</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Equipment ID */}
          <Field label="Equipment ID" required>
            <input
              type="text"
              value={equipmentId}
              onChange={e => { setEquipmentId(e.target.value); setServerError(null) }}
              disabled={submitting}
              autoFocus
              placeholder="e.g. 321-MX-01"
              className={inputCls(duplicate)}
            />
            {duplicate && (
              <p className="text-[11px] text-rose-500 mt-1">
                An equipment with this ID already exists.
              </p>
            )}
          </Field>

          {/* Description */}
          <Field label="Description" required>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={submitting}
              placeholder="Full machine description"
              className={inputCls(false)}
            />
          </Field>

          {/* Department */}
          <Field label="Department" required>
            <input
              type="text"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              list="dept-suggestions"
              disabled={submitting}
              placeholder="Type or pick a department"
              className={inputCls(false)}
            />
            <datalist id="dept-suggestions">
              {departments.map(d => <option key={d} value={d} />)}
            </datalist>
          </Field>

          {/* Prefix */}
          <Field label="Prefix">
            <input
              type="text"
              value={prefix}
              onChange={e => { setPrefix(e.target.value); setPrefixDirty(true) }}
              disabled={submitting}
              placeholder="Auto-derived from Equipment ID"
              className={inputCls(false)}
            />
          </Field>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-3">
            <Toggle
              label="Needs Equipment Photo"
              checked={needsEquip}
              onChange={setNeedsEquip}
              disabled={submitting}
            />
            <Toggle
              label="Needs Isolation Photo"
              checked={needsIso}
              onChange={setNeedsIso}
              disabled={submitting}
            />
          </div>

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={submitting}
              rows={2}
              placeholder="Optional"
              className={`${inputCls(false)} resize-none`}
            />
          </Field>

          {serverError && (
            <p className="text-sm text-rose-500 font-medium">{serverError}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center gap-3 justify-end">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function inputCls(invalid: boolean): string {
  const base = 'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors disabled:bg-slate-50 disabled:text-slate-500'
  return invalid
    ? `${base} border-rose-300 focus:ring-rose-200 focus:border-rose-400`
    : `${base} border-slate-200 focus:ring-brand-navy/20 focus:border-brand-navy`
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600 block">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-xs text-slate-700 font-medium select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy/20"
      />
      {label}
    </label>
  )
}
