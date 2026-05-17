'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/chemicals/prop65/sites — list + add CA facilities.

interface SiteRow {
  id:              string
  name:            string
  city:            string | null
  address:         string | null
  employee_count:  number | null
  public_slug:     string
  created_at:      string
}

async function tenantHeaders(tenantId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const h = new Headers()
  if (session?.access_token) h.set('Authorization', `Bearer ${session.access_token}`)
  h.set('x-active-tenant', tenantId)
  h.set('Content-Type', 'application/json')
  return h
}

export default function Prop65SitesPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [rows, setRows]   = useState<SiteRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm]   = useState({ name: '', address: '', city: '', employee_count: '' })

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const { data, error: err } = await supabase
      .from('prop65_sites')
      .select('id, name, city, address, employee_count, public_slug, created_at')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
    if (err) { setError(formatSupabaseError(err, 'load sites')); return }
    setRows((data ?? []) as SiteRow[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantId || !form.name.trim()) return
    setAdding(true)
    setError(null)
    try {
      const h = await tenantHeaders(tenantId)
      const body = {
        name:           form.name.trim(),
        address:        form.address.trim() || null,
        city:           form.city.trim() || null,
        employee_count: form.employee_count ? Number(form.employee_count) : null,
      }
      const res = await fetch('/api/prop65/sites', { method: 'POST', headers: h, body: JSON.stringify(body) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Create failed')
      setForm({ name: '', address: '', city: '', employee_count: '' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setAdding(false)
    }
  }

  if (authLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  if (!profile?.is_admin) return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/chemicals/prop65" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to Prop 65
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <MapPin className="h-6 w-6 text-brand-navy" /> California sites
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Facilities subject to Title 8 §5194 and §25249.6. Each site gets a public warning URL.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <form onSubmit={submit} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2"><Plus className="h-4 w-4" /> Add site</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Name
            <input className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
              value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">City
            <input className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
              value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300 sm:col-span-2">Address
            <input className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
              value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Employee count
            <input type="number" min="0" className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm"
              value={form.employee_count} onChange={e => setForm({ ...form, employee_count: e.target.value })} />
          </label>
        </div>
        <button type="submit" disabled={adding || !form.name.trim()} className="rounded bg-brand-navy text-white text-sm px-3 py-1.5 disabled:opacity-50">
          {adding ? 'Adding…' : 'Add site'}
        </button>
      </form>

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        {rows === null ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No sites yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Site</th>
                <th className="text-left px-4 py-2">City</th>
                <th className="text-right px-4 py-2">Employees</th>
                <th className="text-left px-4 py-2">Public URL</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-2"><Link href={`/admin/chemicals/prop65/sites/${r.id}`} className="text-brand-navy hover:underline">{r.name}</Link></td>
                  <td className="px-4 py-2">{r.city ?? '—'}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.employee_count ?? '—'}</td>
                  <td className="px-4 py-2 text-[11px] font-mono">/prop65/{r.public_slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
