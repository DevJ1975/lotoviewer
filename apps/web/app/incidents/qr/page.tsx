'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import QRCode from 'qrcode'
import {
  ArrowLeft, AlertTriangle, Check, Copy, Download, Loader2, Pencil, Plus,
  Power, Printer, Search, Settings2, ShieldCheck, Trash2,
} from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// /incidents/qr — Admin QR-code management.
//
// Each row is a posted physical sign at a particular location. The
// admin can print a poster, copy/download the QR, and configure
// per-token policy (rate limit, auto-route, captcha, geofence).
// Live count of new reports is wired via Supabase realtime on the
// incidents table.

interface QrToken {
  id:                            string
  label:                         string
  token:                         string
  enabled:                       boolean
  rate_limit_per_hour:           number | null
  total_reports:                 number
  last_used_at:                  string | null
  created_at:                    string
  default_assigned_investigator: string | null
  auto_route_enabled:            boolean
  require_captcha:               boolean
  site_geo_lat:                  number | null
  site_geo_lng:                  number | null
  geofence_radius_m:             number | null
}

type StatusFilter = 'all' | 'enabled' | 'disabled'
type SortKey      = 'activity' | 'reports' | 'newest' | 'label'

interface ActivityResponse {
  window_days: number
  buckets:     string[]
  activity:    Record<string, number[]>
}

const QR_OPTIONS = {
  errorCorrectionLevel: 'H' as const,
  margin: 1,
  color: { dark: '#1B3A6B', light: '#ffffff' },
}

export default function QrTokensPage() {
  const { tenant } = useTenant()
  const [items,   setItems]   = useState<QrToken[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [editing, setEditing] = useState<QrToken | null>(null)

  const [newLabel, setNewLabel] = useState('')
  const [newRate,  setNewRate]  = useState<string>('')

  const [search, setSearch]     = useState('')
  const [status, setStatus]     = useState<StatusFilter>('all')
  const [sort,   setSort]       = useState<SortKey>('activity')

  // Realtime: increment per-row when a new anonymous incident comes
  // in for one of our tokens. A small "● new" pill renders next to
  // the title; clicking the row clears it.
  const [newCounts, setNewCounts] = useState<Record<string, number>>({})

  const [activity, setActivity] = useState<ActivityResponse | null>(null)

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

  const loadActivity = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch('/api/incidents/qr-tokens/activity?days=30', { headers })
      const body = await res.json()
      if (res.ok) setActivity(body as ActivityResponse)
    } catch { /* sparkline is best-effort */ }
  }, [tenant])

  useEffect(() => { void load() }, [load])
  useEffect(() => { void loadActivity() }, [loadActivity])

  // Realtime: subscribe to new anonymous incidents in this tenant.
  // Match the pattern in /status/page.tsx — single channel, filter
  // by tenant_id at the postgres level so we don't fan out across
  // tenants.
  useEffect(() => {
    if (!tenant?.id) return
    const channel = supabase
      .channel(`qr-tokens-${tenant.id}`)
      .on(
        'postgres_changes',
        {
          event:  'INSERT',
          schema: 'public',
          table:  'incidents',
          filter: `tenant_id=eq.${tenant.id}`,
        },
        (payload) => {
          const row = payload.new as { anon_token_id?: string | null; is_anonymous?: boolean }
          if (!row.is_anonymous || !row.anon_token_id) return
          setNewCounts(c => ({ ...c, [row.anon_token_id!]: (c[row.anon_token_id!] ?? 0) + 1 }))
          // Best-effort refresh of the row's totals; debounced via
          // the 60s sparkline cache. No big deal if we miss one.
          setItems(prev => prev.map(t =>
            t.id === row.anon_token_id
              ? { ...t, total_reports: t.total_reports + 1, last_used_at: new Date().toISOString() }
              : t,
          ))
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [tenant?.id])

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

  async function patchToken(id: string, patch: Partial<QrToken>): Promise<QrToken | null> {
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/qr-tokens?id=${id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify(patch),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const updated = body.qr_token as QrToken
      setItems(prev => prev.map(x => x.id === id ? updated : x))
      return updated
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function toggleEnabled(t: QrToken) {
    await patchToken(t.id, { enabled: !t.enabled })
  }

  async function deleteToken(t: QrToken) {
    if (!confirm(
      `Delete token for "${t.label}"?\n\n` +
      `Posted signs that point at this token will stop working. ` +
      `Existing reports filed via this token are kept (the column ` +
      `referencing it is set to NULL).`,
    )) return
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

  function clearNewBadge(id: string) {
    setNewCounts(c => {
      if (!c[id]) return c
      const { [id]: _gone, ...rest } = c
      return rest
    })
  }

  // Filtering + sorting are pure client-side derivations of `items`.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = items.filter(t => {
      if (status === 'enabled'  && !t.enabled) return false
      if (status === 'disabled' &&  t.enabled) return false
      if (q && !t.label.toLowerCase().includes(q)) return false
      return true
    })
    const sorter: Record<SortKey, (a: QrToken, b: QrToken) => number> = {
      activity: (a, b) => (b.last_used_at ?? '').localeCompare(a.last_used_at ?? ''),
      reports:  (a, b) => b.total_reports - a.total_reports,
      newest:   (a, b) => b.created_at.localeCompare(a.created_at),
      label:    (a, b) => a.label.localeCompare(b.label),
    }
    return out.sort(sorter[sort])
  }, [items, search, status, sort])

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
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            More options (auto-route, captcha, geofence) are available after creation via the gear icon.
          </p>
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

      {!loading && items.length >= 5 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by label…"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 pl-8 pr-3 py-2 text-sm"
            />
          </div>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as StatusFilter)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          >
            <option value="activity">Most recent activity</option>
            <option value="reports">Most reports</option>
            <option value="newest">Newest</option>
            <option value="label">A → Z</option>
          </select>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {!loading && items.length === 0 && !showNew && <EmptyState onNew={() => setShowNew(true)} />}

      {!loading && items.length > 0 && filtered.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-6">
          No tokens match your filters.
        </p>
      )}

      <ul className="space-y-3">
        {filtered.map(t => (
          <TokenRow
            key={t.id}
            token={t}
            onToggle={toggleEnabled}
            onDelete={deleteToken}
            onEdit={() => setEditing(t)}
            onClearNewBadge={() => clearNewBadge(t.id)}
            newCount={newCounts[t.id] ?? 0}
            sparkline={activity?.activity?.[t.id]}
            busy={busy}
          />
        ))}
      </ul>

      {editing && (
        <EditModal
          token={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const res = await patchToken(editing.id, patch)
            if (res) setEditing(null)
          }}
          busy={busy}
        />
      )}
    </div>
  )
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center space-y-3">
      <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-brand-yellow/30">
        <ShieldCheck className="h-6 w-6 text-brand-navy" />
      </div>
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        Make it safe to speak up
      </h2>
      <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto">
        Post a QR code at high-traffic locations — loading docks, break rooms, near hazards.
        Workers scan, file a report in 30 seconds, no login. OSHA 1904.35(b)(1)(iv) protects them
        from retaliation; the printed poster says so plainly.
      </p>
      <button
        type="button"
        onClick={onNew}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
      >
        <Plus className="h-4 w-4" />
        Create your first QR token
      </button>
    </div>
  )
}

function TokenRow({
  token, onToggle, onDelete, onEdit, onClearNewBadge,
  newCount, sparkline, busy,
}: {
  token:    QrToken
  onToggle: (t: QrToken) => Promise<void>
  onDelete: (t: QrToken) => Promise<void>
  onEdit:   () => void
  onClearNewBadge: () => void
  newCount: number
  sparkline?: number[]
  busy:     boolean
}) {
  const [qrSvg, setQrSvg] = useState<string | null>(null)

  const reportUrl = useMemo(
    () => (typeof window === 'undefined' ? '' : `${window.location.origin}/report/${token.token}`),
    [token.token],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    QRCode.toString(reportUrl, { type: 'svg', width: 200, ...QR_OPTIONS })
      .then(setQrSvg)
      .catch(() => setQrSvg(null))
  }, [reportUrl])

  function printPoster() {
    if (typeof window === 'undefined') return
    const w = window.open('', '_blank', 'width=800,height=900')
    if (!w) return
    w.document.write(`<!doctype html>
<html><head><title>${escapeHtml(token.label)} — anonymous report poster</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 48px; text-align: center; color: #1a2230; }
  .label { font-size: 11px; letter-spacing: .18em; text-transform: uppercase; color: #5b6675; font-weight: 700; }
  h1 { font-size: 36px; margin: 8px 0; }
  .location { font-size: 24px; color: #214488; margin: 0 0 24px 0; }
  .qr { display: inline-block; padding: 16px; border: 4px solid #214488; border-radius: 16px; position: relative; }
  .qr svg { width: 360px; height: 360px; display: block; }
  .qr .logo {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: 76px; height: 76px; border-radius: 50%;
    background: #FFD900; box-shadow: 0 0 0 6px #ffffff;
    display: flex; align-items: center; justify-content: center;
  }
  .qr .logo img { width: 56px; height: 56px; display: block; }
  .url { font-family: ui-monospace, Menlo, monospace; font-size: 14px; margin-top: 16px; color: #5b6675; word-break: break-all; }
  .protect { margin-top: 32px; font-size: 12px; color: #5b6675; max-width: 480px; margin-left: auto; margin-right: auto; line-height: 1.55; }
  @media print { body { padding: 0; } }
</style></head><body>
  <p class="label">SoteriaField · Anonymous report</p>
  <h1>Scan to report a safety concern</h1>
  <p class="location">${escapeHtml(token.label)}</p>
  <div class="qr">
    ${qrSvg ?? ''}
    <div class="logo"><img src="${window.location.origin}/icon.svg" alt="" /></div>
  </div>
  <p class="url">${escapeHtml(reportUrl)}</p>
  <p class="protect">
    Anonymous reports are protected from retaliation under OSHA 1904.35(b)(1)(iv).
    No login required — your name is never collected.
  </p>
  <script>setTimeout(() => window.print(), 300)</script>
</body></html>`)
    w.document.close()
  }

  return (
    <li
      onClick={onClearNewBadge}
      className={
        'rounded-xl border border-slate-200 dark:border-slate-800 p-4 transition-opacity ' +
        (token.enabled ? '' : 'opacity-60')
      }
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="shrink-0">
          {qrSvg
            ? (
              <div className="relative w-24 h-24">
                <div
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                  className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-yellow ring-2 ring-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/icon.svg" alt="" className="h-5 w-5" />
                  </div>
                </div>
              </div>
            )
            : <div className="w-24 h-24 bg-slate-100 dark:bg-slate-800 rounded" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{token.label}</h3>
            {newCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 dark:bg-emerald-900/40 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {newCount} new
              </span>
            )}
            {!token.enabled && (
              <span className="rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:text-slate-200">
                DISABLED
              </span>
            )}
            {token.require_captcha && (
              <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                CAPTCHA
              </span>
            )}
            {token.geofence_radius_m && (
              <span className="rounded-full bg-sky-100 dark:bg-sky-900/40 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                GEO {token.geofence_radius_m}m
              </span>
            )}
            {token.default_assigned_investigator && token.auto_route_enabled && (
              <span className="rounded-full bg-violet-100 dark:bg-violet-900/40 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-300">
                AUTO-ROUTE
              </span>
            )}
          </div>
          <CopyUrlButton url={reportUrl} />
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5">
            {token.total_reports} report{token.total_reports === 1 ? '' : 's'} ·
            {token.rate_limit_per_hour ? ` rate limit ${token.rate_limit_per_hour}/hr` : ' no rate limit'}
            {token.last_used_at && ` · last used ${new Date(token.last_used_at).toLocaleString()}`}
          </p>
          {sparkline && sparkline.some(n => n > 0) && (
            <Sparkline values={sparkline} className="mt-1.5" />
          )}
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); printPoster() }}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90"
          >
            <Printer className="h-3 w-3" />
            Print poster
          </button>
          <DownloadMenu url={reportUrl} label={token.label} />
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Settings2 className="h-3 w-3" />
            Settings
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void onToggle(token) }}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Power className="h-3 w-3" />
            {token.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void onDelete(token) }}
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

function EditModal({
  token, onClose, onSave, busy,
}: {
  token: QrToken
  onClose: () => void
  onSave:  (patch: Partial<QrToken>) => Promise<void>
  busy:    boolean
}) {
  const [label, setLabel]   = useState(token.label)
  const [rate,  setRate]    = useState(token.rate_limit_per_hour?.toString() ?? '')
  const [assignee, setAssignee] = useState(token.default_assigned_investigator ?? '')
  const [autoRoute, setAutoRoute] = useState(token.auto_route_enabled)
  const [captcha, setCaptcha]   = useState(token.require_captcha)
  const [lat, setLat]       = useState(token.site_geo_lat?.toString() ?? '')
  const [lng, setLng]       = useState(token.site_geo_lng?.toString() ?? '')
  const [radius, setRadius] = useState(token.geofence_radius_m?.toString() ?? '')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const latN    = lat.trim()    ? Number(lat)    : null
    const lngN    = lng.trim()    ? Number(lng)    : null
    const radiusN = radius.trim() ? Number(radius) : null
    void onSave({
      label:                         label.trim(),
      rate_limit_per_hour:           rate.trim() ? Number(rate) : null,
      default_assigned_investigator: assignee.trim() || null,
      auto_route_enabled:            autoRoute,
      require_captcha:               captcha,
      site_geo_lat:                  latN,
      site_geo_lng:                  lngN,
      geofence_radius_m:             radiusN,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Pencil className="h-4 w-4" /> Token settings
        </h2>

        <ModalField label="Location label">
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </ModalField>

        <ModalField label="Rate limit per hour" hint="empty = no cap">
          <input
            type="number"
            min="1"
            value={rate}
            onChange={e => setRate(e.target.value)}
            className="w-32 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </ModalField>

        <fieldset className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Routing</legend>
          <ModalField label="Default investigator user-id" hint="UUID, optional">
            <input
              type="text"
              value={assignee}
              onChange={e => setAssignee(e.target.value)}
              placeholder="empty = no auto-route"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono text-xs"
            />
          </ModalField>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={autoRoute}
              onChange={e => setAutoRoute(e.target.checked)}
            />
            Auto-route reports to this investigator
          </label>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Untick for sensitive locations (HR concerns, etc.) where the
            assignee may be the subject of the report.
          </p>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Abuse protection</legend>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={captcha}
              onChange={e => setCaptcha(e.target.checked)}
            />
            Require captcha (Cloudflare Turnstile)
          </label>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Adds a one-tap challenge before the form submits. Enable after
            you see abuse signals — friction reduces submit rate by ~5–8%.
          </p>
        </fieldset>

        <fieldset className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Geofence (optional)</legend>
          <div className="grid grid-cols-2 gap-2">
            <ModalField label="Site latitude">
              <input
                type="number" step="any"
                value={lat} onChange={e => setLat(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </ModalField>
            <ModalField label="Site longitude">
              <input
                type="number" step="any"
                value={lng} onChange={e => setLng(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
              />
            </ModalField>
          </div>
          <ModalField label="Radius (metres)" hint="50–50000">
            <input
              type="number" min="50" max="50000"
              value={radius} onChange={e => setRadius(e.target.value)}
              className="w-32 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </ModalField>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Reports outside the radius are accepted but flagged for review.
            Never used to reject — a real safety report shouldn&apos;t hinge on a GPS fix.
          </p>
        </fieldset>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ModalField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
        {hint && <span className="ml-2 text-slate-400 normal-case font-normal">{hint}</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  // 60×16 inline SVG. Scale Y to the max value in the series (with
  // a floor of 1 so a series of all 1s still has visible bars).
  const W = 60, H = 16
  const max = Math.max(1, ...values)
  const barW = W / values.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={className} aria-hidden>
      {values.map((v, i) => {
        const h = (v / max) * H
        return (
          <rect
            key={i}
            x={i * barW + 0.5}
            y={H - h}
            width={Math.max(0.5, barW - 1)}
            height={Math.max(0, h)}
            className="fill-brand-navy/70"
          />
        )
      })}
    </svg>
  )
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        timer.current = setTimeout(() => setCopied(false), 1500)
      } catch { /* give up silently */ }
    }
  }

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); void copy() }}
      title={url}
      className="mt-1 inline-flex items-center gap-1.5 max-w-full rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
      <span className="font-mono truncate">{url}</span>
    </button>
  )
}

function DownloadMenu({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  async function downloadPng() {
    setOpen(false)
    const dataUrl = await QRCode.toDataURL(url, { width: 1024, ...QR_OPTIONS })
    triggerDownload(dataUrl, `qr-${slug(label)}.png`)
  }

  async function downloadSvg() {
    setOpen(false)
    const svg = await QRCode.toString(url, { type: 'svg', width: 1024, ...QR_OPTIONS })
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const obj  = URL.createObjectURL(blob)
    triggerDownload(obj, `qr-${slug(label)}.svg`)
    setTimeout(() => URL.revokeObjectURL(obj), 1000)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="w-full inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <Download className="h-3 w-3" />
        Download
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-10 w-32 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-md py-1 text-xs">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void downloadPng() }}
            className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
          >PNG (1024px)</button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void downloadSvg() }}
            className="w-full text-left px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
          >SVG (vector)</button>
        </div>
      )}
    </div>
  )
}

function triggerDownload(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'token'
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
