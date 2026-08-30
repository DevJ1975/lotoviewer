'use client'

import {
  GHS_PICTOGRAMS,
  GHS_PICTOGRAM_LABEL,
  GHS_SIGNAL_WORDS,
  type GhsPictogram,
  type GhsSignalWord,
} from '@soteria/core/chemicals'
import {
  DOT_HAZARD_CLASSES,
  DOT_HAZARD_CLASS_META,
  DOT_PACKING_GROUPS,
  NFPA_SPECIAL_SYMBOLS,
  type DotHazardClass,
  type DotPackingGroup,
} from '@soteria/core/hazardSymbols'

// Controlled form controls for a waste stream's hazard-communication
// symbols (migration 239). Pure presentation: the parent owns the value and
// the setters, so the same fieldset drives both the create form and the
// detail-page edit panel. Styling mirrors the surrounding stream form
// (Field wrapper + inputCls) so it reads as one coherent surface.

export interface HazardSymbolValue {
  ghsPictograms:        GhsPictogram[]
  ghsSignalWord:        GhsSignalWord | ''
  nfpaHealth:           string
  nfpaFlammability:     string
  nfpaInstability:      string
  nfpaSpecial:          string
  dotUnNumber:          string
  dotHazardClass:       DotHazardClass | ''
  dotPackingGroup:      DotPackingGroup | ''
  dotProperShippingName: string
}

export const EMPTY_HAZARD_SYMBOLS: HazardSymbolValue = {
  ghsPictograms:        [],
  ghsSignalWord:        '',
  nfpaHealth:           '',
  nfpaFlammability:     '',
  nfpaInstability:      '',
  nfpaSpecial:          '',
  dotUnNumber:          '',
  dotHazardClass:       '',
  dotPackingGroup:      '',
  dotProperShippingName: '',
}

const NFPA_RATINGS = ['0', '1', '2', '3', '4'] as const

// Shape the API accepts for the symbol fields. Numbers/null for NFPA, arrays
// and nullable strings everywhere else — the route re-validates against the
// catalog, so this only needs to produce the right primitive types.
export interface HazardSymbolBody {
  ghs_pictograms:           GhsPictogram[]
  ghs_signal_word:          GhsSignalWord | null
  nfpa_health:              number | null
  nfpa_flammability:        number | null
  nfpa_instability:         number | null
  nfpa_special:             string | null
  dot_un_number:            string | null
  dot_hazard_class:         string | null
  dot_packing_group:        DotPackingGroup | null
  dot_proper_shipping_name: string | null
}

function ratingToNumber(value: string): number | null {
  return value === '' ? null : Number(value)
}

function trimToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Convert the controlled form value into the API request body. */
export function hazardSymbolsToBody(value: HazardSymbolValue): HazardSymbolBody {
  return {
    ghs_pictograms:           value.ghsPictograms,
    ghs_signal_word:          value.ghsSignalWord || null,
    nfpa_health:              ratingToNumber(value.nfpaHealth),
    nfpa_flammability:        ratingToNumber(value.nfpaFlammability),
    nfpa_instability:         ratingToNumber(value.nfpaInstability),
    nfpa_special:             value.nfpaSpecial || null,
    dot_un_number:            trimToNull(value.dotUnNumber),
    dot_hazard_class:         value.dotHazardClass || null,
    dot_packing_group:        value.dotPackingGroup || null,
    dot_proper_shipping_name: trimToNull(value.dotProperShippingName),
  }
}

interface StreamSymbolSource {
  ghs_pictograms:           string[] | null
  ghs_signal_word:          string | null
  nfpa_health:              number | null
  nfpa_flammability:        number | null
  nfpa_instability:         number | null
  nfpa_special:             string | null
  dot_un_number:            string | null
  dot_hazard_class:         string | null
  dot_packing_group:        string | null
  dot_proper_shipping_name: string | null
}

/** Hydrate the controlled form value from a persisted stream row. */
export function hazardSymbolsFromStream(stream: StreamSymbolSource): HazardSymbolValue {
  const knownPictograms = (stream.ghs_pictograms ?? [])
    .filter((code): code is GhsPictogram => (GHS_PICTOGRAMS as readonly string[]).includes(code))
  return {
    ghsPictograms:        knownPictograms,
    ghsSignalWord:        stream.ghs_signal_word === 'danger' || stream.ghs_signal_word === 'warning'
      ? stream.ghs_signal_word : '',
    nfpaHealth:           stream.nfpa_health === null ? '' : String(stream.nfpa_health),
    nfpaFlammability:     stream.nfpa_flammability === null ? '' : String(stream.nfpa_flammability),
    nfpaInstability:      stream.nfpa_instability === null ? '' : String(stream.nfpa_instability),
    nfpaSpecial:          stream.nfpa_special ?? '',
    dotUnNumber:          stream.dot_un_number ?? '',
    dotHazardClass:       (DOT_HAZARD_CLASSES as readonly string[]).includes(stream.dot_hazard_class ?? '')
      ? (stream.dot_hazard_class as DotHazardClass) : '',
    dotPackingGroup:      (DOT_PACKING_GROUPS as readonly string[]).includes(stream.dot_packing_group ?? '')
      ? (stream.dot_packing_group as DotPackingGroup) : '',
    dotProperShippingName: stream.dot_proper_shipping_name ?? '',
  }
}

interface Props {
  value:    HazardSymbolValue
  onChange: (next: HazardSymbolValue) => void
  /** Disable every control while a save is in flight. */
  disabled?: boolean
}

export function HazardSymbolFields({ value, onChange, disabled = false }: Props) {
  function set<K extends keyof HazardSymbolValue>(key: K, next: HazardSymbolValue[K]) {
    onChange({ ...value, [key]: next })
  }

  function togglePictogram(code: GhsPictogram) {
    const next = value.ghsPictograms.includes(code)
      ? value.ghsPictograms.filter(c => c !== code)
      : [...value.ghsPictograms, code]
    set('ghsPictograms', next)
  }

  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      <Field label="GHS pictograms" hint="Mark every hazard pictogram that applies (40 CFR 262.32 container marking)">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {GHS_PICTOGRAMS.map(code => {
            const checked = value.ghsPictograms.includes(code)
            return (
              <label
                key={code}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer ${
                  checked
                    ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                    : 'border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePictogram(code)}
                  className="h-4 w-4"
                />
                <span className="text-slate-800 dark:text-slate-200">
                  <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{code}</span>{' '}
                  {GHS_PICTOGRAM_LABEL[code]}
                </span>
              </label>
            )
          })}
        </div>
      </Field>

      <Field label="GHS signal word">
        <select
          value={value.ghsSignalWord}
          onChange={e => set('ghsSignalWord', e.target.value as GhsSignalWord | '')}
          className={inputCls}
        >
          <option value="">(none)</option>
          {GHS_SIGNAL_WORDS.map(word => (
            <option key={word} value={word}>{word}</option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <NfpaSelect label="NFPA health"       value={value.nfpaHealth}       onChange={v => set('nfpaHealth', v)} />
        <NfpaSelect label="NFPA flammability" value={value.nfpaFlammability} onChange={v => set('nfpaFlammability', v)} />
        <NfpaSelect label="NFPA instability"  value={value.nfpaInstability}  onChange={v => set('nfpaInstability', v)} />
        <Field label="NFPA special">
          <select
            value={value.nfpaSpecial}
            onChange={e => set('nfpaSpecial', e.target.value)}
            className={inputCls}
          >
            <option value="">(none)</option>
            {NFPA_SPECIAL_SYMBOLS.map(symbol => (
              <option key={symbol} value={symbol}>{symbol}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="DOT hazard class">
          <select
            value={value.dotHazardClass}
            onChange={e => set('dotHazardClass', e.target.value as DotHazardClass | '')}
            className={inputCls}
          >
            <option value="">(none)</option>
            {DOT_HAZARD_CLASSES.map(cls => (
              <option key={cls} value={cls}>
                {cls} — {DOT_HAZARD_CLASS_META[cls].labelName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="DOT packing group">
          <select
            value={value.dotPackingGroup}
            onChange={e => set('dotPackingGroup', e.target.value as DotPackingGroup | '')}
            className={inputCls}
          >
            <option value="">(none)</option>
            {DOT_PACKING_GROUPS.map(pg => (
              <option key={pg} value={pg}>PG {pg}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="UN number" hint="e.g. UN1993">
          <input
            value={value.dotUnNumber}
            onChange={e => set('dotUnNumber', e.target.value)}
            maxLength={16}
            className={inputCls}
          />
        </Field>
        <Field label="Proper shipping name" hint="DOT name for the uniform manifest (49 CFR 172.101)">
          <input
            value={value.dotProperShippingName}
            onChange={e => set('dotProperShippingName', e.target.value)}
            maxLength={300}
            className={inputCls}
          />
        </Field>
      </div>
    </fieldset>
  )
}

function NfpaSelect({
  label, value, onChange,
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls}>
        <option value="">–</option>
        {NFPA_RATINGS.map(rating => (
          <option key={rating} value={rating}>{rating}</option>
        ))}
      </select>
    </Field>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}
