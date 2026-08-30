'use client'

import { useMemo, type ReactNode } from 'react'
import { Phone, AlertTriangle } from 'lucide-react'
import { PictogramBadges, SignalWordBadge } from './PictogramBadges'
import {
  dialableTelHref,
  firstAidEntries,
  spillCleanupEntries,
  type ParsedSdsFirstAid,
  type ParsedSdsSpillCleanup,
} from '@soteria/core/chemicals'

// The product-scoped emergency fields the panic view renders. Both the
// container view (/chemicals/inventory/[id]/emergency) and the chemical view
// (/chemicals/[id]/emergency) feed the same shape here — only the data source
// and the footer (container barcode vs. chemical link) differ.
export interface EmergencyProduct {
  name:            string
  manufacturer:    string | null
  ghs_signal_word: string | null
  ghs_pictograms:  string[] | null
  ppe_required:    string[] | null
  first_aid:       ParsedSdsFirstAid | null
  spill_cleanup:   ParsedSdsSpillCleanup | null
  emergency_phone: string | null
}

// The single, scannable emergency layout: tap-to-call pinned at the top, then
// hazard banner, first aid by route, spill response, and PPE — ordered for a
// worker reading fast in an incident. `footer` is the only view-specific slot.
export function EmergencyView({ product, footer }: { product: EmergencyProduct; footer?: ReactNode }) {
  const firstAid = useMemo(() => firstAidEntries(product.first_aid), [product])
  const spill    = useMemo(() => spillCleanupEntries(product.spill_cleanup), [product])
  const callHref = useMemo(
    () => (product.emergency_phone ? dialableTelHref(product.emergency_phone) : null),
    [product],
  )

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
      {/* Tap-to-call: the single most time-critical action, pinned to the top.
          Only shown when the SDS value is actually dialable (see dialableTelHref). */}
      {callHref ? (
        <a
          href={callHref}
          className="flex items-center justify-center gap-3 w-full rounded-xl bg-red-600 hover:bg-red-700 active:bg-red-800 text-white text-xl font-bold py-5 shadow-lg"
        >
          <Phone className="w-7 h-7" />
          Emergency: {product.emergency_phone}
        </a>
      ) : (
        <div className="flex items-center justify-center gap-2 w-full rounded-xl border border-slate-300 dark:border-slate-700 text-slate-500 text-sm py-4">
          <Phone className="w-5 h-5" /> No emergency number on file — call your site emergency line.
        </div>
      )}

      {/* Hazard banner — pictograms read before any text. */}
      <section className="rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20 p-4 space-y-3">
        <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 text-sm font-semibold uppercase tracking-wide">
          <AlertTriangle className="w-5 h-5" /> Emergency information
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 leading-tight">
          {product.name}
        </h1>
        {product.manufacturer && (
          <div className="text-sm text-slate-600 dark:text-slate-300">{product.manufacturer}</div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <SignalWordBadge word={product.ghs_signal_word} />
          <PictogramBadges pictograms={product.ghs_pictograms ?? []} size="lg" showLabel />
        </div>
      </section>

      {/* First aid by exposure route. */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">First aid</h2>
        {firstAid.length > 0 ? (
          <dl className="space-y-3">
            {firstAid.map(e => (
              <div key={e.label}>
                <dt className="text-sm font-semibold text-rose-700 dark:text-rose-300">{e.label}</dt>
                <dd className="text-base text-slate-800 dark:text-slate-200 leading-snug">{e.text}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm italic text-slate-400">No first-aid measures recorded for this chemical.</p>
        )}
      </section>

      {/* Spill / accidental-release response. */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">Spill response</h2>
        {spill.length > 0 ? (
          <ol className="space-y-3 list-decimal list-inside">
            {spill.map(e => (
              <li key={e.label} className="text-base text-slate-800 dark:text-slate-200 leading-snug">
                <span className="font-semibold text-slate-900 dark:text-slate-100">{e.label}: </span>
                {e.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm italic text-slate-400">No spill-response steps recorded for this chemical.</p>
        )}
      </section>

      {/* PPE chips. */}
      {product.ppe_required && product.ppe_required.length > 0 && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Required PPE</h2>
          <div className="flex flex-wrap gap-2">
            {product.ppe_required.map(p => (
              <span key={p} className="inline-flex items-center px-2.5 py-1 text-sm rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                {p}
              </span>
            ))}
          </div>
        </section>
      )}

      {footer}
    </div>
  )
}
