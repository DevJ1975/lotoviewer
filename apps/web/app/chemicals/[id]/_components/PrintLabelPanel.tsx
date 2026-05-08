'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Printer, History } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// Print-label panel rendered on the chemical detail page.
//
// Three templates × multiple sizes. We mirror the LABEL_SIZES catalog
// from lib/chemicalLabels.ts here as a static map so the picker can
// render without a server round-trip; the API revalidates the
// template + size against the same source of truth before rendering.

const TEMPLATES: { key: TemplateKey; label: string; description: string; sizes: { key: string; label: string }[] }[] = [
  {
    key:   'secondary_container',
    label: 'Secondary container',
    description: 'HCS-compliant workplace label — product name, signal word, GHS pictograms, hazard statements, PPE.',
    sizes: [
      { key: '4x6',    label: '4 × 6 in (Brother QL DK-2241)' },
      { key: '2x4',    label: '2 × 4 in (compact)' },
      { key: '8.5x11', label: '8.5 × 11 in (full sheet)' },
    ],
  },
  {
    key:   'placard',
    label: 'Cabinet placard',
    description: 'Room/cabinet rollup with NFPA 704 diamond, top hazards, required PPE.',
    sizes: [
      { key: '8.5x11', label: '8.5 × 11 in (cabinet)' },
      { key: '11x17',  label: '11 × 17 in (room)' },
    ],
  },
  {
    key:   'inventory_tag',
    label: 'Inventory tag',
    description: 'Container tag with QR + barcode (links back to this chemical).',
    sizes: [
      { key: '2x1', label: '2 × 1 in (Avery 5167)' },
      { key: '4x2', label: '4 × 2 in (Brother)' },
    ],
  },
]

type TemplateKey = 'secondary_container' | 'placard' | 'inventory_tag'

interface PrintRow {
  id:          string
  template:    TemplateKey
  size_key:    string
  filename:    string
  byte_size:   number | null
  printed_at:  string
  printed_by:  string | null
}

interface Props {
  productId: string
}

export default function PrintLabelPanel({ productId }: Props) {
  const { tenant } = useTenant()
  const [template, setTemplate] = useState<TemplateKey>('secondary_container')
  const [sizeKey,  setSizeKey]  = useState<string>('4x6')
  const [barcode,  setBarcode]  = useState<string>('')
  const [printing, setPrinting] = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [history,  setHistory]  = useState<PrintRow[]>([])

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const loadHistory = useCallback(async () => {
    if (!tenant?.id) return
    const headers = await buildHeaders()
    const res = await fetch(`/api/chemicals/products/${productId}/labels`, { headers })
    if (!res.ok) return
    const body = await res.json()
    setHistory(body.prints ?? [])
  }, [tenant, productId, buildHeaders])

  useEffect(() => { void loadHistory() }, [loadHistory])

  const sizes = useMemo(
    () => TEMPLATES.find(t => t.key === template)?.sizes ?? [],
    [template],
  )
  // Reset size when template changes if current size isn't in the new list.
  useEffect(() => {
    if (!sizes.some(s => s.key === sizeKey)) {
      setSizeKey(sizes[0]?.key ?? '')
    }
  }, [sizes, sizeKey])

  async function printLabel() {
    if (!tenant?.id) return
    setPrinting(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/chemicals/products/${productId}/labels`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          template,
          size: sizeKey,
          barcode: template === 'inventory_tag' && barcode.trim() ? barcode.trim() : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        // Pop-up blocked — drop a download link instead.
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'chemical-label.pdf'
        a.click()
      }
      // Revoke after the new tab has had a chance to fetch the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      void loadHistory()
    } finally {
      setPrinting(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <Printer className="w-4 h-4" /> Print labels
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {TEMPLATES.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTemplate(t.key)}
            className={`text-left p-3 rounded border ${
              template === t.key
                ? 'border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30 dark:border-indigo-700'
                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900'
            }`}
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.label}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">{t.description}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Size</span>
          <select
            value={sizeKey}
            onChange={e => setSizeKey(e.target.value)}
            className="mt-1 px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            {sizes.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>

        {template === 'inventory_tag' && (
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Barcode (optional)</span>
            <input
              type="text"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
              placeholder="e.g. CHEM-0001"
              className="mt-1 px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </label>
        )}

        <button
          onClick={() => void printLabel()}
          disabled={printing || !sizeKey}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {printing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
          {printing ? 'Rendering…' : 'Print label'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-slate-600 dark:text-slate-300 inline-flex items-center gap-1">
            <History className="w-4 h-4" /> Print history ({history.length})
          </summary>
          <ul className="mt-2 space-y-1 text-xs">
            {history.map(p => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
                <span className="font-mono">{new Date(p.printed_at).toISOString().slice(0, 16).replace('T', ' ')}</span>
                <span>·</span>
                <span>{p.template.replace(/_/g, ' ')}</span>
                <span>·</span>
                <span>{p.size_key}</span>
                {p.byte_size && <><span>·</span><span>{(p.byte_size / 1024).toFixed(1)} KB</span></>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
