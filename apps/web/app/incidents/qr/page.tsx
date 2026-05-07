'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import { ArrowLeft, AlertTriangle, Loader2, Plus, Printer, Power, Trash2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// /incidents/qr — Admin QR-code management.
//
// Each row is a posted physical sign at a particular location. The
// admin clicks "Print poster" to render a printable card with a big
// QR code + the location label + retaliation-protection statement.

interface QrToken {
  id:                  string
  label:               string
  token:               string
  enabled:             boolean
  rate_limit_per_hour: number | null
  total_reports:       number
  last_used_at:        string | null
  created_at:          string
}

export default function QrTokensPage() {
  const { tenant } = useTenant()
  const [items,   setItems]   = useState<QrToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [showNew, setShowNew] = useState(false)

  const [newLabel, setNewLabel] = useState('')
  const [newRate,  setNewRate]  = useState<string>('')

  const load = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/incidents/qr-tokens', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setItems(body.tokens as QrToken[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => { void load() }, [load])

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant!.id,
    }
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  async function createToken(e: React.FormEvent) {
    e.preventDefault()
    if (!newLabel.trim()) { setError('Label is required'); return }
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch('/api/incidents/qr-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          label: newLabel.trim(),
          rate_limit_per_hour: newRate ? Number(newRate) : undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setItems(prev => [body.qr_token as QrToken, ...prev])
      setNewLabel(''); setNewRate(''); setShowNew(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleEnabled(t: QrToken) {
    setBusy(true)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/qr-tokens?id=${t.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ enabled: !t.enabled }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setItems(prev => prev.map(x => x.id === t.id ? (body.qr_token as QrToken) : x))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function deleteToken(t: QrToken) {
    if (!confirm(`Delete token for "${t.label}"? Posted signs will stop working.`)) return
    setBusy(true)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/qr-tokens?id=${t.id}`, { method: 'DELETE', headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setItems(prev => prev.filter(x => x.id !== t.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/incidents" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to incidents
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Anonymous reporting QR codes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            One token per posted sign. Workers scan, file an anonymous report, no login.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(s => !s)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" />
          {showNew ? 'Cancel' : 'New QR token'}
        </button>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showNew && (
        <form onSubmit={createToken} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Location label</span>
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              required
              placeholder="e.g. Loading Dock B"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Rate limit per hour <span className="text-slate-400 normal-case">(optional)</span></span>
            <input
              type="number"
              min="1"
              value={newRate}
              onChange={e => setNewRate(e.target.value)}
              placeholder="e.g. 30"
              className="mt-1 w-32 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !newLabel.trim()}
              className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create token'}
            </button>
          </div>
        </form>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && items.length === 0 && !showNew && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No QR tokens yet.</p>
        </div>
      )}

      <ul className="space-y-3">
        {items.map(t => (
          <TokenRow
            key={t.id}
            token={t}
            onToggle={toggleEnabled}
            onDelete={deleteToken}
            busy={busy}
          />
        ))}
      </ul>
    </div>
  )
}

function TokenRow({
  token, onToggle, onDelete, busy,
}: {
  token:  QrToken
  onToggle: (t: QrToken) => Promise<void>
  onDelete: (t: QrToken) => Promise<void>
  busy:   boolean
}) {
  const [qrSvg, setQrSvg] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/report/${token.token}`
    QRCode.toString(url, { type: 'svg', margin: 1, width: 200 })
      .then(setQrSvg)
      .catch(() => setQrSvg(null))
  }, [token.token])

  function printPoster() {
    if (typeof window === 'undefined') return
    const url = `${window.location.origin}/report/${token.token}`
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) return
    w.document.write(`<!doctype html>
<html><head><title>${escapeHtml(token.label)} — anonymous report poster</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 48px; text-align: center; color: #1a2230; }
  .label { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #5b6675; font-weight: 700; }
  h1 { font-size: 36px; margin: 8px 0; }
  .location { font-size: 24px; color: #214488; margin: 0 0 24px 0; }
  .qr { display: inline-block; padding: 16px; border: 4px solid #214488; border-radius: 16px; }
  .qr svg { width: 360px; height: 360px; }
  .url { font-family: ui-monospace, Menlo, monospace; font-size: 14px; margin-top: 16px; color: #5b6675; word-break: break-all; }
  .protect { margin-top: 32px; font-size: 12px; color: #5b6675; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.55; }
  @media print { body { padding: 0; } }
</style></head><body>
  <p class="label">Soteria FIELD · Anonymous report</p>
  <h1>Scan to report a safety concern</h1>
  <p class="location">${escapeHtml(token.label)}</p>
  <div class="qr">${qrSvg ?? ''}</div>
  <p class="url">${escapeHtml(url)}</p>
  <p class="protect">
    Anonymous reports are protected from retaliation under OSHA 1904.35(b)(1)(iv).
    No login required — your name is never collected.
  </p>
  <script>setTimeout(() => window.print(), 300)</script>
</body></html>`)
    w.document.close()
  }

  return (
    <li className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0">
          {qrSvg
            ? <div dangerouslySetInnerHTML={{ __html: qrSvg }} className="w-24 h-24" />
            : <div className="w-24 h-24 bg-slate-100 dark:bg-slate-800 rounded" />}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{token.label}</h3>
          <p className="font-mono text-[10px] text-slate-500 dark:text-slate-400 break-all mt-1">
            {token.token.slice(0, 16)}…
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            {token.total_reports} report{token.total_reports === 1 ? '' : 's'} ·
            {token.rate_limit_per_hour ? ` rate limit ${token.rate_limit_per_hour}/hr` : ' no rate limit'}
            {token.last_used_at && ` · last used ${new Date(token.last_used_at).toLocaleString()}`}
          </p>
          {!token.enabled && (
            <span className="inline-block mt-1 rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">
              DISABLED
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={printPoster}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90"
          >
            <Printer className="h-3 w-3" />
            Print poster
          </button>
          <button
            type="button"
            onClick={() => void onToggle(token)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Power className="h-3 w-3" />
            {token.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={() => void onDelete(token)}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-rose-300 dark:border-rose-800 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            Delete
          </button>
        </div>
      </div>
    </li>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
