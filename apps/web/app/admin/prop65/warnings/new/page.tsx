'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, Loader2, FileWarning } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import {
  buildLongFormWarning,
  buildShortFormWarning,
  type WarningLanguage,
} from '@soteria/core/prop65WarningText'
import type { Prop65HarmEndpoint } from '@soteria/core/prop65'
import { prop65WarningPhotoPath } from '@soteria/core/storagePaths'

interface Site { id: string; name: string }
interface P65Option {
  id:             string
  chemical_name:  string
  harm_endpoint:  Prop65HarmEndpoint
}

async function tenantHeaders(tenantId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const h = new Headers()
  if (session?.access_token) h.set('Authorization', `Bearer ${session.access_token}`)
  h.set('x-active-tenant', tenantId)
  h.set('Content-Type', 'application/json')
  return h
}

function NewWarningForm() {
  const router = useRouter()
  const params = useSearchParams()
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [sites, setSites]       = useState<Site[]>([])
  const [options, setOptions]   = useState<P65Option[]>([])
  const [siteId, setSiteId]     = useState<string>(params.get('siteId') ?? '')
  const [picked, setPicked]     = useState<Set<string>>(new Set())
  const [warningType, setWarningType] = useState<'long_form' | 'short_form'>('long_form')
  const [language, setLanguage] = useState<WarningLanguage>('en')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    const [{ data: s }, { data: links }] = await Promise.all([
      supabase.from('prop65_sites').select('id, name').eq('tenant_id', tenantId).order('name'),
      supabase.from('prop65_chemical_links')
        .select('prop65_chemicals(id, chemical_name, harm_endpoint)')
        .eq('tenant_id', tenantId).eq('confidence', 'confirmed'),
    ])
    setSites((s ?? []) as Site[])
    const seen = new Set<string>()
    const opts: P65Option[] = []
    const raw = (links ?? []) as unknown as { prop65_chemicals: P65Option | P65Option[] | null }[]
    for (const row of raw) {
      const v = row.prop65_chemicals
      const entries: P65Option[] = Array.isArray(v) ? v : v ? [v] : []
      for (const p of entries) {
        if (!seen.has(p.id)) { seen.add(p.id); opts.push(p) }
      }
    }
    setOptions(opts)
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  const selected = useMemo(() => options.filter(o => picked.has(o.id)), [options, picked])

  const combinedEndpoint: Prop65HarmEndpoint = useMemo(() => {
    let hasCancer = false, hasRepro = false
    for (const s of selected) {
      if (s.harm_endpoint === 'cancer') hasCancer = true
      else if (s.harm_endpoint === 'reproductive') hasRepro = true
      else { hasCancer = true; hasRepro = true }
    }
    if (hasCancer && hasRepro) return 'both'
    if (hasRepro) return 'reproductive'
    return 'cancer'
  }, [selected])

  const warningText = useMemo(() => {
    if (selected.length === 0) return ''
    try {
      const chemicals = selected.map(s => ({ name: s.chemical_name, endpoint: s.harm_endpoint }))
      return warningType === 'long_form'
        ? buildLongFormWarning({ chemicals, language })
        : buildShortFormWarning({ chemicals, language })
    } catch (e) {
      return e instanceof Error ? e.message : ''
    }
  }, [selected, warningType, language])

  async function uploadPhoto(): Promise<string | null> {
    if (!photoFile || !tenantId || !siteId) return null
    const path = prop65WarningPhotoPath(tenantId, siteId)
    const { error } = await supabase.storage.from('loto-photos').upload(path, photoFile, {
      contentType: photoFile.type || 'image/jpeg',
      upsert: false,
    })
    if (error) throw new Error(`Photo upload failed: ${error.message}`)
    return path
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!tenantId || !siteId || selected.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const photoUrl = photoFile ? await uploadPhoto() : null
      const h = await tenantHeaders(tenantId)
      const res = await fetch('/api/prop65/warnings', {
        method: 'POST', headers: h,
        body: JSON.stringify({
          site_id:             siteId,
          prop65_chemical_ids: Array.from(picked),
          warning_type:        warningType,
          harm_endpoint:       combinedEndpoint,
          photo_url:           photoUrl,
          warning_text:        warningText,
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
          <FileWarning className="h-6 w-6 text-brand-navy" /> Record posted warning
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Cal. Code Regs tit. 27 §25602 — pick the listed chemicals named on the sign and upload a photo of the physical posting.</p>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>}

      <form onSubmit={submit} className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">Site
          <select required value={siteId} onChange={e => setSiteId(e.target.value)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
            <option value="">— select —</option>
            {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>

        <fieldset className="text-xs font-medium text-slate-700 dark:text-slate-300">
          <legend className="mb-2">Listed chemicals (confirmed-linked only)</legend>
          {options.length === 0 ? (
            <p className="text-slate-500 dark:text-slate-400 text-xs">No confirmed links yet. Visit <Link href="/admin/prop65/chemicals" className="text-brand-navy hover:underline">Chemicals</Link> to confirm.</p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-auto rounded border border-slate-200 dark:border-slate-700 p-2">
              {options.map(o => (
                <label key={o.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={picked.has(o.id)} onChange={e => {
                    const next = new Set(picked)
                    if (e.target.checked) next.add(o.id); else next.delete(o.id)
                    setPicked(next)
                  }} />
                  <span>{o.chemical_name} <span className="text-slate-500 dark:text-slate-400">({o.harm_endpoint})</span></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Type
            <select value={warningType} onChange={e => setWarningType(e.target.value as 'long_form' | 'short_form')} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
              <option value="long_form">Long form</option>
              <option value="short_form">Short form</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-300">Language
            <select value={language} onChange={e => setLanguage(e.target.value as WarningLanguage)} className="mt-1 block w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-sm">
              <option value="en">English</option>
              <option value="es">Spanish</option>
            </select>
          </label>
        </div>

        <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block">Photo of posted sign
          <input type="file" accept="image/*" onChange={e => setPhotoFile(e.target.files?.[0] ?? null)} className="mt-1 block w-full text-xs" />
        </label>

        {warningText && (
          <div className="rounded-md bg-slate-50 dark:bg-slate-950 px-3 py-2">
            <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Sign text preview</p>
            <pre className="text-xs whitespace-pre-wrap text-slate-700 dark:text-slate-300">{warningText}</pre>
          </div>
        )}

        <button type="submit" disabled={busy || !siteId || selected.length === 0}
          className="rounded bg-brand-navy text-white text-sm px-3 py-1.5 disabled:opacity-50">
          {busy ? 'Saving…' : 'Record warning'}
        </button>
      </form>
    </div>
  )
}

export default function NewWarningPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>}>
      <NewWarningForm />
    </Suspense>
  )
}
