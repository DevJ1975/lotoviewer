'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Phone, AlertTriangle } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { PictogramBadges, SignalWordBadge } from '@/app/chemicals/_components/PictogramBadges'
import {
  firstAidEntries,
  spillCleanupEntries,
  type ParsedSdsFirstAid,
  type ParsedSdsSpillCleanup,
} from '@soteria/core/chemicals'

interface EmergencyItem {
  id:      string
  barcode: string
  status:  string
  chemical_products: {
    id:                string
    name:              string
    manufacturer:      string | null
    ghs_signal_word:   string | null
    ghs_pictograms:    string[] | null
    hazard_statements: { code: string; text: string }[] | null
    ppe_required:      string[] | null
    first_aid:         ParsedSdsFirstAid | null
    spill_cleanup:     ParsedSdsSpillCleanup | null
    emergency_phone:   string | null
  } | null
  chemical_locations: { name: string; path: string | null } | null
}

// SDS §1 emergency-contact values are free text and routinely hold non-dial
// junk ("See section 1", "N/A", "Contact supplier", blanks). Returning a
// tel: link for those would render a confident red call button that dials
// garbage (e.g. "See section 1" → tel:1) — dangerous in an actual incident.
// So only treat a value as dialable when it carries enough digits to be a
// real phone number; otherwise return null and fall back to the
// "no number on file" notice.
const MIN_PHONE_DIGITS = 7

function telHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < MIN_PHONE_DIGITS) return null
  // Preserve a leading + (international dialing) but drop spaces, dashes,
  // and parens so the dialer gets a clean number.
  const plus = phone.trim().startsWith('+') ? '+' : ''
  return `tel:${plus}${digits}`
}

export default function ChemicalEmergencyPage() {
  const params = useParams<{ id: string }>()
  const id     = params?.id
  const { tenant } = useTenant()

  const [item,    setItem]    = useState<EmergencyItem | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res  = await fetch(`/api/chemicals/inventory/${id}/emergency`, { headers })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setItem(null)
        return
      }
      setItem(body.item)
    } finally {
      setLoading(false)
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  const product   = item?.chemical_products ?? null
  const firstAid  = useMemo(() => firstAidEntries(product?.first_aid), [product])
  const spill     = useMemo(() => spillCleanupEntries(product?.spill_cleanup), [product])
  const callHref  = useMemo(
    () => (product?.emergency_phone ? telHref(product.emergency_phone) : null),
    [product],
  )

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !item || !product) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link href="/chemicals/scan" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to scan
        </Link>
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error ?? 'Container not found.'}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-5 space-y-4">
      {/* Tap-to-call: the single most time-critical action, pinned to the top.
          Only shown when the SDS value is actually dialable (see telHref). */}
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

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
        <span className="font-mono text-slate-400">{item.barcode}</span>
        <Link href={`/chemicals/inventory/${item.id}`} className="text-indigo-600 hover:underline">
          Full container details →
        </Link>
      </div>
    </div>
  )
}
