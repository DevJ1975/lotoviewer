'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Loader2, Sparkles, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  parseToProductFields,
  type ParsedSdsPayload,
  type ParseConfidence,
  type ProductFieldsFromParse,
} from '@soteria/core/chemicals'
import { PictogramBadges, SignalWordBadge } from '../_components/PictogramBadges'

interface PendingRow {
  id:               string
  product_id:       string
  revision_date:    string | null
  parse_model:      string | null
  parse_confidence: number | null
  parsed_payload:   ParsedSdsPayload | null
  created_at:       string
  chemical_products: {
    id:              string
    name:            string
    manufacturer:    string | null
    ghs_signal_word: string | null
    ghs_pictograms:  string[] | null
  } | null
}

type FieldKey = keyof ProductFieldsFromParse

// Order to render the proposed-field rows. Matches the SDS section flow
// (1 → 16) so reviewers move top-to-bottom in regulatory order.
const FIELD_ORDER: FieldKey[] = [
  'name', 'manufacturer', 'product_code',
  'cas_numbers', 'synonyms',
  'physical_state',
  'ghs_pictograms', 'ghs_signal_word',
  'hazard_statements', 'precautionary_statements',
  'nfpa_health', 'nfpa_flammability', 'nfpa_instability', 'nfpa_special',
  'ppe_required',
  'flash_point_c', 'boiling_point_c', 'vapor_pressure_kpa',
  'pel_twa_ppm', 'stel_ppm', 'idlh_ppm',
  'first_aid', 'firefighting', 'spill_cleanup',
  'storage_class', 'incompatibilities',
  'dot_un_number', 'dot_hazard_class', 'dot_packing_group',
  'sds_revision_date',
]

const FIELD_LABEL: Record<FieldKey, string> = {
  name: 'Product name',
  manufacturer: 'Manufacturer',
  product_code: 'Product code',
  cas_numbers: 'CAS numbers',
  synonyms: 'Synonyms',
  physical_state: 'Physical state',
  ghs_pictograms: 'GHS pictograms',
  ghs_signal_word: 'GHS signal word',
  hazard_statements: 'Hazard statements (H-codes)',
  precautionary_statements: 'Precautionary statements (P-codes)',
  nfpa_health: 'NFPA Health',
  nfpa_flammability: 'NFPA Flammability',
  nfpa_instability: 'NFPA Instability',
  nfpa_special: 'NFPA Special',
  ppe_required: 'PPE required',
  flash_point_c: 'Flash point (°C)',
  boiling_point_c: 'Boiling point (°C)',
  vapor_pressure_kpa: 'Vapor pressure (kPa)',
  pel_twa_ppm: 'PEL TWA (ppm)',
  stel_ppm: 'STEL (ppm)',
  idlh_ppm: 'IDLH (ppm)',
  first_aid: 'First aid',
  firefighting: 'Firefighting',
  spill_cleanup: 'Spill cleanup',
  storage_class: 'Storage class',
  incompatibilities: 'Incompatibilities',
  dot_un_number: 'DOT UN #',
  dot_hazard_class: 'DOT hazard class',
  dot_packing_group: 'DOT packing group',
  sds_revision_date: 'SDS revision date',
}

export default function ChemicalsReviewPage() {
  const { tenant } = useTenant()
  const [rows,    setRows]    = useState<PendingRow[] | null>(null)
  const [active,  setActive]  = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [selected, setSelected] = useState<Set<FieldKey>>(new Set())
  const [currentProduct, setCurrentProduct] = useState<Record<string, unknown> | null>(null)

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const loadQueue = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const res  = await fetch('/api/chemicals/review-queue', { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setRows([])
      return
    }
    setRows(body.pending ?? [])
    if (!active && body.pending?.length) setActive(body.pending[0].id)
  }, [tenant, buildHeaders, active])

  useEffect(() => { void loadQueue() }, [loadQueue])

  const activeRow = useMemo(
    () => rows?.find(r => r.id === active) ?? null,
    [rows, active],
  )

  // Fetch the *current* product fields whenever the active row changes
  // — the diff column on the left needs them.
  useEffect(() => {
    if (!activeRow) { setCurrentProduct(null); return }
    let cancelled = false
    void (async () => {
      const headers = await buildHeaders()
      const res  = await fetch(`/api/chemicals/products/${activeRow.product_id}`, { headers })
      const body = await res.json()
      if (cancelled) return
      if (res.ok) setCurrentProduct(body.product as Record<string, unknown>)
      else        setCurrentProduct(null)
    })()
    return () => { cancelled = true }
  }, [activeRow, buildHeaders])

  const proposed = useMemo<ProductFieldsFromParse>(
    () => activeRow?.parsed_payload ? parseToProductFields(activeRow.parsed_payload) : {},
    [activeRow],
  )

  // Default-select every proposed field that DIFFERS from the current
  // product. If they match, leave unchecked — no point applying a no-op.
  useEffect(() => {
    if (!activeRow || !currentProduct) {
      setSelected(new Set())
      return
    }
    const diffs = new Set<FieldKey>()
    for (const k of Object.keys(proposed) as FieldKey[]) {
      if (!isSame(proposed[k], (currentProduct as Record<string, unknown>)[k])) {
        diffs.add(k)
      }
    }
    setSelected(diffs)
  }, [activeRow, currentProduct, proposed])

  function toggle(field: FieldKey) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  async function applySelection() {
    if (!activeRow) return
    if (selected.size === 0) {
      setError('Select at least one field to apply.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res  = await fetch(
        `/api/chemicals/products/${activeRow.product_id}/sds/${activeRow.id}/apply`,
        {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body:    JSON.stringify({ fields: Array.from(selected) }),
        },
      )
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      // Move on to the next pending row.
      setActive(null)
      await loadQueue()
    } finally {
      setBusy(false)
    }
  }

  async function rejectParse() {
    if (!activeRow) return
    if (!confirm('Reject this AI parse? The proposed fields are discarded; the SDS remains attached.')) return
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res  = await fetch(
        `/api/chemicals/products/${activeRow.product_id}/sds/${activeRow.id}/apply`,
        { method: 'DELETE', headers },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setActive(null)
      await loadQueue()
    } finally {
      setBusy(false)
    }
  }

  if (rows === null) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-12 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading review queue…
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">SDS review queue</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          AI-proposed fields from parsed Safety Data Sheets, awaiting human approval.
          Apply per-field; nothing lands on a product without a click here.
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-center py-16 text-slate-500">
          <Sparkles className="w-8 h-8 mx-auto mb-2 opacity-40" />
          The queue is empty. Parse an SDS from a chemical detail page to fill it.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5">
          <aside className="space-y-1">
            <div className="text-xs font-semibold uppercase text-slate-500 mb-2">
              Pending ({rows.length})
            </div>
            {rows.map(r => {
              const product = r.chemical_products
              const isActive = r.id === active
              return (
                <button
                  key={r.id}
                  onClick={() => setActive(r.id)}
                  className={`w-full text-left px-3 py-2 rounded border ${
                    isActive
                      ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 dark:border-indigo-700'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900'
                  }`}
                >
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
                    {product?.name ?? '(unknown product)'}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1">
                    {product?.manufacturer && <span>{product.manufacturer}</span>}
                    <ConfidenceBadge value={r.parse_confidence} />
                  </div>
                </button>
              )
            })}
          </aside>

          {activeRow ? (
            <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-4">
              <header className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <div className="text-xs text-slate-500">
                    Parsed by {activeRow.parse_model ?? 'AI'} · {' '}
                    overall confidence <ConfidenceText
                      value={activeRow.parsed_payload?.confidence?.overall}
                    />
                  </div>
                  <Link
                    href={`/chemicals/${activeRow.product_id}`}
                    className="mt-1 inline-flex items-center gap-1 text-lg font-semibold text-slate-900 dark:text-slate-100 hover:underline"
                  >
                    {activeRow.chemical_products?.name ?? '(unknown)'}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <SignalWordBadge word={activeRow.chemical_products?.ghs_signal_word ?? null} />
                    <PictogramBadges pictograms={activeRow.chemical_products?.ghs_pictograms ?? []} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={rejectParse}
                    disabled={busy}
                    className="px-3 py-2 text-sm rounded border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-60"
                  >
                    <X className="inline w-4 h-4 mr-1" /> Reject parse
                  </button>
                  <button
                    onClick={applySelection}
                    disabled={busy || selected.size === 0}
                    className="inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Apply {selected.size} field{selected.size === 1 ? '' : 's'}
                  </button>
                </div>
              </header>

              {activeRow.parsed_payload?.parser_notes && (
                <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
                  <strong className="font-semibold">Parser notes:</strong> {activeRow.parsed_payload.parser_notes}
                </div>
              )}

              <div className="grid grid-cols-[24px_180px_1fr_1fr] gap-x-3 gap-y-2 items-start text-sm">
                <div />
                <div className="text-xs font-semibold uppercase text-slate-500">Field</div>
                <div className="text-xs font-semibold uppercase text-slate-500">Current</div>
                <div className="text-xs font-semibold uppercase text-slate-500">Proposed</div>
                {FIELD_ORDER.filter(k => k in proposed).map(k => {
                  const propVal = proposed[k]
                  const currVal = currentProduct?.[k]
                  const same    = isSame(propVal, currVal)
                  const conf    = confidenceForField(activeRow.parsed_payload, k)
                  return (
                    <ReviewRow
                      key={k}
                      checked={selected.has(k)}
                      onChange={() => toggle(k)}
                      label={FIELD_LABEL[k]}
                      currentValue={currVal}
                      proposedValue={propVal}
                      same={same}
                      confidence={conf}
                    />
                  )
                })}
              </div>
            </section>
          ) : (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-8 text-center text-slate-500">
              Select a pending parse on the left.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface ReviewRowProps {
  checked:       boolean
  onChange:      () => void
  label:         string
  currentValue:  unknown
  proposedValue: unknown
  same:          boolean
  confidence:    ParseConfidence | null
}
function ReviewRow(props: ReviewRowProps) {
  return (
    <>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onChange}
        disabled={props.same}
        className="mt-1.5"
        title={props.same ? 'Proposed value matches current — nothing to apply' : 'Apply this field'}
      />
      <div className="font-medium text-slate-700 dark:text-slate-300 pt-1.5">
        {props.label}
        {props.confidence && (
          <span className="ml-1 text-[10px]">
            <ConfidenceText value={props.confidence} compact />
          </span>
        )}
      </div>
      <div className={`pt-1.5 ${props.same ? 'text-slate-500' : 'text-slate-700 dark:text-slate-300'} break-words`}>
        {renderValue(props.currentValue)}
      </div>
      <div className={`pt-1.5 break-words ${props.same ? 'text-slate-400 italic' : 'text-emerald-700 dark:text-emerald-400 font-medium'}`}>
        {props.same ? '(no change)' : renderValue(props.proposedValue)}
      </div>
    </>
  )
}

function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return null
  const tier = value >= 0.85 ? 'high' : value >= 0.5 ? 'medium' : 'low'
  return <ConfidenceText value={tier} />
}

function ConfidenceText({ value, compact }: { value: ParseConfidence | undefined; compact?: boolean }) {
  if (!value) return null
  const cls = value === 'high'
    ? 'text-emerald-700 dark:text-emerald-400'
    : value === 'medium'
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-rose-700 dark:text-rose-400'
  return <span className={`${cls} ${compact ? 'text-[10px]' : 'text-xs'} font-medium uppercase`}>{value}</span>
}

function confidenceForField(
  payload: ParsedSdsPayload | null | undefined,
  field: FieldKey,
): ParseConfidence | null {
  if (!payload?.confidence) return null
  const map: Partial<Record<FieldKey, ParseConfidence>> = {
    name:                     payload.confidence.identification,
    manufacturer:             payload.confidence.identification,
    product_code:             payload.confidence.identification,
    cas_numbers:              payload.confidence.identification,
    synonyms:                 payload.confidence.identification,
    physical_state:           payload.confidence.physical,
    flash_point_c:            payload.confidence.physical,
    boiling_point_c:          payload.confidence.physical,
    vapor_pressure_kpa:       payload.confidence.physical,
    ghs_signal_word:          payload.confidence.hazards,
    ghs_pictograms:           payload.confidence.hazards,
    hazard_statements:        payload.confidence.hazards,
    precautionary_statements: payload.confidence.hazards,
    nfpa_health:              payload.confidence.hazards,
    nfpa_flammability:        payload.confidence.hazards,
    nfpa_instability:         payload.confidence.hazards,
    pel_twa_ppm:              payload.confidence.exposure,
    stel_ppm:                 payload.confidence.exposure,
    idlh_ppm:                 payload.confidence.exposure,
    ppe_required:             payload.confidence.exposure,
    first_aid:                payload.confidence.first_aid,
    firefighting:             payload.confidence.firefighting,
    spill_cleanup:            payload.confidence.spill_cleanup,
    dot_un_number:            payload.confidence.transport,
    dot_hazard_class:         payload.confidence.transport,
    dot_packing_group:        payload.confidence.transport,
  }
  return map[field] ?? null
}

function renderValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined || v === '') {
    return <span className="italic text-slate-400">—</span>
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="italic text-slate-400">—</span>
    if (typeof v[0] === 'object' && v[0] !== null) {
      return (
        <ul className="space-y-0.5">
          {(v as { code?: string; text?: string }[]).map((item, i) => (
            <li key={i} className="text-xs">
              {item.code && <span className="font-mono mr-1">{item.code}</span>}
              {item.text}
            </li>
          ))}
        </ul>
      )
    }
    return v.join(', ')
  }
  if (typeof v === 'object') {
    return (
      <pre className="text-xs whitespace-pre-wrap font-mono">
        {JSON.stringify(v, null, 2)}
      </pre>
    )
  }
  return String(v)
}

function isSame(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined) return b === null || b === undefined || b === ''
  if (b === null || b === undefined) return a === '' || (Array.isArray(a) && a.length === 0)
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}
