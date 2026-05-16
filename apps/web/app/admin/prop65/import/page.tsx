'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'

// /admin/prop65/import — Superadmin-only CSV refresh of the OEHHA
// system-wide chemical list (prop65_chemicals). The page itself is
// gated; the server-side API also enforces requireSuperadmin.

interface CsvRow {
  cas_number:         string
  chemical_name:      string
  harm_endpoint:      string
  listing_date?:      string
  nsrl_mg_day?:       number | null
  madl_mg_day?:       number | null
  source_publication?: string
}

function parseNumber(s: string): number | null {
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : null
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0].split(',').map(h => h.trim().toLowerCase())
  const idx = (key: string) => header.indexOf(key)
  const out: CsvRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim())
    out.push({
      cas_number:    cols[idx('cas_number')]    ?? '',
      chemical_name: cols[idx('chemical_name')] ?? '',
      harm_endpoint: cols[idx('harm_endpoint')] ?? '',
      listing_date:  idx('listing_date') >= 0 ? cols[idx('listing_date')] : undefined,
      nsrl_mg_day:   idx('nsrl_mg_day') >= 0 ? parseNumber(cols[idx('nsrl_mg_day')]) : null,
      madl_mg_day:   idx('madl_mg_day') >= 0 ? parseNumber(cols[idx('madl_mg_day')]) : null,
      source_publication: idx('source_publication') >= 0 ? cols[idx('source_publication')] : undefined,
    })
  }
  return out
}

export default function Prop65ImportPage() {
  const { profile, loading: authLoading } = useAuth()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [csv, setCsv] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const rows = parseCsv(csv)
      if (rows.length === 0) throw new Error('No rows to import')
      const { data: { session } } = await supabase.auth.getSession()
      const h = new Headers()
      if (session?.access_token) h.set('Authorization', `Bearer ${session.access_token}`)
      h.set('Content-Type', 'application/json')
      const res = await fetch('/api/admin/prop65/import', { method: 'POST', headers: h, body: JSON.stringify({ rows }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Import failed')
      setMessage(`Imported ${j.imported} rows.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  if (!profile?.is_superadmin) return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Superadmin only.</div>

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/prop65" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to Prop 65
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Upload className="h-6 w-6 text-brand-navy" /> Refresh OEHHA list
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Superadmin CSV import. Headers: <code className="text-[11px]">cas_number, chemical_name, harm_endpoint, listing_date, nsrl_mg_day, madl_mg_day, source_publication</code>
        </p>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>}
      {message && <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100">{message}</div>}

      <form onSubmit={onSubmit} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
          CSV (header row + values)
          <textarea
            value={csv}
            onChange={e => setCsv(e.target.value)}
            rows={12}
            placeholder="cas_number,chemical_name,harm_endpoint,nsrl_mg_day,madl_mg_day"
            className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-xs font-mono"
          />
        </label>
        <button type="submit" disabled={busy || !csv.trim()} className="rounded bg-brand-navy text-white text-sm px-3 py-1.5 disabled:opacity-50">
          {busy ? 'Importing…' : 'Import'}
        </button>
      </form>
    </div>
  )
}
