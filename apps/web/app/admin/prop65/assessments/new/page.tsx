'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, ClipboardList } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import {
  PROP65_EXPOSURE_ROUTES,
  PROP65_HARM_ENDPOINTS,
  classifyExposure,
  type Prop65ExposureRoute,
  type Prop65HarmEndpoint,
} from '@soteria/core/prop65'

interface Site { id: string; name: string }
interface InvItem { id: string; product_name: string }
interface LinkedP65 {
  id:            string
  nsrl_mg_day:   number | null
  madl_mg_day:   number | null
  harm_endpoint: Prop65HarmEndpoint
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

function NewAssessmentForm() {
  const router = useRouter()
  const params = useSearchParams()
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [sites, setSites]         = useState<Site[]>([])
  const [items, setItems]         = useState<InvItem[]>([])
  const [linked, setLinked]       = useState<LinkedP65[]>([])
  const [siteId, setSiteId]       = useState<string>(params.get('siteId') ?? '')
  const [itemId, setItemId]       = useState<string>(params.get('chemicalId') ?? '')
  const [route, setRoute]         = useState<Prop65ExposureRoute>('inhalation')
  const [endpoint, setEndpoint]   = useState<Prop65HarmEndpoint>('cancer')
  const [intake, setIntake]       = useState<string>('')
  const [notes, setNotes]         = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    const [{ data: s }, { data: i }] = await Promise.all([
      supabase.from('prop65_sites').select('id, name').eq('tenant_id', tenantId).order('name'),
      supabase.from('chemical_inventory_items')
        .select('id, chemical_products(name)')
        .eq('tenant_id', tenantId).limit(500),
    ])
    setSites((s ?? []) as Site[])
    setItems(((i ?? []) as { id: string; chemical_products: { name?: string } | null }[])
      .map(r => ({ id: r.id, product_name: r.chemical_products?.name ?? '(unnamed)' })))
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  // When the chemical changes, fetch its confirmed P65 links so we can
  // preview the safe-harbor classification live.
  useEffect(() => {
    if (!itemId || !tenantId) { setLinked([]); return }
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('prop65_chemical_links')
        .select('prop65_chemicals(id, nsrl_mg_day, madl_mg_day, harm_endpoint, chemical_name)')
        .eq('tenant_id', tenantId)
        .eq('chemical_inventory_id', itemId)
        .eq('confidence', 'confirmed')
      if (cancelled) return
      // Supabase typegen renders the foreign-table as an array even on
      // a single-row relation; we coerce through `unknown` and then
      // normalize both shapes.
      const raw = (data ?? []) as unknown as { prop65_chemicals: LinkedP65 | LinkedP65[] | null }[]
      const flat: LinkedP65[] = []
      for (const row of raw) {
        const v = row.prop65_chemicals
        if (Array.isArray(v)) flat.push(...v)
        else if (v)           flat.push(v)
      }
      setLinked(flat)
    })()
    return () => { cancelled = true }
  }, [itemId, tenantId])

  const intakeMg = Number(intake)
  const classification = useMemo(() => {
    if (!Number.isFinite(intakeMg) || linked.length === 0) return null
    // Conservative: when multiple P65 entries link, the WORST result wins.
    const results = linked.map(c => classifyExposure(intakeMg, c, endpoint))
    if (results.includes('requires_warning')) return 'requires_warning'
    if (results.includes('unknown'))          return 'unknown'
    return 'below_safe_harbor'
  }, [intakeMg, linked, endpoint])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantId) return
    setBusy(true)
    setError(null)
    try {
      const h = await tenantHeaders(tenantId)
      const res = await fetch('/api/prop65/assessments', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          site_id:                   siteId,
          chemical_inventory_id:     itemId,
          exposure_route:            route,
          estimated_daily_intake_mg: intake ? Number(intake) : null,
          below_safe_harbor:         classification === 'below_safe_harbor' ? true
                                     : classification === 'requires_warning' ? false : null,
          methodology_notes:         notes || null,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Create failed')
      router.push(`/admin/prop65/sites/${siteId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  if (!profile?.is_admin) return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/prop65" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to Prop 65
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-brand-navy" /> New exposure assessment
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Per §25249.6 — document the daily exposure relative to OEHHA's safe-harbor numbers.</p>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>}

      <form onSubmit={submit} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Site
            <select required value={siteId} onChange={e => setSiteId(e.target.value)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
              <option value="">— select —</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Chemical (inventory item)
            <select required value={itemId} onChange={e => setItemId(e.target.value)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
              <option value="">— select —</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.product_name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Exposure route
            <select value={route} onChange={e => setRoute(e.target.value as Prop65ExposureRoute)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
              {PROP65_EXPOSURE_ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Endpoint
            <select value={endpoint} onChange={e => setEndpoint(e.target.value as Prop65HarmEndpoint)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
              {PROP65_HARM_ENDPOINTS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300 sm:col-span-2">Estimated daily intake (mg/day)
            <input type="number" step="any" min="0" value={intake} onChange={e => setIntake(e.target.value)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300 sm:col-span-2">Methodology notes
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm" />
          </label>
        </div>

        {linked.length > 0 && (
          <div className="rounded-md bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
            <p className="font-medium">Linked Prop 65 entries:</p>
            <ul className="list-disc pl-5 mt-1">
              {linked.map(l => (
                <li key={l.id}>
                  {l.chemical_name} — NSRL {l.nsrl_mg_day ?? '—'} mg/d · MADL {l.madl_mg_day ?? '—'} mg/d
                </li>
              ))}
            </ul>
            {classification && (
              <p className={`mt-2 font-semibold ${
                classification === 'below_safe_harbor' ? 'text-emerald-700 dark:text-emerald-300'
                : classification === 'requires_warning' ? 'text-rose-700 dark:text-rose-300'
                : 'text-amber-700 dark:text-amber-300'
              }`}>
                {classification === 'below_safe_harbor' && 'Below safe harbor — no warning required'}
                {classification === 'requires_warning'  && 'Above safe harbor — warning required'}
                {classification === 'unknown'           && 'Safe-harbor value unpublished — fail-safe unknown'}
              </p>
            )}
          </div>
        )}

        <button type="submit" disabled={busy || !siteId || !itemId} className="rounded bg-brand-navy text-white text-sm px-3 py-1.5 disabled:opacity-50">
          {busy ? 'Saving…' : 'Create assessment'}
        </button>
      </form>
    </div>
  )
}

export default function NewAssessmentPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>}>
      <NewAssessmentForm />
    </Suspense>
  )
}
