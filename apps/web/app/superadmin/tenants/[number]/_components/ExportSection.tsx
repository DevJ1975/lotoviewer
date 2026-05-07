'use client'

import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, Download, CheckCircle2, Clock } from 'lucide-react'
import { superadminFetch } from '@/lib/superadminFetch'
import { Section } from './Section'

interface Props {
  tenantNumber: string
  tenantName:   string
}

// JSON-bundle export of every tenant-scoped table. Photos in
// loto-photos/ Storage are NOT included (an admin can mirror those
// separately via the Supabase Storage UI). Stays a single download
// to keep the surface trivially re-importable.
//
// "Last exported" hint is per-browser via localStorage — there is
// no server-side history. Operators routinely export from one
// machine before a maintenance window; the hint is enough context.

const LAST_KEY = (n: string) => `soteria.tenant.${n}.lastExportAt`

interface LastExport { at: string; bytes: number; filename: string }

function readLast(tenantNumber: string): LastExport | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(LAST_KEY(tenantNumber))
    return raw ? JSON.parse(raw) as LastExport : null
  } catch { return null }
}

function writeLast(tenantNumber: string, value: LastExport) {
  try { localStorage.setItem(LAST_KEY(tenantNumber), JSON.stringify(value)) }
  catch { /* private mode */ }
}

function formatBytes(n: number): string {
  if (n < 1024)              return `${n} B`
  if (n < 1024 * 1024)       return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function ExportSection({ tenantNumber, tenantName }: Props) {
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok,    setOk]    = useState<string | null>(null)
  const [last,  setLast]  = useState<LastExport | null>(null)

  // Hydrate after mount — localStorage isn't available during SSR.
  useEffect(() => { setLast(readLast(tenantNumber)) }, [tenantNumber])

  async function onExport() {
    setBusy(true); setError(null); setOk(null)
    try {
      const res = await superadminFetch(
        `/api/superadmin/tenants/${tenantNumber}/export`,
        { method: 'GET' },
      )
      if (!res.ok) {
        let msg = `Export failed (${res.status})`
        try {
          const j = await res.json() as { error?: string }
          if (j?.error) msg = j.error
        } catch { /* non-JSON body */ }
        setError(msg)
        return
      }

      // Read into a Blob so we can trigger a save dialog without
      // navigating away from the tenant page.
      const blob = await res.blob()
      const cd   = res.headers.get('content-disposition') ?? ''
      const m    = cd.match(/filename="([^"]+)"/)
      const filename = m?.[1] ?? `tenant-${tenantNumber}-export.json`

      const url = URL.createObjectURL(blob)
      const a   = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      const stamp: LastExport = { at: new Date().toISOString(), bytes: blob.size, filename }
      writeLast(tenantNumber, stamp)
      setLast(stamp)
      setOk(`Downloaded ${filename} (${formatBytes(blob.size)})`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Export tenant data">
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Bundles every tenant-scoped table for <span className="font-medium">{tenantName}</span> (#{tenantNumber})
        into a single JSON download. Useful for off-platform backups, support
        debugging, or seeding a staging tenant. Photos in Storage are not
        included — mirror those separately via the Supabase Storage UI if needed.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={onExport}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-slate-800 text-white text-sm font-medium hover:bg-slate-900 dark:bg-slate-700 dark:hover:bg-slate-600 disabled:opacity-60 transition-colors"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {busy ? 'Bundling…' : 'Download JSON export'}
        </button>

        {last && !busy && (
          <span
            className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400"
            title={`${last.filename} · ${formatBytes(last.bytes)}`}
          >
            <Clock className="h-3 w-3" />
            Last exported {timeAgo(last.at)} · {formatBytes(last.bytes)}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}
      {ok && (
        <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" /> {ok}
        </p>
      )}
    </Section>
  )
}

function timeAgo(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime()
  if (ms < 0)               return 'just now'
  const min  = Math.round(ms / 60_000)
  if (min < 1)              return 'just now'
  if (min < 60)             return `${min} min ago`
  const hr   = Math.round(min / 60)
  if (hr  < 24)             return `${hr} hr ago`
  const day  = Math.round(hr  / 24)
  if (day < 30)             return `${day} day${day === 1 ? '' : 's'} ago`
  return new Date(iso).toLocaleDateString()
}
