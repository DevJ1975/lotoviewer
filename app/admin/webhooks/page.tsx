'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Webhook, Loader2, Trash2, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type { WebhookEvent, WebhookSubscription } from '@/lib/types'

// Outbound webhook management. Admin-only at the route level (RLS in
// migration 013 also enforces admin on the table itself, so even direct
// SQL from a non-admin would fail).
//
// Today: list, add, toggle active, delete. No edit-in-place — to update a
// URL or rotate a secret, delete and recreate. Test-fire is a follow-up
// (would need an RPC that calls fire_webhooks with a synthetic payload).

const ALL_EVENTS: { id: WebhookEvent; label: string; hint: string }[] = [
  // Confined Space events (migration 013)
  { id: 'permit.created',         label: 'CS permit created',         hint: 'A new confined-space permit row was inserted' },
  { id: 'permit.signed',          label: 'CS permit signed',          hint: 'Entry supervisor signed — entry authorized' },
  { id: 'permit.canceled',        label: 'CS permit canceled',        hint: 'Confined-space permit closed (any reason)' },
  { id: 'test.recorded',          label: 'Atmospheric test recorded', hint: 'Atmospheric reading saved' },
  { id: 'test.failed',            label: 'Atmospheric test failed',   hint: 'Reading exceeded OSHA-default thresholds' },
  // Hot Work events (migration 020)
  { id: 'hot_work.created',       label: 'Hot work permit created',   hint: 'A new hot-work permit row was inserted' },
  { id: 'hot_work.signed',        label: 'Hot work permit signed',    hint: 'PAI signed — work authorized' },
  { id: 'hot_work.work_complete', label: 'Hot work — work complete',  hint: 'Supervisor marked work done; post-watch timer started' },
  { id: 'hot_work.canceled',      label: 'Hot work permit canceled',  hint: 'Hot-work permit closed (any reason)' },
  { id: 'hot_work.fire_observed', label: 'Hot work — FIRE OBSERVED',  hint: 'Emergency cancel — fire was observed during or after work' },
]

export default function WebhooksPage() {
  const { profile, loading: authLoading } = useAuth()
  const [rows, setRows] = useState<WebhookSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('loto_webhook_subscriptions')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      setLoadError(error.message)
      setRows([])
    } else {
      setRows((data ?? []) as WebhookSubscription[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    load()
  }, [authLoading, profile, load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  async function toggleActive(row: WebhookSubscription) {
    const { data, error } = await supabase
      .from('loto_webhook_subscriptions')
      .update({ active: !row.active, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single()
    if (error || !data) { setLoadError(error?.message ?? 'Could not update.'); return }
    setRows(prev => prev.map(r => r.id === row.id ? (data as WebhookSubscription) : r))
  }

  async function remove(row: WebhookSubscription) {
    if (!confirm(`Delete webhook "${row.name}"? Events will stop firing immediately.`)) return
    const { error } = await supabase
      .from('loto_webhook_subscriptions')
      .delete()
      .eq('id', row.id)
    if (error) { setLoadError(error.message); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Webhook className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            Webhooks
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Outbound HTTP POST on permit and atmospheric-test lifecycle events. Pipe into Slack, Teams, or your BI stack.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add webhook
        </button>
      </header>

      {loadError && (
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{loadError}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : rows.length === 0 ? (
        <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-6 text-center space-y-1">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No webhooks configured.</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Add one to start receiving permit + test events at a URL of your choice.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => (
            <li key={row.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{row.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono break-all">{row.url}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleActive(row)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                      row.active
                        ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-200'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {row.active ? 'Active' : 'Paused'}
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    aria-label={`Delete ${row.name}`}
                    className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors p-1"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {row.events.length === 0 ? (
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 italic">No events selected — nothing will fire.</span>
                ) : (
                  row.events.map(ev => (
                    <span key={ev} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded text-[10px] font-mono">
                      {ev}
                    </span>
                  ))
                )}
              </div>
              {row.secret && (
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Signed — payloads include <span className="font-mono">X-Soteria-Signature</span> (HMAC-SHA256).
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {addOpen && (
        <AddWebhookDialog
          onClose={() => setAddOpen(false)}
          onAdded={(row) => {
            setRows(prev => [row, ...prev])
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ── Add dialog ─────────────────────────────────────────────────────────────

function AddWebhookDialog({
  onClose, onAdded,
}: {
  onClose: () => void
  onAdded: (row: WebhookSubscription) => void
}) {
  const [name, setName]     = useState('')
  const [url, setUrl]       = useState('')
  const [secret, setSecret] = useState('')
  const [events, setEvents] = useState<Set<WebhookEvent>>(new Set(['permit.signed', 'permit.canceled', 'test.failed']))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  function toggleEvent(ev: WebhookEvent) {
    const next = new Set(events)
    if (next.has(ev)) next.delete(ev); else next.add(ev)
    setEvents(next)
  }

  async function handleSubmit() {
    setError(null)
    if (!name.trim() || !url.trim() || events.size === 0) {
      setError('Name, URL, and at least one event are required.')
      return
    }
    if (!/^https?:\/\//i.test(url.trim())) {
      setError('URL must start with http:// or https://')
      return
    }
    setSubmitting(true)
    const { data, error: err } = await supabase
      .from('loto_webhook_subscriptions')
      .insert({
        name:   name.trim(),
        url:    url.trim(),
        secret: secret.trim() || null,
        events: [...events],
        active: true,
      })
      .select('*')
      .single()
    setSubmitting(false)
    if (err || !data) { setError(err?.message ?? 'Could not create webhook.'); return }
    onAdded(data as WebhookSubscription)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 overflow-y-auto py-10">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add webhook</h2>
          <button type="button" onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none px-1" aria-label="Close">×</button>
        </header>

        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Name</span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Slack #safety-alerts"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">URL</span>
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Shared secret <span className="text-slate-400 dark:text-slate-500 font-normal">(optional — enables HMAC-SHA256 signing)</span>
            </span>
            <input
              type="text"
              value={secret}
              onChange={e => setSecret(e.target.value)}
              placeholder="leave blank to send unsigned"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-slate-600 dark:text-slate-300">Events</legend>
            <div className="space-y-1">
              {ALL_EVENTS.map(ev => (
                <label key={ev.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-900/40 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={events.has(ev.id)}
                    onChange={() => toggleEvent(ev.id)}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-xs font-mono">{ev.id}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">{ev.hint}</p>
                  </div>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {error && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {submitting ? 'Adding…' : 'Add webhook'}
          </button>
        </div>
      </div>
    </div>
  )
}
