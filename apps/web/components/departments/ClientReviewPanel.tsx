'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

// Client-review-portal panel for /departments/[dept]. Sits below the
// existing in-app sign-off section. Two affordances:
//   1. "Send for client review" button → modal → POST /api/admin/review-links
//   2. List of past + pending review_links for this department, with
//      revoke + copy-link affordances.
//
// State updates use a manual refetch after each mutation rather than
// realtime — these are low-volume admin actions, no need for the
// extra subscription.

interface ReviewLinkRow {
  id:                  string
  department:          string
  reviewer_name:       string
  reviewer_email:      string
  admin_message:       string | null
  sent_at:             string | null
  first_viewed_at:     string | null
  signed_off_at:       string | null
  signoff_approved:    boolean | null
  signoff_typed_name:  string | null
  signoff_notes:       string | null
  expires_at:          string
  revoked_at:          string | null
  created_at:          string
  token:               string
}

interface Props {
  department: string
}

export default function ClientReviewPanel({ department }: Props) {
  const { tenantId } = useTenant()
  const [links,   setLinks]   = useState<ReviewLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [showSendModal, setShowSendModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

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
      setLinks(body.links ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [department, tenantId])

  useEffect(() => { void refresh() }, [refresh])

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this review link? The reviewer will no longer be able to open it.')) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/admin/review-links/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant': tenantId ?? '',
        },
        body: JSON.stringify({ action: 'revoke' }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setToast('Link revoked')
      void refresh()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Revoke failed')
    }
  }

  function reviewUrl(token: string): string {
    if (typeof window !== 'undefined') return `${window.location.origin}/review/${token}`
    return `/review/${token}`
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">Client review portal</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Send a tokenized link to a non-Soteria reviewer (e.g. the customer's safety officer). They can leave per-placard notes and sign off without an account.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowSendModal(true)}
          className="shrink-0 bg-brand-navy text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-brand-navy/90 transition-colors"
        >
          + Send for client review
        </button>
      </div>

      {loading && <p className="text-xs text-slate-400">Loading review links…</p>}
      {error && <p className="text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}

      {!loading && links.length === 0 && (
        <p className="text-xs text-slate-400 italic">No client review links sent yet for this department.</p>
      )}

      {links.map(link => (
        <LinkRow
          key={link.id}
          link={link}
          reviewUrl={reviewUrl(link.token)}
          onRevoke={() => handleRevoke(link.id)}
          onCopy={() => {
            void navigator.clipboard.writeText(reviewUrl(link.token))
            setToast('Link copied to clipboard')
          }}
        />
      ))}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-slate-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      {showSendModal && (
        <SendForReviewModal
          department={department}
          onClose={() => setShowSendModal(false)}
          onSent={(msg) => { setToast(msg); setShowSendModal(false); void refresh() }}
        />
      )}
    </div>
  )
}

function LinkRow({
  link, reviewUrl, onRevoke, onCopy,
}: {
  link:      ReviewLinkRow
  reviewUrl: string
  onRevoke:  () => void
  onCopy:    () => void
}) {
  const status = link.revoked_at
    ? { label: 'Revoked', tone: 'bg-slate-100 text-slate-600' }
    : link.signed_off_at
    ? link.signoff_approved
      ? { label: 'Approved',      tone: 'bg-emerald-100 text-emerald-800' }
      : { label: 'Needs changes', tone: 'bg-amber-100 text-amber-800' }
    : link.first_viewed_at
    ? { label: 'Opened',  tone: 'bg-sky-100 text-sky-800' }
    : link.sent_at
    ? { label: 'Sent',    tone: 'bg-slate-200 text-slate-700' }
    : { label: 'Pending send', tone: 'bg-amber-100 text-amber-800' }

  return (
    <div className="border border-slate-100 dark:border-slate-800 rounded-lg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">{link.reviewer_name}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">{link.reviewer_email}</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${status.tone}`}>{status.label}</span>
          </div>
          {link.admin_message && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">"{link.admin_message}"</p>
          )}
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
            Sent {formatRelative(link.sent_at ?? link.created_at)}
            {link.first_viewed_at ? ` · Opened ${formatRelative(link.first_viewed_at)}` : ''}
            {link.signed_off_at ? ` · Signed ${formatRelative(link.signed_off_at)}` : ''}
            {' · '}Expires {new Date(link.expires_at).toLocaleDateString()}
          </p>
          {link.signoff_notes && (
            <div className="mt-2 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 rounded px-2 py-1.5 whitespace-pre-wrap">
              <span className="font-semibold">Reviewer notes:</span> {link.signoff_notes}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onCopy}
            className="text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline"
          >
            Copy link
          </button>
          {!link.revoked_at && !link.signed_off_at && (
            <button
              type="button"
              onClick={onRevoke}
              className="text-[11px] text-rose-700 hover:text-rose-900 underline"
            >
              Revoke
            </button>
          )}
        </div>
      </div>
    </div>
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

function SendForReviewModal({
  department, onClose, onSent,
}: {
  department: string
  onClose:    () => void
  onSent:     (toastMsg: string) => void
}) {
  const { tenantId } = useTenant()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/review-links', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant': tenantId ?? '',
        },
        body: JSON.stringify({
          department,
          reviewer_name:  name.trim(),
          reviewer_email: email.trim(),
          admin_message:  message.trim(),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      const toastMsg = body.link?.email_sent
        ? `Sent to ${email.trim()}`
        : `Created — email send failed; copy the link manually`
      onSent(toastMsg)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4"
      >
        <header>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Send {department} for review</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            The reviewer doesn't need a Soteria account. They'll get an email with a tokenized link.
          </p>
        </header>

        <label className="block">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reviewer name</span>
          <input
            type="text"
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Alice Reviewer"
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reviewer email</span>
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="alice@client.com"
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </label>

        <label className="block">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Message (optional)</span>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={3}
            placeholder="e.g. 'Please look at the new fryers especially.'"
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </label>

        {error && <p className="text-sm text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name || !email}
            className="bg-brand-navy text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {busy ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </form>
    </div>
  )
}
