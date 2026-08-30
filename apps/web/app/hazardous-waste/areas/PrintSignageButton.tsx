'use client'

import { useState } from 'react'
import { Loader2, Printer } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { HW_LABEL_SIZES } from '@/lib/hazardousWasteLabels'

// Per-area "Print area signage" control. Renders an accumulation-area placard
// (aggregating the hazards of the area's active streams) by POSTing to the
// signage route, then opens the returned PDF. Mirrors the stream label panel's
// fetch-blob-open idiom; the size list comes from the shared HW_LABEL_SIZES
// catalog the API revalidates against.

const SIZES = HW_LABEL_SIZES.hw_accumulation_placard

export default function PrintSignageButton({
  areaId,
  onError,
}: {
  areaId: string
  onError: (message: string | null) => void
}) {
  const { tenant } = useTenant()
  const [sizeKey,  setSizeKey]  = useState<string>(SIZES[0]?.key ?? '8.5x11')
  const [printing, setPrinting] = useState(false)

  async function printSignage() {
    if (!tenant?.id) return
    setPrinting(true)
    onError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'x-active-tenant': tenant.id,
        'content-type':    'application/json',
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch(`/api/hazardous-waste/areas/${areaId}/signage`, {
        method: 'POST',
        headers,
        body:   JSON.stringify({ size: sizeKey }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        onError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const win = window.open(url, '_blank', 'noopener,noreferrer')
      if (!win) {
        const a = document.createElement('a')
        a.href = url
        a.download = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? 'hw-area-signage.pdf'
        a.click()
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        value={sizeKey}
        onChange={e => setSizeKey(e.target.value)}
        disabled={printing}
        aria-label="Signage size"
        className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[11px]"
      >
        {SIZES.map(s => <option key={s.key} value={s.key}>{s.key}</option>)}
      </select>
      <button
        type="button"
        onClick={() => void printSignage()}
        disabled={printing}
        className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-60"
        title="Print accumulation-area signage"
      >
        {printing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Printer className="h-3.5 w-3.5" />}
        Signage
      </button>
    </span>
  )
}
