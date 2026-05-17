'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, CheckCircle2, FlaskConical } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import { findMatchingSafeHarbor } from '@soteria/core/prop65SafeHarbor'

// /admin/chemicals/prop65/chemicals — walk the tenant's chemical_inventory_items
// (joined to chemical_products for CAS numbers) and surface the
// suggested Prop 65 links. Confirm individually or bulk-confirm every
// auto-suggested CAS match at once.

interface InventoryRow {
  id:           string
  product_id:   string
  product_name: string
  cas_numbers:  string[] | null
}

interface LinkRow {
  id:                    string
  chemical_inventory_id: string
  prop65_chemical_id:    string
  confidence:            'auto' | 'confirmed'
}

interface Prop65Row {
  id:            string
  cas_number:    string
  chemical_name: string
}

async function tenantHeaders(tenantId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const h = new Headers()
  if (session?.access_token) h.set('Authorization', `Bearer ${session.access_token}`)
  h.set('x-active-tenant', tenantId)
  h.set('Content-Type', 'application/json')
  return h
}

export default function Prop65ChemicalsPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null)
  const [links, setLinks]         = useState<LinkRow[]>([])
  const [p65, setP65]             = useState<Prop65Row[]>([])
  const [error, setError]         = useState<string | null>(null)
  const [busy, setBusy]           = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const [{ data: items, error: e1 }, { data: linkData, error: e2 }, { data: p65Data, error: e3 }] = await Promise.all([
      supabase.from('chemical_inventory_items')
        .select('id, product_id, chemical_products(name, cas_numbers)')
        .eq('tenant_id', tenantId)
        .limit(500),
      supabase.from('prop65_chemical_links')
        .select('id, chemical_inventory_id, prop65_chemical_id, confidence')
        .eq('tenant_id', tenantId),
      supabase.from('prop65_chemicals').select('id, cas_number, chemical_name'),
    ])
    if (e1 || e2 || e3) { setError(formatSupabaseError(e1 || e2 || e3!, 'load chemical data')); return }
    type RawItem = {
      id: string
      product_id: string
      chemical_products: { name?: string; cas_numbers?: string[] } | { name?: string; cas_numbers?: string[] }[] | null
    }
    const flattened: InventoryRow[] = ((items ?? []) as unknown as RawItem[]).map(row => {
      const p = Array.isArray(row.chemical_products) ? row.chemical_products[0] : row.chemical_products
      return {
        id: row.id,
        product_id: row.product_id,
        product_name: p?.name ?? '(unnamed)',
        cas_numbers: p?.cas_numbers ?? null,
      }
    })
    setInventory(flattened)
    setLinks((linkData ?? []) as LinkRow[])
    setP65((p65Data ?? []) as Prop65Row[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  const p65ByCas = useMemo(() => {
    const m = new Map<string, Prop65Row>()
    for (const r of p65) m.set(r.cas_number, r)
    return m
  }, [p65])

  const linksByItem = useMemo(() => {
    const m = new Map<string, LinkRow[]>()
    for (const l of links) {
      const list = m.get(l.chemical_inventory_id) ?? []
      list.push(l)
      m.set(l.chemical_inventory_id, list)
    }
    return m
  }, [links])

  // Build the suggestion set: items whose CAS lines up with a P65
  // entry but for which no link exists yet.
  const suggestions = useMemo(() => {
    if (!inventory) return []
    const out: { itemId: string; productName: string; p65Id: string; p65Name: string }[] = []
    for (const item of inventory) {
      const existing = new Set((linksByItem.get(item.id) ?? []).map(l => l.prop65_chemical_id))
      const matches  = findMatchingSafeHarbor(item.cas_numbers ?? [])
      for (const m of matches) {
        const p65Row = p65ByCas.get(m.cas_number)
        if (!p65Row) continue
        if (existing.has(p65Row.id)) continue
        out.push({ itemId: item.id, productName: item.product_name, p65Id: p65Row.id, p65Name: p65Row.chemical_name })
      }
    }
    return out
  }, [inventory, linksByItem, p65ByCas])

  async function postLink(invId: string, p65Id: string, confidence: 'auto' | 'confirmed') {
    if (!tenantId) return
    const h = await tenantHeaders(tenantId)
    const res = await fetch('/api/prop65/links', {
      method: 'POST', headers: h,
      body: JSON.stringify({ chemical_inventory_id: invId, prop65_chemical_id: p65Id, confidence }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({ error: 'Link failed' }))
      throw new Error(j.error || 'Link failed')
    }
  }

  async function confirmAll() {
    if (!tenantId || suggestions.length === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const s of suggestions) {
        await postLink(s.itemId, s.p65Id, 'confirmed')
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bulk confirm failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmOne(s: { itemId: string; p65Id: string }) {
    if (!tenantId) return
    setBusy(true)
    setError(null)
    try {
      await postLink(s.itemId, s.p65Id, 'confirmed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  if (!profile?.is_admin) return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/chemicals/prop65" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to Prop 65
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FlaskConical className="h-6 w-6 text-brand-navy" /> Chemical → Prop 65 links
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Map each inventory item to the OEHHA-listed substance it represents.
        </p>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>}

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Auto-suggested links ({suggestions.length})</h2>
          <button onClick={confirmAll} disabled={busy || suggestions.length === 0}
            className="rounded bg-brand-navy text-white text-xs px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> Confirm all
          </button>
        </div>
        {inventory === null ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
        ) : suggestions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No unconfirmed CAS suggestions.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Product</th>
                <th className="text-left px-4 py-2">Suggested Prop 65 entry</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {suggestions.map((s, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2">{s.productName}</td>
                  <td className="px-4 py-2">{s.p65Name}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => confirmOne(s)} disabled={busy} className="text-[11px] text-brand-navy hover:underline">Confirm</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Existing links ({links.length})</h2>
        </div>
        {links.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No links yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2">Product</th>
                <th className="text-left px-4 py-2">Prop 65 entry</th>
                <th className="text-left px-4 py-2">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {links.map(l => {
                const inv = inventory?.find(i => i.id === l.chemical_inventory_id)
                const p65row = p65.find(p => p.id === l.prop65_chemical_id)
                return (
                  <tr key={l.id}>
                    <td className="px-4 py-2">{inv?.product_name ?? '—'}</td>
                    <td className="px-4 py-2">{p65row?.chemical_name ?? '—'}</td>
                    <td className="px-4 py-2 capitalize">{l.confidence}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
