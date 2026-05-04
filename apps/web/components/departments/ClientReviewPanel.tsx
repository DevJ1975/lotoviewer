'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { renderReviewLinkBody } from '@/lib/email/renderReviewLinkBody'

// Client-review-portal panel for /departments/[dept]. Sits below the
// existing in-app sign-off section. Two affordances:
//   1. "Send for client review" button → modal → POST /api/admin/review-links
//      (1..MAX_REVIEWERS at a time)
//   2. List of past + pending review_links for this department, with
//      revoke + copy-link affordances + manual-send-via-your-email
//      fallback.
//
// State updates use a manual refetch after each mutation rather than
// realtime — these are low-volume admin actions, no need for the
// extra subscription.

const MAX_REVIEWERS = 5

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
  email_channel:       'auto' | 'manual'
}

// Subset of ReviewLinkRow needed to compose a manual-send mailto.
interface MailtoContext {
  reviewerName:  string
  reviewerEmail: string
  tenantName:    string
  department:    string
  placardCount:  number
  reviewUrl:     string
  expiresAt:     string
  adminMessage:  string | null
}

interface Props {
  department: string
}

export default function ClientReviewPanel({ department }: Props) {
  const { tenantId, tenant } = useTenant()
  const [links,   setLinks]   = useState<ReviewLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [showSendModal, setShowSendModal] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [placardCount, setPlacardCount] = useState<number>(0)

  const tenantName = tenant?.name ?? 'your tenant'

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

  // Background fetch the placard count so manual-send mailto bodies
  // reflect the same numbers Resend sends would.
  useEffect(() => {
    if (!tenantId) return
    void supabase
      .from('loto_equipment')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('department', department)
      .eq('decommissioned', false)
      .then(({ count }) => setPlacardCount(count ?? 0))
  }, [tenantId, department])

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

  function buildMailtoContext(link: ReviewLinkRow): MailtoContext {
    return {
      reviewerName:  link.reviewer_name,
      reviewerEmail: link.reviewer_email,
      tenantName,
      department:    link.department,
      placardCount,
      reviewUrl:     reviewUrl(link.token),
      expiresAt:     link.expires_at,
      adminMessage:  link.admin_message,
    }
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
          mailto={buildMailtoContext(link)}
          onRevoke={() => handleRevoke(link.id)}
          onCopyLink={() => {
            void navigator.clipboard.writeText(reviewUrl(link.token))
            setToast('Link copied to clipboard')
          }}
          onCopyEmailText={() => {
            const ctx = buildMailtoContext(link)
            const { subject, body } = renderReviewLinkBody({
              ...ctx,
              adminMessage: ctx.adminMessage ?? undefined,
            })
            void navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`)
            setToast('Email text copied — paste into your mail app')
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
          tenantName={tenantName}
          placardCount={placardCount}
          baseUrl={typeof window !== 'undefined' ? window.location.origin : ''}
          onClose={() => setShowSendModal(false)}
          onSent={(msg) => { setToast(msg); setShowSendModal(false); void refresh() }}
        />
      )}
    </div>
  )
}

// ─── LinkRow ────────────────────────────────────────────────────────────────

function LinkRow({
  link, mailto, onRevoke, onCopyLink, onCopyEmailText,
}: {
  link:             ReviewLinkRow
  mailto:           MailtoContext
  onRevoke:         () => void
  onCopyLink:       () => void
  onCopyEmailText:  () => void
}) {
  const status = computeLinkStatus(link)
  const canManualSend = !link.revoked_at && !link.signed_off_at

  const mailtoHref = canManualSend ? buildMailtoUrl(mailto) : undefined

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
            {link.email_channel === 'manual' ? 'Created' : 'Sent'} {formatRelative(link.sent_at ?? link.created_at)}
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
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {canManualSend && mailtoHref && (
            <a
              href={mailtoHref}
              className="text-[11px] font-semibold bg-brand-navy text-white px-2.5 py-1 rounded-md hover:bg-brand-navy/90"
              title="Compose a pre-filled email in your default mail client"
            >
              Send via your email
            </a>
          )}
          <div className="flex items-center gap-2">
            {canManualSend && (
              <button type="button" onClick={onCopyEmailText} className="text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline">
                Copy email text
              </button>
            )}
            <button type="button" onClick={onCopyLink} className="text-[11px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline">
              Copy link
            </button>
            {canManualSend && (
              <button type="button" onClick={onRevoke} className="text-[11px] text-rose-700 hover:text-rose-900 underline">
                Revoke
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// Status badge logic. Manual-channel rows get their own neutral
// "Sent manually" badge so the admin can tell at a glance which
// links went out via Resend vs. their own mail client.
function computeLinkStatus(link: ReviewLinkRow): { label: string; tone: string } {
  if (link.revoked_at) return { label: 'Revoked', tone: 'bg-slate-100 text-slate-600' }
  if (link.signed_off_at) {
    return link.signoff_approved
      ? { label: 'Approved',      tone: 'bg-emerald-100 text-emerald-800' }
      : { label: 'Needs changes', tone: 'bg-amber-100 text-amber-800' }
  }
  if (link.first_viewed_at) return { label: 'Opened', tone: 'bg-sky-100 text-sky-800' }
  if (link.email_channel === 'manual') {
    return { label: 'Sent manually', tone: 'bg-indigo-100 text-indigo-800' }
  }
  if (link.sent_at) return { label: 'Sent', tone: 'bg-slate-200 text-slate-700' }
  return { label: 'Send failed', tone: 'bg-amber-100 text-amber-800' }
}

function buildMailtoUrl(ctx: MailtoContext): string {
  const { subject, body } = renderReviewLinkBody({
    reviewerName:  ctx.reviewerName,
    reviewerEmail: ctx.reviewerEmail,
    tenantName:    ctx.tenantName,
    department:    ctx.department,
    placardCount:  ctx.placardCount,
    reviewUrl:     ctx.reviewUrl,
    expiresAt:     ctx.expiresAt,
    adminMessage:  ctx.adminMessage ?? undefined,
  }, { truncateAdminMessageForMailto: true })
  const params = new URLSearchParams()
  params.set('subject', subject)
  params.set('body', body)
  return `mailto:${encodeURIComponent(ctx.reviewerEmail)}?${params.toString()}`
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'just now'
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86400_000) return `${Math.floor(ms / 3600_000)}h ago`
  return `${Math.floor(ms / 86400_000)}d ago`
}

// ─── SendForReviewModal ────────────────────────────────────────────────────

interface ReviewerRow {
  id:    string  // local-only stable key for the form rows
  name:  string
  email: string
}

function SendForReviewModal({
  department, tenantName, placardCount, baseUrl, onClose, onSent,
}: {
  department:   string
  tenantName:   string
  placardCount: number
  baseUrl:      string
  onClose:      () => void
  onSent:       (toastMsg: string) => void
}) {
  const { tenantId } = useTenant()
  const [reviewers, setReviewers] = useState<ReviewerRow[]>([
    { id: rid(), name: '', email: '' },
  ])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addRow() {
    if (reviewers.length >= MAX_REVIEWERS) return
    setReviewers(rs => [...rs, { id: rid(), name: '', email: '' }])
  }
  function removeRow(id: string) {
    setReviewers(rs => rs.length === 1 ? rs : rs.filter(r => r.id !== id))
  }
  function updateRow(id: string, patch: Partial<ReviewerRow>) {
    setReviewers(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  const valid = reviewers.every(r => r.name.trim() && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email.trim()))
              && new Set(reviewers.map(r => r.email.trim().toLowerCase())).size === reviewers.length

  async function submit(opts: { skipEmail: boolean }) {
    if (busy || !valid) return
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
          reviewers: reviewers.map(r => ({ name: r.name.trim(), email: r.email.trim() })),
          admin_message:  message.trim(),
          skip_email:     opts.skipEmail,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      const links = (body.links ?? []) as Array<{ reviewer_email: string; review_url: string; reviewer_name: string; expires_at: string; admin_message: string | null; email_sent: boolean }>

      if (opts.skipEmail) {
        // Open the first reviewer's mail-app immediately on this user
        // gesture (a click). For batches >1, hand off to the
        // walkthrough so each subsequent reviewer requires its own
        // explicit click (avoids popup-blocker drama).
        if (links.length === 1) {
          window.location.href = mailtoFromLink(links[0]!, { tenantName, department, placardCount })
          onSent(`Opened mail app for ${links[0]!.reviewer_email}`)
        } else {
          openManualBatch(links, { tenantName, department, placardCount }, onSent)
        }
        return
      }

      // Resend path. Summarize partial failures.
      const sentCount   = links.filter(l => l.email_sent).length
      const failedRows  = links.filter(l => !l.email_sent)
      if (failedRows.length === 0) {
        onSent(`Sent ${sentCount} ${sentCount === 1 ? 'invite' : 'invites'}`)
      } else {
        onSent(`Sent ${sentCount} of ${links.length}. ${failedRows.length} failed: ${failedRows.map(r => r.reviewer_email).join(', ')} — see panel for retry options.`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <header>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">Send {department} for review</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Up to {MAX_REVIEWERS} reviewers per send. They don't need a Soteria account.
          </p>
        </header>

        <div className="space-y-2">
          {reviewers.map((r, i) => (
            <div key={r.id} className="flex items-end gap-2">
              <label className="flex-1 block">
                {i === 0 && <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Name</span>}
                <input
                  type="text"
                  value={r.name}
                  onChange={e => updateRow(r.id, { name: e.target.value })}
                  placeholder={`Reviewer ${i + 1} name`}
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="flex-1 block">
                {i === 0 && <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Email</span>}
                <input
                  type="email"
                  autoComplete="off"
                  value={r.email}
                  onChange={e => updateRow(r.id, { email: e.target.value })}
                  placeholder="alice@client.com"
                  className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-2 py-1.5 text-sm"
                />
              </label>
              {reviewers.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRow(r.id)}
                  className="text-slate-400 hover:text-rose-700 text-lg w-7 h-7 flex items-center justify-center"
                  title="Remove this reviewer"
                  aria-label="Remove reviewer"
                >×</button>
              )}
            </div>
          ))}
          {reviewers.length < MAX_REVIEWERS && (
            <button
              type="button"
              onClick={addRow}
              className="text-[12px] font-semibold text-brand-navy hover:underline"
            >
              + Add another reviewer ({MAX_REVIEWERS - reviewers.length} remaining)
            </button>
          )}
        </div>

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

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => void submit({ skipEmail: false })}
            disabled={busy || !valid}
            className="w-full bg-brand-navy text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {busy ? 'Sending…' : `Send ${reviewers.length === 1 ? 'invite' : `${reviewers.length} invites`} via Soteria`}
          </button>
          <button
            type="button"
            onClick={() => void submit({ skipEmail: true })}
            disabled={busy || !valid}
            className="w-full text-sm font-semibold border border-slate-200 dark:border-slate-700 px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            title="Skip auto-send; open each invite in your default mail app so it goes from your own address"
          >
            Open {reviewers.length === 1 ? 'in your mail app' : `${reviewers.length} in your mail app`}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 self-center mt-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// Helper used by the manual-batch walkthrough.
function mailtoFromLink(
  link: { reviewer_email: string; reviewer_name: string; review_url: string; expires_at: string; admin_message: string | null },
  ctx:  { tenantName: string; department: string; placardCount: number },
): string {
  const { subject, body } = renderReviewLinkBody({
    reviewerName:  link.reviewer_name,
    reviewerEmail: link.reviewer_email,
    tenantName:    ctx.tenantName,
    department:    ctx.department,
    placardCount:  ctx.placardCount,
    reviewUrl:     link.review_url,
    expiresAt:     link.expires_at,
    adminMessage:  link.admin_message ?? undefined,
  }, { truncateAdminMessageForMailto: true })
  const params = new URLSearchParams()
  params.set('subject', subject)
  params.set('body', body)
  return `mailto:${encodeURIComponent(link.reviewer_email)}?${params.toString()}`
}

// Walkthrough modal for batch manual-send. Browsers block multiple
// auto-popups, so we open the first immediately on the original
// click and require an explicit Continue button for each subsequent
// reviewer (preserves user-gesture).
function openManualBatch(
  links: Array<{ reviewer_email: string; reviewer_name: string; review_url: string; expires_at: string; admin_message: string | null; email_sent: boolean }>,
  ctx:   { tenantName: string; department: string; placardCount: number },
  done:  (toastMsg: string) => void,
) {
  if (links.length === 0) { done('No links to send'); return }

  // Open the first immediately — same user-gesture as the click that
  // triggered submit(), so no popup block.
  window.location.href = mailtoFromLink(links[0]!, ctx)

  if (links.length === 1) { done(`Opened mail app for ${links[0]!.reviewer_email}`); return }

  // For the rest, render a tiny floating walkthrough panel with a
  // Continue button per reviewer. Each click is a fresh user gesture
  // and bypasses popup blockers.
  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.5);display:flex;align-items:center;justify-content:center;z-index:60;'
  document.body.appendChild(root)

  let i = 1
  function renderStep() {
    if (i >= links.length) {
      root.remove()
      done(`Opened mail app for all ${links.length} reviewers`)
      return
    }
    const link = links[i]!
    root.innerHTML = `
      <div style="background:#fff;color:#0f172a;border-radius:12px;padding:20px;max-width:380px;width:100%;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
        <div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#1e3a8a;margin-bottom:6px;">Reviewer ${i + 1} of ${links.length}</div>
        <div style="font-size:15px;font-weight:600;">${escapeHtml(link.reviewer_name)}</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:12px;">${escapeHtml(link.reviewer_email)}</div>
        <p style="font-size:13px;line-height:1.5;color:#334155;margin:0 0 14px 0;">Click Continue to open the next invite in your mail app. Send it, then return here for the next reviewer.</p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="ml-skip" style="background:#fff;color:#64748b;border:1px solid #cbd5e1;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">Skip remaining</button>
          <button id="ml-continue" style="background:#1e3a8a;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer;">Continue →</button>
        </div>
      </div>
    `
    const cont = root.querySelector('#ml-continue') as HTMLButtonElement | null
    const skip = root.querySelector('#ml-skip') as HTMLButtonElement | null
    cont?.addEventListener('click', () => {
      window.location.href = mailtoFromLink(link, ctx)
      i += 1
      renderStep()
    })
    skip?.addEventListener('click', () => {
      root.remove()
      done(`Opened ${i} of ${links.length} reviewers; ${links.length - i} skipped — links still saved.`)
    })
  }
  renderStep()
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function rid(): string {
  // Stable enough for one modal session — no need for crypto.randomUUID.
  return Math.random().toString(36).slice(2, 10)
}
