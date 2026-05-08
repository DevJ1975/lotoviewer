'use client'

import { useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// Authenticated PDF-download helper. The export route is gated by
// requireTenantMember and needs the bearer token on the request, so
// a plain <a download> doesn't work — the browser would fire an
// unauthenticated GET. Instead we fetch with the headers, turn the
// response into a Blob, and trigger a download via an object URL.

interface Props {
  threadId: string
  threadTitle: string
}

export default function ExportPdfButton({ threadId, threadTitle }: Props) {
  const { tenant } = useTenant()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function download() {
    if (!tenant?.id) return
    setBusy(true); setError(null)
    try {
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/safety-boards/threads/${threadId}/export`, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${slug(threadTitle)}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoke after a tick so the click has time to register.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex items-center gap-1 rounded-full ring-1 ring-slate-300 dark:ring-slate-700 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        title="Download a PDF copy of this thread (post + replies + acks)"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
        PDF
      </button>
      {error && <span className="text-xs text-rose-700 dark:text-rose-300 ml-2">{error}</span>}
    </>
  )
}

function slug(s: string): string {
  return (s || 'safety-thread')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'safety-thread'
}
