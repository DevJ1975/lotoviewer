'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

// Client-review-portal panel for /departments/[dept]. Surfaces the
// single public review link for the department:
//   - "+ Generate public link" if none exists yet (POST get-or-create).
//   - URL + Copy + open-link buttons once one exists.
//   - Signoff status (waiting / approved / needs changes) inline.
//   - "Regenerate link" to cycle the URL (revokes the old one, mints a
//     new one, snapshots the current equipment list).
//
// Anyone with the URL can leave per-placard notes and a single sign-off
// — no account, no invite, no email send. See migration 138 for the
// schema rationale.

interface PublicLinkRow {
  id:                 string
  department:         string
  token:              string
  review_url:         string
  expires_at:         string
  first_viewed_at:    string | null
  signed_off_at:      string | null
  signoff_approved:   boolean | null
  signoff_typed_name: string | null
  signoff_notes:      string | null
  revoked_at:         string | null
  created_at:         string
  is_public:          boolean | null
}

interface Props {
  department: string
}

export default function ClientReviewPanel({ department }: Props) {
  const { tenantId } = useTenant()
  const [link,    setLink]    = useState<PublicLinkRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [toast,   setToast]   = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenantId) headers['x-active-tenant'] = tenantId
      const url = `/api/admin/review-links?department=${encodeURIComponent(department)}`
      const res = await fetch(url, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const rows = (body.links ?? []) as PublicLinkRow[]
      setLink(rows[0] ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [department, tenantId])

  useEffect(() => { void refresh() }, [refresh])

  async function generate() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/review-links', {
        method: 'POST',
        headers: {
          'Content-Type':   'application/json',
          authorization:    `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant': tenantId ?? '',
        },
        body: JSON.stringify({ department }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setToast(body.created ? 'Public link created' : 'Showing existing public link')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function regenerate(id: string) {
    if (busy) return
    if (!confirm(
      'Regenerate the public link?\n\n' +
      'The current URL will stop working immediately. Anyone you\'ve shared it with will need the new one.',
    )) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/admin/review-links/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':   'application/json',
          authorization:    `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant': tenantId ?? '',
        },
        body: JSON.stringify({ action: 'regenerate' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setToast('New public link generated')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    if (busy) return
    if (!confirm(
      'Retire the public review link?\n\n' +
      'The URL will stop working. You can generate a new one anytime.',
    )) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/admin/review-links/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':   'application/json',
          authorization:    `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant': tenantId ?? '',
        },
        body: JSON.stringify({ action: 'revoke' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setToast('Public link retired')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div id="client-review" className="scroll-mt-24 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Public review link</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          A single shareable URL for this department. Anyone with the link can
          leave per-placard notes and sign off — no account required.
        </p>
      </div>

      {loading && <p className="text-xs text-slate-400">Loading…</p>}
      {error && <p className="text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}

      {!loading && !link && (
        <button
          type="button"
          onClick={() => void generate()}
          disabled={busy}
          className="bg-brand-navy text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-brand-navy/90 transition-colors disabled:opacity-40"
        >
          {busy ? 'Generating…' : '+ Generate public link'}
        </button>
      )}

      {link && (
        <div className="space-y-3">
          <LinkBox
            url={link.review_url}
            onCopy={() => {
              void navigator.clipboard.writeText(link.review_url)
              setToast('Link copied to clipboard')
            }}
          />

          <SignoffStatus link={link} />

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={link.review_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Open in new tab ↗
            </a>
            <button
              type="button"
              onClick={() => void regenerate(link.id)}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              title="Cycle the URL — any old shared copies will stop working"
            >
              Regenerate link
            </button>
            <button
              type="button"
              onClick={() => void revoke(link.id)}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-40"
              title="Retire the public link entirely"
            >
              Retire
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div
          role="status"
          onClick={() => setToast(null)}
          className="fixed bottom-4 right-4 bg-slate-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg cursor-pointer"
        >
          {toast}
        </div>
      )}
    </div>
  )
}

function LinkBox({ url, onCopy }: { url: string; onCopy: () => void }) {
  return (
    <div className="flex items-stretch gap-2">
      <input
        type="text"
        value={url}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 text-xs font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-navy/30"
      />
      <button
        type="button"
        onClick={onCopy}
        className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90"
      >
        Copy link
      </button>
    </div>
  )
}

function SignoffStatus({ link }: { link: PublicLinkRow }) {
  if (link.signed_off_at) {
    const approved = link.signoff_approved === true
    const toneClass = approved
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
      : 'bg-amber-50 text-amber-800 border-amber-200'
    return (
      <div className={`text-xs rounded-lg border px-3 py-2 ${toneClass}`}>
        <div className="font-semibold">
          {approved ? 'Approved' : 'Needs changes'} · Anonymous
        </div>
        {link.signoff_notes && (
          <div className="mt-1 whitespace-pre-wrap">{link.signoff_notes}</div>
        )}
        <div className="mt-1 text-[11px] opacity-70">
          Signed {formatRelative(link.signed_off_at)}. Use Regenerate to open a new review pass.
        </div>
      </div>
    )
  }
  if (link.first_viewed_at) {
    return (
      <p className="text-xs text-sky-700 bg-sky-50 px-3 py-2 rounded-lg">
        Opened {formatRelative(link.first_viewed_at)}. Waiting for sign-off.
      </p>
    )
  }
  return (
    <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/40 dark:text-slate-400 px-3 py-2 rounded-lg">
      Not opened yet.
    </p>
  )
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`
  return `${Math.floor(ms / 86400_000)}d ago`
}
