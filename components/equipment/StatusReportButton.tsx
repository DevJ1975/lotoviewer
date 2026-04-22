'use client'

import { useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Equipment, LotoReview } from '@/lib/types'

interface Props {
  equipment:      Equipment[]
  decommissioned: ReadonlySet<string>
}

export default function StatusReportButton({ equipment, decommissioned }: Props) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data: reviews, error: fetchErr } = await supabase
        .from('loto_reviews')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (fetchErr) throw new Error(fetchErr.message)

      // Lazy-load the PDF generator (pdf-lib is ~300KB min-gzipped) — the
      // status report is a rare action, no reason to ship it on first paint.
      const { generateStatusReport, downloadStatusReport } = await import('@/lib/report')
      const bytes = await generateStatusReport({
        equipment,
        decommissioned,
        reviews: (reviews ?? []) as LotoReview[],
      })
      downloadStatusReport(bytes)
    } catch (e) {
      setError((e as Error).message || 'Could not generate report.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        title="Generate Status Report PDF"
        aria-label="Generate Status Report PDF"
        className="text-slate-400 hover:text-brand-navy hover:bg-slate-100 rounded-md w-7 h-7 flex items-center justify-center transition-colors disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
      </button>
      {error && (
        <p className="absolute left-0 top-full mt-1 w-48 text-[10px] text-rose-500 font-medium bg-white border border-rose-200 rounded-md px-2 py-1 shadow-sm z-10">
          {error}
        </p>
      )}
    </div>
  )
}
