'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

// Public review-link panel. Shows the tenant's single anonymous public
// URL plus the recent per-placard comment stream. The same panel
// renders on every /departments/[dept] page — the URL is tenant-wide,
// so the per-department context is just framing.

interface PublicLinkRow {
  id:              string
  tenant_id:       string
  department:      string | null
  token:           string
  expires_at:      string
  revoked_at:      string | null
  first_viewed_at: string | null
  created_at:      string
  is_public:       boolean | null
}

interface CommentRow {
  equipment_id: string
  notes:        string
  updated_at:   string
}

interface Props {
  // Department is accepted for caller compatibility with the existing
  // /departments/[dept]/page.tsx mount point, but the link itself is
  // tenant-wide so this is not used to scope anything.
  department: string
}

export default function ClientReviewPanel(_: Props) {
  const { tenantId } = useTenant()
  const [link,    setLink]     = useState<PublicLinkRow | null>(null)
  const [reviewUrl, setReviewUrl] = useState<string>('')
  const [comments, setComments] = useState<CommentRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [busy,    setBusy]      = useState(false)
  const [error,   setError]     = useState<string | null>(null)
  const [toast,   setToast]     = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenantId) headers['x-active-tenant'] = tenantId
      const res = await fetch('/api/admin/review-links', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setLink(body.link ?? null)
      setReviewUrl(typeof body.review_url === 'string' ? body.review_url : '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  // Pull the recent comment stream once we know the link id. Authenticated
  // admin reads go through RLS, which lets tenant owners/admins see
  // every loto_placard_reviews row joined back to their tenant via
  // review_link_id (see migration 035).
  useEffect(() => {
    if (!link) { setComments([]); return }
    void supabase
      .from('loto_placard_reviews')
      .select('equipment_id, notes, updated_at')
      .eq('review_link_id', link.id)
      .order('updated_at', { ascending: false })
      .limit(25)
      .then(({ data, error: commentErr }) => {
        if (commentErr) {
          setError(commentErr.message)
          return
        }
        const rows = (data ?? []) as CommentRow[]
        setComments(rows.filter(r => r.notes && r.notes.trim().length > 0))
      })
  }, [link])

  useEffect(() => { void refresh() }, [refresh])

  async function generate() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/review-links', {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          authorization:     `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant': tenantId ?? '',
        },
        body: JSON.stringify({}),
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

  async function patch(id: string, action: 'revoke' | 'regenerate') {
    if (busy) return
    const prompt = action === 'revoke'
      ? 'Retire the public review link? The URL will stop working. You can generate a new one anytime.'
      : 'Regenerate the public link? The current URL will stop working immediately. Anyone you\'ve shared it with will need the new one.'
    if (!confirm(prompt)) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/admin/review-links/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':    'application/json',
          authorization:     `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant': tenantId ?? '',
        },
        body: JSON.stringify({ action }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setToast(action === 'revoke' ? 'Public link retired' : 'New public link generated')
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
          One shareable URL for your whole tenant. Anyone with the link can
          leave anonymous comments on any active placard — no account, no
          sign-in. Same URL appears on every department page.
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

      {link && reviewUrl && (
        <div className="space-y-3">
          <LinkBox
            url={reviewUrl}
            onCopy={() => {
              void navigator.clipboard.writeText(reviewUrl)
              setToast('Link copied to clipboard')
            }}
          />

          <LinkActivity link={link} commentCount={comments.length} />

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={reviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              Open in new tab ↗
            </a>
            <button
              type="button"
              onClick={() => void patch(link.id, 'regenerate')}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
              title="Cycle the URL — any old shared copies will stop working"
            >
              Regenerate link
            </button>
            <button
              type="button"
              onClick={() => void patch(link.id, 'revoke')}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg text-rose-700 hover:bg-rose-50 disabled:opacity-40"
              title="Retire the public link entirely"
            >
              Retire
            </button>
          </div>

          <CommentStream comments={comments} />
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

function LinkActivity({ link, commentCount }: { link: PublicLinkRow; commentCount: number }) {
  const opened = link.first_viewed_at ? `Opened ${formatRelative(link.first_viewed_at)}` : 'Not opened yet'
  const commentLine = commentCount === 0
    ? 'No comments yet'
    : `${commentCount} comment${commentCount === 1 ? '' : 's'}`
  return (
    <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-800/40 dark:text-slate-400 px-3 py-2 rounded-lg">
      {opened} · {commentLine}
    </p>
  )
}

function CommentStream({ comments }: { comments: CommentRow[] }) {
  if (comments.length === 0) return null
  return (
    <div className="border-t border-slate-100 dark:border-slate-800 pt-3 space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
        Recent comments
      </h3>
      <ul className="space-y-2">
        {comments.map((c, i) => (
          <li key={`${c.equipment_id}-${i}`} className="text-xs">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">{c.equipment_id}</span>
              <span className="text-[10px] text-slate-400">{formatRelative(c.updated_at)}</span>
            </div>
            <p className="mt-0.5 text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{c.notes}</p>
          </li>
        ))}
      </ul>
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
