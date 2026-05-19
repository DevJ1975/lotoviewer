'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCcw,
  Share2,
  ShieldOff,
  Link as LinkIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'

// /admin/loto/public-review-link — tenant-wide anonymous floor-walk
// link for supervisors. Three states:
//
//   1. No active link  → "Mint public link" button creates one
//      (72h expiry, no reviewer identity, get-or-create idempotent).
//   2. Active link     → URL + QR + copy + open buttons, expires-in
//      countdown, "Extend +24h" + "Revoke" actions.
//   3. After revoke    → button to mint a fresh one.

const EXTEND_PRESETS = [24, 72, 168] as const

interface PublicLinkRow {
  id:               string
  token:            string
  review_url:       string
  expires_at:       string
  extension_count:  number
  last_extended_at: string | null
  created_at:       string
}

interface ActionResult { kind: 'ok' | 'err'; message: string }

export default function PublicReviewLinkPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [link, setLink]       = useState<PublicLinkRow | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [busy, setBusy]       = useState<null | 'mint' | 'revoke' | 'extend'>(null)
  const [result, setResult]   = useState<ActionResult | null>(null)

  const refresh = useCallback(async () => {
    if (!tenantId) return
    setLoadErr(null)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch('/api/admin/review-links?is_public=1', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      // The GET endpoint isn't filtered by is_public yet; pick the
      // active public row out of the list client-side. Inexpensive —
      // the tenant has at most a few rows.
      const active = (body.links ?? []).find((r: Record<string, unknown>) =>
        r.is_public === true && r.revoked_at == null,
      ) as PublicLinkRow | undefined
      if (active) {
        const baseUrl = (typeof window !== 'undefined' ? window.location.origin : '').replace(/\/$/, '')
        setLink({
          ...active,
          review_url: `${baseUrl}/review/${active.token}`,
        })
      } else {
        setLink(null)
      }
    } catch (err) {
      setLoadErr(err instanceof Error ? err.message : String(err))
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void refresh()
  }, [authLoading, profile, refresh])

  async function mint() {
    if (!tenantId) return
    setBusy('mint'); setResult(null)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch('/api/admin/review-links', {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ is_public: true }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setLink(body.link as PublicLinkRow)
      setResult({ kind: 'ok', message: body.created ? 'Public link minted.' : 'Returning existing active link.' })
    } catch (err) {
      setResult({ kind: 'err', message: err instanceof Error ? err.message : String(err) })
    } finally { setBusy(null) }
  }

  async function revoke() {
    if (!tenantId || !link) return
    if (typeof window !== 'undefined' && !window.confirm('Revoke this public link? Anyone with the current URL will lose access immediately.')) return
    setBusy('revoke'); setResult(null)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch(`/api/admin/review-links/${link.id}`, {
        method:  'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'revoke' }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setLink(null)
      setResult({ kind: 'ok', message: 'Public link revoked.' })
    } catch (err) {
      setResult({ kind: 'err', message: err instanceof Error ? err.message : String(err) })
    } finally { setBusy(null) }
  }

  async function extend(hours: number) {
    if (!tenantId || !link) return
    setBusy('extend'); setResult(null)
    try {
      const headers = await authHeaders(tenantId)
      const res = await fetch(`/api/admin/review-links/${link.id}/extend`, {
        method:  'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hours }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setLink(prev => prev ? {
        ...prev,
        expires_at:       body.link.expires_at,
        extension_count:  body.link.extension_count,
        last_extended_at: body.link.last_extended_at,
      } : prev)
      setResult({ kind: 'ok', message: `Extended by ${hours}h.` })
    } catch (err) {
      setResult({ kind: 'err', message: err instanceof Error ? err.message : String(err) })
    } finally { setBusy(null) }
  }

  if (authLoading) return <main className="mx-auto max-w-3xl px-4 py-12"><Loader2 className="size-4 animate-spin" /></main>
  if (!profile?.is_admin) return <main className="mx-auto max-w-3xl px-4 py-12 text-sm text-slate-500">Admins only.</main>

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/admin" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow">
        <ArrowLeft className="h-3.5 w-3.5" />
        Admin
      </Link>

      <header className="mt-3 mb-6 flex items-start gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
          <Share2 className="size-5" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">LOTO</p>
          <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50">Public review link</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            One anonymous URL for supervisors walking the floor. They open it on their phone, can replace photos that look off, and can flag equipment for closer admin review. No login. Expires in 72 hours by default — you can extend it once it&apos;s live.
          </p>
        </div>
      </header>

      {loadErr && (
        <p className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{loadErr}</p>
      )}
      {result && (
        <p className={`mb-4 rounded-md px-3 py-2 text-sm ${result.kind === 'ok' ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100' : 'bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100'}`}>
          {result.message}
        </p>
      )}

      {!link ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-center dark:border-slate-800 dark:bg-slate-900">
          <LinkIcon className="mx-auto size-8 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-300">No public link active</p>
          <p className="mt-1 text-xs text-slate-500">Mint a new link to share with a supervisor for a 72-hour floor walk.</p>
          <button
            type="button"
            onClick={() => void mint()}
            disabled={busy === 'mint'}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-brand-navy/90 dark:bg-brand-yellow dark:text-slate-950 dark:hover:bg-brand-yellow/90"
          >
            {busy === 'mint' ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Mint public link
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Active link</h2>
              <span className="text-xs text-slate-500">Expires {formatExpires(link.expires_at)}</span>
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
              <code className="flex-1 truncate font-mono text-xs text-slate-700 dark:text-slate-300">{link.review_url}</code>
              <button
                type="button"
                onClick={() => { void navigator.clipboard.writeText(link.review_url); setResult({ kind: 'ok', message: 'URL copied to clipboard.' }) }}
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Copy className="size-3" /> Copy
              </button>
              <a
                href={link.review_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ExternalLink className="size-3" /> Open
              </a>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Extend by:</span>
              {EXTEND_PRESETS.map(h => (
                <button
                  key={h}
                  type="button"
                  onClick={() => void extend(h)}
                  disabled={busy === 'extend'}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <RefreshCcw className="size-3" /> +{h}h
                </button>
              ))}
              <span className="ml-2 text-xs text-slate-400">extended {link.extension_count}×</span>

              <div className="grow"></div>

              <button
                type="button"
                onClick={() => void revoke()}
                disabled={busy === 'revoke'}
                className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
              >
                {busy === 'revoke' ? <Loader2 className="size-3 animate-spin" /> : <ShieldOff className="size-3" />}
                Revoke
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <p className="font-semibold text-slate-800 dark:text-slate-200">On this link supervisors can:</p>
            <ul className="mt-2 ml-4 list-disc space-y-1">
              <li>Replace EQUIP or ISO photos — the placard regenerates automatically</li>
              <li>Mark equipment for review — admins triage the queue at <Link href="/admin/loto/review-queue" className="underline">/admin/loto/review-queue</Link></li>
            </ul>
            <p className="mt-3">They cannot view internal notes, sign off, or see other tenants. The link is the only auth.</p>
          </div>
        </div>
      )}
    </main>
  )
}

function formatExpires(iso: string): string {
  const ms = Date.parse(iso) - Date.now()
  if (ms <= 0) return 'expired'
  const hours = Math.round(ms / 3_600_000)
  if (hours < 48) return `in ${hours}h`
  const days = Math.round(hours / 24)
  return `in ${days}d`
}

const SESSION_REFRESH_WINDOW_MS = 2 * 60 * 1000
async function authHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session: current } } = await supabase.auth.getSession()
  let session = current
  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0
  if (!session?.access_token || expiresAtMs <= Date.now() + SESSION_REFRESH_WINDOW_MS) {
    const { data, error } = await supabase.auth.refreshSession()
    if (error) throw new Error('Your session expired. Please refresh the page.')
    session = data.session
  }
  if (!session?.access_token) throw new Error('Sign in expired — refresh the page.')
  return {
    'Authorization':   `Bearer ${session.access_token}`,
    'x-active-tenant': tenantId,
  }
}
