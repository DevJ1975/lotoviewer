'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { useDebounce } from '@/hooks/useDebounce'
import { useFormDraft } from '@/hooks/useFormDraft'

interface Props {
  equipment: Equipment[]
  onClose:   () => void
  onAdded:   (row: Equipment) => void
}

interface DraftState {
  equipmentId: string
  description: string
  department:  string
  prefix:      string
  // True if the user explicitly edited prefix — persisted so restoring
  // a draft doesn't let the auto-derive useEffect overwrite the user's
  // intent on re-open.
  prefixDirty: boolean
  needsEquip:  boolean
  needsIso:    boolean
  notes:       string
}

const DEFAULT_DRAFT: DraftState = {
  equipmentId: '', description: '', department: '', prefix: '',
  prefixDirty: false, needsEquip: true, needsIso: true, notes: '',
}

const DRAFT_KEY = 'loto:addEquipmentDraft'

function derivePrefix(equipmentId: string): string {
  return equipmentId.includes('-') ? equipmentId.split('-')[0] : equipmentId
}

function draftHasContent(d: DraftState): boolean {
  // Used to decide whether the "Restored your draft" banner is worth
  // showing. An all-defaults draft technically restores but isn't
  // anything the user would notice losing.
  return d.equipmentId.trim() !== ''
      || d.description.trim() !== ''
      || d.department.trim() !== ''
      || d.notes.trim() !== ''
      || d.prefixDirty
}

export default function AddEquipmentDialog({ equipment, onClose, onAdded }: Props) {
  const [draft, setDraft, clearDraft, wasRestored] =
    useFormDraft<DraftState>(DRAFT_KEY, DEFAULT_DRAFT)

  const [submitting,  setSubmitting]  = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [draftDismissed, setDraftDismissed] = useState(false)

  const showDraftBanner = wasRestored && draftHasContent(draft) && !draftDismissed

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
  const debouncedId = useDebounce(draft.equipmentId.trim(), 300)
  const duplicate   = debouncedId.length > 0 && existingIds.has(debouncedId)

  // Auto-derive prefix from equipment_id unless the user has edited it
  useEffect(() => {
    if (draft.prefixDirty) return
    const derived = derivePrefix(draft.equipmentId.trim())
    if (derived !== draft.prefix) {
      setDraft(d => ({ ...d, prefix: derived }))
    }
  }, [draft.equipmentId, draft.prefixDirty, draft.prefix, setDraft])

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  const trimmedId     = draft.equipmentId.trim()
  const trimmedDesc   = draft.description.trim()
  const trimmedDept   = draft.department.trim()
  const trimmedPrefix = draft.prefix.trim() || derivePrefix(trimmedId)

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
      needs_equip_photo:  draft.needsEquip,
      needs_iso_photo:    draft.needsIso,
      notes:              draft.notes.trim() || null,
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

    // Successful save — drop the draft so reopening the dialog starts
    // fresh. Submission is the only action that should auto-clear the
    // draft; cancel/Esc intentionally keeps it so accidental dismissals
    // are recoverable.
    clearDraft()
    onAdded(data as Equipment)
    onClose()
  }, [canSubmit, trimmedId, trimmedDesc, trimmedDept, trimmedPrefix, draft, clearDraft, onAdded, onClose])

  const handleStartOver = useCallback(() => {
    clearDraft()
    setDraftDismissed(true)
    setServerError(null)
  }, [clearDraft])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget && !submitting) onClose() }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add Equipment</h2>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">A blank placard will be created.</p>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors text-xl leading-none disabled:opacity-40"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {showDraftBanner && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 px-3 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 text-amber-900 dark:text-amber-100 text-xs rounded-lg"
            >
              <span>We restored your unsaved draft from earlier.</span>
              <button
                type="button"
                onClick={handleStartOver}
                disabled={submitting}
                className="font-semibold uppercase tracking-wider text-[11px] text-amber-800 dark:text-amber-200 hover:text-amber-950 transition-colors disabled:opacity-50"
              >
                Start over
              </button>
            </div>
          )}

          {/* Equipment ID */}
          <Field label="Equipment ID" required>
            <input
              type="text"
              value={draft.equipmentId}
              onChange={e => {
                const v = e.target.value
                setDraft(d => ({ ...d, equipmentId: v }))
                setServerError(null)
              }}
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
              value={draft.description}
              onChange={e => {
                const v = e.target.value
                setDraft(d => ({ ...d, description: v }))
              }}
              disabled={submitting}
              placeholder="Full machine description"
              className={inputCls(false)}
            />
          </Field>

          {/* Department */}
          <Field label="Department" required>
            <input
              type="text"
              value={draft.department}
              onChange={e => {
                const v = e.target.value
                setDraft(d => ({ ...d, department: v }))
              }}
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
              value={draft.prefix}
              onChange={e => {
                const v = e.target.value
                setDraft(d => ({ ...d, prefix: v, prefixDirty: true }))
              }}
              disabled={submitting}
              placeholder="Auto-derived from Equipment ID"
              className={inputCls(false)}
            />
          </Field>

          {/* Toggles */}
          <div className="grid grid-cols-2 gap-3">
            <Toggle
              label="Needs Equipment Photo"
              checked={draft.needsEquip}
              onChange={v => setDraft(d => ({ ...d, needsEquip: v }))}
              disabled={submitting}
            />
            <Toggle
              label="Needs Isolation Photo"
              checked={draft.needsIso}
              onChange={v => setDraft(d => ({ ...d, needsIso: v }))}
              disabled={submitting}
            />
          </div>

          {/* Notes */}
          <Field label="Notes">
            <textarea
              value={draft.notes}
              onChange={e => {
                const v = e.target.value
                setDraft(d => ({ ...d, notes: v }))
              }}
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
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200 transition-colors disabled:opacity-40"
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
  const base = 'w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 transition-colors disabled:bg-slate-50 dark:disabled:bg-slate-900/40 disabled:text-slate-500 dark:disabled:text-slate-400'
  return invalid
    ? `${base} border-rose-300 focus:ring-rose-200 focus:border-rose-400`
    : `${base} border-slate-200 dark:border-slate-700 focus:ring-brand-navy/20 focus:border-brand-navy`
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
    </div>
  )
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 font-medium select-none ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy/20"
      />
      {label}
    </label>
  )
}
