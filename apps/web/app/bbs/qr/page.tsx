'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, RefreshCcw, Loader2, Printer, QrCode, Power } from 'lucide-react'
import QRCode from 'qrcode'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

interface Location {
  id:          string
  name:        string
  area:        string | null
  description: string | null
  token:       string
  active:      boolean
  created_at:  string
}

export default function BBSQrAdminPage() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<Location[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [qrImages, setQrImages] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch('/api/bbs/locations', { headers })
    const body = await res.json()
    if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); return }
    setRows(body.locations ?? [])
  }, [tenant?.id])

  useEffect(() => { void load() }, [load])

  // Pre-render QR images for every location once we have them.
  useEffect(() => {
    if (!rows) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    void Promise.all(rows.map(async loc => {
      const url = `${origin}/r/bbs/${loc.token}`
      const dataUrl = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, scale: 6 })
      return [loc.id, dataUrl] as const
    })).then(pairs => {
      setQrImages(Object.fromEntries(pairs))
    })
  }, [rows])

  async function api(path: string, init: RequestInit) {
    if (!tenant?.id) throw new Error('No tenant')
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant.id,
      ...(init.headers as Record<string, string> ?? {}),
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(path, { ...init, headers })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    return body
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true); setError(null)
    try {
      await api('/api/bbs/locations', {
        method: 'POST',
        body:   JSON.stringify({ name: name.trim(), area: area.trim() }),
      })
      setName(''); setArea('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function handleRotate(id: string) {
    if (!confirm('Rotate the token for this location? Existing printed QR codes will stop working.')) return
    try {
      await api(`/api/bbs/locations/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ rotate_token: true }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleToggleActive(loc: Location) {
    try {
      await api(`/api/bbs/locations/${loc.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ active: !loc.active }),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function handlePrint(loc: Location) {
    const dataUrl = qrImages[loc.id]
    if (!dataUrl) return
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<!doctype html><html><head><title>BBS QR — ${loc.name}</title>
      <style>
        body { font-family: -apple-system, sans-serif; text-align: center; padding: 24px; }
        h1 { margin: 0 0 8px; font-size: 22px; }
        p { color: #555; }
        img { width: 320px; height: 320px; }
        .url { font-size: 12px; color: #888; margin-top: 12px; word-break: break-all; }
      </style></head><body>
      <h1>${loc.name}</h1>
      ${loc.area ? `<p>${loc.area}</p>` : ''}
      <img src="${dataUrl}" alt="QR" />
      <p>Scan to report an unsafe act, unsafe condition, or safe behavior.</p>
      <div class="url">${window.location.origin}/r/bbs/${loc.token}</div>
      </body></html>`)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 300)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/bbs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" />
        Back to BBS
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">QR Codes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Generate per-location QR signs. Anyone who scans can submit an observation — anonymously or with their name.
        </p>
      </header>

      <form onSubmit={handleCreate} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h2 className="font-semibold">Add a location</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Name (e.g. Line 3 Entrance)"
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <input
            type="text" value={area} onChange={e => setArea(e.target.value)}
            placeholder="Area (optional, e.g. Packaging)"
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
          />
          <button
            type="submit" disabled={creating || !name.trim()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white text-sm font-medium"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <QrCode className="w-8 h-8 mx-auto mb-2 text-slate-400" />
          No locations yet — add your first above.
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map(loc => (
            <li key={loc.id} className={`rounded-lg border p-4 flex gap-3 ${loc.active ? 'border-slate-200 dark:border-slate-800' : 'border-slate-200 dark:border-slate-800 opacity-60'}`}>
              <div className="shrink-0 bg-white p-1 rounded">
                {qrImages[loc.id]
                  ? <img src={qrImages[loc.id]} alt="" className="w-24 h-24" />
                  : <div className="w-24 h-24 bg-slate-100 animate-pulse rounded" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 dark:text-slate-100">{loc.name}</div>
                {loc.area && <div className="text-xs text-slate-500">{loc.area}</div>}
                <div className="font-mono text-[10px] text-slate-400 mt-1 break-all">/r/bbs/{loc.token.slice(0, 12)}…</div>
                <div className="mt-2 flex gap-1 flex-wrap">
                  <button
                    type="button" onClick={() => handlePrint(loc)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Printer className="w-3 h-3" /> Print
                  </button>
                  <button
                    type="button" onClick={() => handleRotate(loc.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <RefreshCcw className="w-3 h-3" /> Rotate
                  </button>
                  <button
                    type="button" onClick={() => handleToggleActive(loc)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Power className="w-3 h-3" /> {loc.active ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
