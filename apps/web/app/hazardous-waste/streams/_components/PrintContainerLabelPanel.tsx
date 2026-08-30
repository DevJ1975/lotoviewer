'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, Printer } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { HW_LABEL_SIZES } from '@/lib/hazardousWasteLabels'

// Container-label print panel for a waste stream. POSTs to the stream's
// labels route (template hw_container), receives the PDF blob, and opens it.
// Mirrors the chemicals PrintLabelPanel fetch-blob-open idiom; the size list
// comes from the shared HW_LABEL_SIZES catalog the API revalidates against.

const SIZES = HW_LABEL_SIZES.hw_container

interface PrintRow {
  id:         string
  size_key:   string
  filename:   string
  byte_size:  number | null
  printed_at: string
}

export default function PrintContainerLabelPanel({ streamId }: { streamId: string }) {
  const { tenant } = useTenant()
  const [sizeKey,  setSizeKey]  = useState<string>(SIZES[0]?.key ?? '4x6')
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
    const res = await fetch(`/api/hazardous-waste/streams/${streamId}/labels`, { headers })
    if (!res.ok) return
    const body = await res.json()
    setHistory(body.prints ?? [])
  }, [tenant, streamId, buildHeaders])

  useEffect(() => { void loadHistory() }, [loadHistory])

  async function printLabel() {
    if (!tenant?.id) return
    setPrinting(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/hazardous-waste/streams/${streamId}/labels`, {
        method:  'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body:    JSON.stringify({ template: 'hw_container', size: sizeKey }),
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
        // Pop-up blocked — fall back to a direct download.
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'hw-container-label.pdf'
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      void loadHistory()
    } finally {
      setPrinting(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <Printer className="w-4 h-4" /> Print container label
      </h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Snapshots this stream&apos;s hazards onto a 40 CFR 262.32 drum label. The accumulation start date
        is left blank for the generator to hand-write when the container starts accumulating.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Size</span>
          <select
            value={sizeKey}
            onChange={e => setSizeKey(e.target.value)}
            className="mt-1 px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
          >
            {SIZES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>

        <button
          type="button"
          onClick={() => void printLabel()}
          disabled={printing || !sizeKey}
          className="ml-auto inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded bg-brand-navy hover:bg-brand-navy/90 text-white disabled:opacity-60 disabled:cursor-not-allowed"
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
