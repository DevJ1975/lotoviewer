'use client'

import type { ReactNode } from 'react'
import type { FieldError } from '@soteria/core/hazardousWaste'
import {
  MANIFEST_FORM_API_FIELD, splitWasteCodes, type ManifestFormValues,
} from '@/lib/hazardousWasteManifestView'

// The fields of a manifest, shared by "New manifest" and "Edit draft". Every control has a label
// that is its accessible name; hints and errors are tied to it with aria-describedby, so a
// screen reader reads the problem with the field.

const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/60 aria-[invalid=true]:border-red-500'

interface Props {
  idPrefix:    string
  values:      ManifestFormValues
  onChange:    (values: ManifestFormValues) => void
  fieldErrors: FieldError[]
  disabled?:   boolean
}

export function ManifestFieldsForm({ idPrefix, values, onChange, fieldErrors, disabled = false }: Props) {
  const set = <K extends keyof ManifestFormValues>(key: K, value: ManifestFormValues[K]) => onChange({ ...values, [key]: value })
  // The rules and the state code both report as `jurisdiction`; with a state chosen the error belongs under the code.
  const errorsFor = (key: keyof ManifestFormValues) =>
    key === 'jurisdictionKind' && values.jurisdictionKind === 'state' ? [] : fieldErrors.filter(e => e.field === MANIFEST_FORM_API_FIELD[key])
  const codeCount = splitWasteCodes(values.wasteCodes).length

  const field = (key: keyof ManifestFormValues, label: string, control: (props: ControlProps) => ReactNode, hint?: string) => {
    const id = `${idPrefix}-${key}`
    const errors = errorsFor(key)
    const describedBy = [hint ? `${id}-hint` : null, errors.length > 0 ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</label>
        {control({ id, describedBy, invalid: errors.length > 0, disabled })}
        {hint && <p id={`${id}-hint`} className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
        {errors.length > 0 && (
          <p id={`${id}-error`} className="text-[11px] font-medium text-red-700 dark:text-red-300">{errors.map(e => e.message).join('. ')}</p>
        )}
      </div>
    )
  }

  const textInput = (
    { id, describedBy, invalid, disabled: off }: ControlProps,
    key: 'trackingNumber' | 'generatorEpaId' | 'transporterName' | 'transporterEpaId' | 'tsdfName' | 'tsdfEpaId' | 'wasteCodes',
    maxLength: number,
    placeholder?: string,
  ) => (
    <input
      id={id} value={values[key]} onChange={e => set(key, e.target.value)} maxLength={maxLength} placeholder={placeholder}
      aria-describedby={describedBy} aria-invalid={invalid} disabled={off} className={inputCls} autoComplete="off"
    />
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('generatorCategory', 'Generator category *', ({ id, describedBy, invalid, disabled: off }) => (
          <select
            id={id} value={values.generatorCategory} required aria-describedby={describedBy} aria-invalid={invalid} disabled={off} className={inputCls}
            onChange={e => set('generatorCategory', e.target.value as ManifestFormValues['generatorCategory'])}
          >
            <option value="">Choose…</option>
            <option value="lqg">LQG: large quantity generator</option>
            <option value="sqg">SQG: small quantity generator</option>
            <option value="vsqg">VSQG: very small quantity generator</option>
          </select>
        ), 'The category the site shipped under on this date. It sets the return clock and is not recomputed later.')}

        {field('jurisdictionKind', 'Rules that apply', ({ id, describedBy, invalid, disabled: off }) => (
          <select
            id={id} value={values.jurisdictionKind} aria-describedby={describedBy} aria-invalid={invalid} disabled={off} className={inputCls}
            onChange={e => set('jurisdictionKind', e.target.value as ManifestFormValues['jurisdictionKind'])}
          >
            <option value="federal">Federal (40 CFR)</option>
            <option value="state">A state&apos;s rules</option>
          </select>
        ), 'California holds a very small quantity generator to the small quantity rules.')}
      </div>

      {values.jurisdictionKind === 'state' && (
        <div className="max-w-[12rem]">
          {field('stateCode', 'State (two letters)', ({ id, describedBy, invalid, disabled: off }) => (
            <input
              id={id} value={values.stateCode} maxLength={2} placeholder="CA" aria-describedby={describedBy} aria-invalid={invalid}
              disabled={off} className={`${inputCls} uppercase`} autoComplete="off"
              onChange={e => set('stateCode', e.target.value.toUpperCase())}
            />
          ))}
        </div>
      )}

      {field('trackingNumber', 'Manifest tracking number', control => textInput(control, 'trackingNumber', 12, '123456789ELC'),
        'Nine digits and three letters, from the paper form or e-Manifest. It is needed before the manifest can ship.')}

      <div className="max-w-sm">
        {field('generatorEpaId', 'Generator EPA ID', control => textInput(control, 'generatorEpaId', 12, 'CAL000123456'), 'Three letters and nine digits.')}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {field('transporterName', 'Transporter name', control => textInput(control, 'transporterName', 200))}
        {field('transporterEpaId', 'Transporter EPA ID', control => textInput(control, 'transporterEpaId', 12))}
        {field('tsdfName', 'Receiving facility name', control => textInput(control, 'tsdfName', 200))}
        {field('tsdfEpaId', 'Receiving facility EPA ID', control => textInput(control, 'tsdfEpaId', 12))}
      </div>

      {field('wasteCodes', 'Waste codes', control => textInput(control, 'wasteCodes', 1000, 'D001, F003, 134'),
        `Separate with commas. Federal (D001), California (134) or Texas (0001101H). ${codeCount} listed.`)}

      {field('dotDescription', 'Shipping description', ({ id, describedBy, invalid, disabled: off }) => (
        <textarea
          id={id} value={values.dotDescription} onChange={e => set('dotDescription', e.target.value)} rows={2} maxLength={1000}
          aria-describedby={describedBy} aria-invalid={invalid} disabled={off} className={inputCls}
        />
      ), 'As printed on the manifest, e.g. UN1993, Waste Flammable liquids, n.o.s., 3, PG II.')}

      <div className="flex items-center gap-2">
        <input
          id={`${idPrefix}-electronic`} type="checkbox" checked={values.electronic} disabled={disabled}
          onChange={e => set('electronic', e.target.checked)} className="h-4 w-4 rounded border-slate-300"
        />
        <label htmlFor={`${idPrefix}-electronic`} className="text-sm text-slate-800 dark:text-slate-200">Submitted through EPA e-Manifest</label>
      </div>

      {field('notes', 'Notes', ({ id, describedBy, invalid, disabled: off }) => (
        <textarea
          id={id} value={values.notes} onChange={e => set('notes', e.target.value)} rows={3} maxLength={2000}
          aria-describedby={describedBy} aria-invalid={invalid} disabled={off} className={inputCls}
        />
      ))}
    </div>
  )
}

interface ControlProps { id: string; describedBy: string | undefined; invalid: boolean; disabled: boolean }
