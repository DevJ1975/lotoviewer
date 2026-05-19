'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ClipboardCopy, Eye, Loader2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'

// Admin tool to mint a read-only inspector URL. Pick a date range +
// label + expiry, post to /api/inspector/sign, get back a signed URL
// the admin copy-pastes to the inspector. Stateless on purpose — see
// lib/inspectorToken.ts for the trade-off rationale.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
function nDaysAgoIso(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function InspectorMintPage() {
  const { profile, loading: authLoading } = useAuth()
  const [start,   setStart]   = useState(() => nDaysAgoIso(90))
  const [end,     setEnd]     = useState(() => todayIso())
  const [label,   setLabel]   = useState('')
  const [days,    setDays]    = useState(30)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [url,     setUrl]     = useState<string | null>(null)
  const [exp,     setExp]     = useState<number | null>(null)
  const [copied,  setCopied]  = useState(false)

  async function mint() {
    if (!label.trim()) { setError('Add a label so the audit trail is meaningful.'); return }
    setBusy(true); setError(null); setUrl(null); setCopied(false)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setError('You must be signed in to mint inspector URLs.')
        setBusy(false)
        return
      }
      const res = await fetch('/api/inspector/sign', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ start, end, label: label.trim(), expiresInDays: days }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? `Mint failed (${res.status})`)
      } else {
        setUrl(json.url)
        setExp(json.exp)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mint failed')
    } finally {
      setBusy(false)
    }
  }

  async function copyToClipboard() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback — older Safari without clipboard API. Select-and-copy
      // by focusing an off-screen element. We just nudge the user
      // instead of fighting browser quirks.
      setError('Clipboard unavailable on this browser. Select the URL below and copy manually.')
    }
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const inverted = start && end && start > end

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-brand-navy" />
          Mint inspector URL
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          A signed read-only URL for an OSHA / Cal-OSHA inspector. Pick a date range, label
          the inspection, set how long the URL stays valid, and share. The token is HMAC-signed
          server-side; anyone with the URL can browse permits in the window for the duration of
          the expiry.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
            Inspection label
          </span>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="Cal/OSHA inspection 2026-05"
            disabled={busy}
            maxLength={200}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Window start</span>
            <input
              type="date"
              value={start}
              onChange={e => setStart(e.target.value)}
              max={end || undefined}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Window end</span>
            <input
              type="date"
              value={end}
              onChange={e => setEnd(e.target.value)}
              min={start || undefined}
              max={todayIso()}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">URL valid for</span>
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
            >
              {[1, 3, 7, 14, 30, 60, 90].map(n => (
                <option key={n} value={n}>{n} days</option>
              ))}
            </select>
          </label>
        </div>

        {inverted && (
          <p className="text-xs text-rose-600 dark:text-rose-400">Window start must be on or before end.</p>
        )}
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={mint}
            disabled={busy || !!inverted || !label.trim()}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? 'Minting…' : 'Mint URL'}
          </button>
        </div>
      </div>

      {url && exp && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 p-5 space-y-3">
          <p className="text-xs font-bold text-emerald-900 dark:text-emerald-100">
            URL ready — share with the inspector
          </p>
          <div className="rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-2 text-[11px] font-mono break-all text-slate-700 dark:text-slate-300 select-all">
            {url}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={copyToClipboard}
              className="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
            >
              <ClipboardCopy className="h-3 w-3" />
              {copied ? 'Copied!' : 'Copy URL'}
            </button>
            <Link
              href={url.replace(/^https?:\/\/[^/]+/, '')}   // pathname + query only
              className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors flex items-center gap-1.5"
            >
              <Eye className="h-3 w-3" />
              Preview as inspector
            </Link>
          </div>
          <p className="text-[11px] text-emerald-900/80 dark:text-emerald-100/80">
            Expires {new Date(exp * 1000).toLocaleString()}.
            {' '}If you need to revoke before then, rotate the
            {' '}<span className="font-mono">INSPECTOR_TOKEN_SECRET</span> env var
            {' '}— that invalidates every live URL.
          </p>
        </div>
      )}
    </div>
  )
}
