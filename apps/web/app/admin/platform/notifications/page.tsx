'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Plus, Send, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import type { NotificationSeverity } from '@soteria/core/notificationRouting'

interface Channel { id: string; name: string; type: string; active: boolean }
interface Rule { id: string; event_type: string; min_severity: NotificationSeverity; channel_id: string; active: boolean }

const CHANNEL_TYPES = ['email', 'sms', 'teams'] as const
const SEVERITIES: NotificationSeverity[] = ['info', 'warning', 'critical']

async function authedHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

export default function NotificationsAdminPage() {
  const { tenantId } = useTenant()
  const [channels, setChannels] = useState<Channel[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try {
      const headers = await authedHeaders(tenantId)
      const [cRes, rRes] = await Promise.all([
        fetch('/api/admin/notifications/channels', { headers }),
        fetch('/api/admin/notifications/rules', { headers }),
      ])
      if (!cRes.ok || !rRes.ok) throw new Error('Failed to load')
      setChannels((await cRes.json()).channels ?? [])
      setRules((await rRes.json()).rules ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications config')
    } finally { setLoading(false) }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  async function api(path: string, method: string, body?: unknown) {
    if (!tenantId) return null
    const res = await fetch(path, { method, headers: await authedHeaders(tenantId), body: body ? JSON.stringify(body) : undefined })
    return res
  }

  async function testChannel(id: string) {
    setMsg(null); setError(null)
    const res = await api(`/api/admin/notifications/channels/${id}/test`, 'POST', {})
    if (!res) return
    const json = await res.json().catch(() => ({}))
    if (res.ok && json.result?.sent) setMsg('Test sent.')
    else setError(`Test not sent${json.result?.error ? `: ${json.result.error}` : ''}.`)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
        <Bell className="h-5 w-5" /> Notification channels
      </h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
        Route events to email, SMS, or Microsoft Teams. Rules map an event + minimum severity to a channel.
      </p>

      {error && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">{error}</p>}
      {msg && <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200">{msg}</p>}

      {loading ? (
        <div className="mt-6 h-40 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />
      ) : (
        <div className="mt-6 space-y-8">
          <section>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Channels</h2>
            <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
              {channels.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No channels yet.</li>}
              {channels.map(c => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="text-sm"><span className="font-semibold text-slate-900 dark:text-slate-100">{c.name}</span> <span className="text-xs uppercase text-slate-400">{c.type}</span></span>
                  <span className="flex items-center gap-2">
                    <button onClick={() => testChannel(c.id)} className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/40"><Send className="h-3.5 w-3.5" /> Test</button>
                    <button onClick={async () => { await api(`/api/admin/notifications/channels/${c.id}`, 'DELETE'); load() }} aria-label="Delete channel" className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                </li>
              ))}
            </ul>
            <AddChannel onAdd={async (payload) => { const r = await api('/api/admin/notifications/channels', 'POST', payload); if (r && !r.ok) { const j = await r.json().catch(() => ({})); setError(j.error ?? 'Could not add channel') } else { load() } }} />
          </section>

          <section>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Routing rules</h2>
            <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
              {rules.length === 0 && <li className="px-3 py-3 text-sm text-slate-500">No rules yet.</li>}
              {rules.map(r => {
                const ch = channels.find(c => c.id === r.channel_id)
                return (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                    <span><code className="text-xs">{r.event_type}</code> ≥ <span className="font-semibold">{r.min_severity}</span> → {ch ? ch.name : 'deleted channel'}</span>
                    <button onClick={async () => { await api(`/api/admin/notifications/rules/${r.id}`, 'DELETE'); load() }} aria-label="Delete rule" className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                )
              })}
            </ul>
            {channels.length > 0 && (
              <AddRule channels={channels} onAdd={async (payload) => { const r = await api('/api/admin/notifications/rules', 'POST', payload); if (r && !r.ok) { const j = await r.json().catch(() => ({})); setError(j.error ?? 'Could not add rule') } else { load() } }} />
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function AddChannel({ onAdd }: { onAdd: (p: Record<string, unknown>) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<(typeof CHANNEL_TYPES)[number]>('email')
  const [target, setTarget] = useState('')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const config = type === 'teams' ? { webhook_url: target } : { to: target }
    onAdd({ name, type, config })
    setName(''); setTarget('')
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
      <input required value={name} onChange={e => setName(e.target.value)} placeholder="Channel name"
        className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
      <select value={type} onChange={e => setType(e.target.value as (typeof CHANNEL_TYPES)[number])}
        className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm">
        {CHANNEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input required value={target} onChange={e => setTarget(e.target.value)}
        placeholder={type === 'teams' ? 'Teams webhook URL' : type === 'sms' ? 'Phone number' : 'Email address'}
        className="flex-1 min-w-[12rem] rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
      <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"><Plus className="h-4 w-4" /> Add</button>
    </form>
  )
}

function AddRule({ channels, onAdd }: { channels: Channel[]; onAdd: (p: Record<string, unknown>) => void }) {
  const [eventType, setEventType] = useState('')
  const [minSeverity, setMinSeverity] = useState<NotificationSeverity>('warning')
  const [channelId, setChannelId] = useState(channels[0]?.id ?? '')

  function submit(e: React.FormEvent) {
    e.preventDefault()
    onAdd({ event_type: eventType, min_severity: minSeverity, channel_id: channelId })
    setEventType('')
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
      <input required value={eventType} onChange={e => setEventType(e.target.value)} placeholder="event type (e.g. incident.created)"
        className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
      <select value={minSeverity} onChange={e => setMinSeverity(e.target.value as NotificationSeverity)}
        className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm">
        {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <select value={channelId} onChange={e => setChannelId(e.target.value)}
        className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm">
        {channels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <button type="submit" className="inline-flex items-center gap-1 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"><Plus className="h-4 w-4" /> Add rule</button>
    </form>
  )
}
