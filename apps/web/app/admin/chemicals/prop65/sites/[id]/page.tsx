'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, MapPin, FileWarning, ClipboardList, Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'

// /admin/chemicals/prop65/sites/[id] — Per-site detail with three tabs.

interface Site {
  id:             string
  name:           string
  address:        string | null
  city:           string | null
  employee_count: number | null
  public_slug:    string
}

interface Assessment {
  id: string
  assessed_at: string | null
  exposure_route: string
  estimated_daily_intake_mg: number | null
  below_safe_harbor: boolean | null
  signed: boolean
  signed_name: string | null
  signed_at: string | null
  chemical_inventory_id: string
}

interface Warning {
  id: string
  warning_type: string
  harm_endpoint: string
  posted_at: string
  removed_at: string | null
  warning_text: string
  photo_url: string | null
}

interface Notification {
  id: string
  notification_method: string
  notified_at: string
  notes: string | null
}

type Tab = 'assessments' | 'warnings' | 'notifications'

interface PageProps { params: Promise<{ id: string }> }

export default function Prop65SiteDetailPage({ params }: PageProps) {
  const { id } = use(params)
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [site, setSite] = useState<Site | null>(null)
  const [tab, setTab]   = useState<Tab>('assessments')
  const [assessments, setAssessments] = useState<Assessment[] | null>(null)
  const [warnings, setWarnings]       = useState<Warning[] | null>(null)
  const [notifications, setNotifications] = useState<Notification[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const [{ data: s }, { data: a }, { data: w }, { data: n }] = await Promise.all([
      supabase.from('prop65_sites').select('id, name, address, city, employee_count, public_slug').eq('id', id).eq('tenant_id', tenantId).maybeSingle(),
      supabase.from('prop65_exposure_assessments').select('id, assessed_at, exposure_route, estimated_daily_intake_mg, below_safe_harbor, signed, signed_name, signed_at, chemical_inventory_id').eq('site_id', id).eq('tenant_id', tenantId).order('assessed_at', { ascending: false }),
      supabase.from('prop65_warnings').select('id, warning_type, harm_endpoint, posted_at, removed_at, warning_text, photo_url').eq('site_id', id).eq('tenant_id', tenantId).order('posted_at', { ascending: false }),
      supabase.from('prop65_notifications').select('id, notification_method, notified_at, notes').eq('site_id', id).eq('tenant_id', tenantId).order('notified_at', { ascending: false }).limit(50),
    ])
    setSite(s as Site | null)
    setAssessments((a ?? []) as Assessment[])
    setWarnings((w ?? []) as Warning[])
    setNotifications((n ?? []) as Notification[])
  }, [id, tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  async function sign(assessmentId: string) {
    const name = window.prompt('Enter your name to sign this assessment:')
    if (!name?.trim()) return
    if (!tenantId) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/prop65/assessments/${assessmentId}`, {
      method: 'PATCH',
      headers: {
        'Authorization':   session?.access_token ? `Bearer ${session.access_token}` : '',
        'x-active-tenant': tenantId,
        'Content-Type':    'application/json',
      },
      body: JSON.stringify({ signed: true, signed_name: name.trim() }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: 'Sign failed' }))
      setError(j.error || 'Sign failed')
      return
    }
    await load()
  }

  async function removeWarning(warningId: string) {
    if (!window.confirm('Mark this warning sign as removed?')) return
    if (!tenantId) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/prop65/warnings/${warningId}`, {
      method: 'PATCH',
      headers: {
        'Authorization':   session?.access_token ? `Bearer ${session.access_token}` : '',
        'x-active-tenant': tenantId,
        'Content-Type':    'application/json',
      },
      body: JSON.stringify({ remove: true }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: 'Update failed' }))
      setError(j.error || 'Update failed')
      return
    }
    await load()
  }

  if (authLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  if (!profile?.is_admin) return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  if (!site) return <div className="max-w-4xl mx-auto px-4 py-6"><Link href="/admin/chemicals/prop65/sites" className="text-xs text-brand-navy hover:underline">← Back to sites</Link><p className="text-sm text-slate-500 mt-4">Site not found.</p></div>

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/chemicals/prop65/sites" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to sites
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <MapPin className="h-6 w-6 text-brand-navy" /> {site.name}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {[site.address, site.city, 'CA'].filter(Boolean).join(', ')} · /prop65/{site.public_slug}
        </p>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700">
        {(['assessments', 'warnings', 'notifications'] as Tab[]).map(t => (
          <button key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === t ? 'border-brand-navy text-brand-navy' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <Link href={`/admin/chemicals/prop65/assessments/new?siteId=${site.id}`} className="text-xs text-brand-navy hover:underline">+ Assessment</Link>
          <Link href={`/admin/chemicals/prop65/warnings/new?siteId=${site.id}`} className="text-xs text-brand-navy hover:underline">+ Warning</Link>
        </div>
      </div>

      {tab === 'assessments' && (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <ClipboardList className="h-4 w-4" /> <span className="text-sm font-semibold">Exposure assessments</span>
          </div>
          {!assessments || assessments.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No assessments yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="text-left px-4 py-2">Date</th>
                  <th className="text-left px-4 py-2">Route</th>
                  <th className="text-right px-4 py-2">Daily intake (mg)</th>
                  <th className="text-left px-4 py-2">Below safe harbor?</th>
                  <th className="text-left px-4 py-2">Signed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {assessments.map(a => (
                  <tr key={a.id}>
                    <td className="px-4 py-2">{a.assessed_at ?? '—'}</td>
                    <td className="px-4 py-2 capitalize">{a.exposure_route}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{a.estimated_daily_intake_mg ?? '—'}</td>
                    <td className="px-4 py-2">{a.below_safe_harbor === null ? '—' : a.below_safe_harbor ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-2">{a.signed ? `${a.signed_name} (${a.signed_at?.slice(0, 10)})` : '—'}</td>
                    <td className="px-4 py-2 text-right">
                      {!a.signed && <button onClick={() => sign(a.id)} className="text-[11px] text-brand-navy hover:underline">Sign</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'warnings' && (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <FileWarning className="h-4 w-4" /> <span className="text-sm font-semibold">Warnings posted</span>
          </div>
          {!warnings || warnings.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No warnings recorded.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {warnings.map(w => (
                <li key={w.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 capitalize">{w.warning_type.replace('_', ' ')} · {w.harm_endpoint}</p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">Posted {w.posted_at.slice(0, 10)} {w.removed_at && `· removed ${w.removed_at.slice(0, 10)}`}</p>
                    </div>
                    {!w.removed_at && <button onClick={() => removeWarning(w.id)} className="text-[11px] text-rose-700 dark:text-rose-300 hover:underline">Mark removed</button>}
                  </div>
                  <pre className="mt-2 text-[11px] whitespace-pre-wrap text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 rounded p-2">{w.warning_text}</pre>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'notifications' && (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
            <Bell className="h-4 w-4" /> <span className="text-sm font-semibold">Right-to-know notifications</span>
          </div>
          {!notifications || notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No notifications logged.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {notifications.map(n => (
                <li key={n.id} className="px-4 py-2 text-sm">
                  <span className="capitalize font-medium">{n.notification_method.replace('_', ' ')}</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-2">{n.notified_at.slice(0, 10)}</span>
                  {n.notes && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{n.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

