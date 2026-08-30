'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Search, Library, Plus, ArrowLeft, ExternalLink } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { useDebounce } from '@/hooks/useDebounce'
import { PictogramBadges, SignalWordBadge } from '../_components/PictogramBadges'

interface LibraryRow {
  id:                string
  canonical_name:    string
  manufacturer:      string | null
  product_code:      string | null
  cas_primary:       string | null
  cas_numbers:       string[] | null
  ghs_pictograms:    string[] | null
  ghs_signal_word:   string | null
  source_url:        string | null
  source_host:       string | null
  sds_revision_date: string | null
}

export default function SdsLibraryPage() {
  const { tenant } = useTenant()
  const router = useRouter()
  const [rows, setRows] = useState<LibraryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [adoptingId, setAdoptingId] = useState<string | null>(null)
  const debouncedSearch = useDebounce(search, 250)

  const authHeaders = useCallback(async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const params = new URLSearchParams({ limit: '100' })
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    try {
      const res = await fetch(`/api/chemicals/library?${params.toString()}`, { headers: await authHeaders() })
      const body = await res.json()
      if (!res.ok) { setError(body.error ?? `HTTP ${res.status}`); setRows([]); return }
      setRows(body.chemicals ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setRows([])
    }
  }, [tenant, debouncedSearch, authHeaders])

  useEffect(() => { void load() }, [load])

  const adopt = useCallback(async (row: LibraryRow) => {
    setAdoptingId(row.id)
    // At most two passes: a plain adopt, then a retry with the restricted-list
    // override once the user acknowledges the confirm prompt.
    let override = false
    try {
      for (let pass = 0; pass < 2; pass++) {
        const res = await fetch(`/api/chemicals/library/${row.id}/adopt`, {
          method: 'POST',
          headers: { ...(await authHeaders()), 'content-type': 'application/json' },
          body: JSON.stringify({ override_restricted: override }),
        })
        const body = await res.json()

        if (res.status === 409 && body.requires_override && !override) {
          if (!window.confirm(`${row.canonical_name} is on your restricted list. Adopt it anyway?`)) return
          override = true
          continue
        }
        if (!res.ok) { toast.error(body.error ?? `Adopt failed (HTTP ${res.status})`); return }

        const productId = (body.product as { id?: string } | undefined)?.id
        if (body.deduped) {
          toast.info(`${row.canonical_name} is already in your catalog.`)
        } else if (body.sds_fetch_pending) {
          toast.warning(`Added ${row.canonical_name}, but the SDS couldn't be fetched (${body.sds_fetch_outcome}). Upload it manually.`)
        } else {
          toast.success(`Adopted ${row.canonical_name} with its SDS.`)
        }
        if (productId) router.push(`/chemicals/${productId}`)
        return
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setAdoptingId(null)
    }
  }, [authHeaders, router])

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="space-y-2">
        <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="w-4 h-4" /> Chemicals
        </Link>
        <div className="flex items-center gap-2">
          <Library className="w-6 h-6 text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">SDS Library</h1>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Search the shared catalog of common manufacturing chemicals and adopt one into your tenant.
          Adopting fetches a <strong>fresh copy from the manufacturer</strong> into your own storage — that
          copy is your document of record, so verify its revision date.
        </p>
      </header>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search the library by name, manufacturer, code, or CAS"
          className="w-full pl-9 pr-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
        />
      </div>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          {debouncedSearch
            ? 'No library chemicals match your search.'
            : 'The shared library is empty. A superadmin seeds it from Superadmin → SDS Library.'}
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          {rows.map(row => (
            <li key={row.id} className="px-4 py-3 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{row.canonical_name}</span>
                  {row.manufacturer && <span className="text-xs text-slate-500">· {row.manufacturer}</span>}
                  <SignalWordBadge word={row.ghs_signal_word} />
                  <PictogramBadges pictograms={row.ghs_pictograms ?? []} />
                </div>
                <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-x-3">
                  {row.product_code && <span>Code: {row.product_code}</span>}
                  {row.cas_primary && <span>CAS: {row.cas_primary}</span>}
                  {row.source_host && (
                    <span className="inline-flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> {row.source_host}
                    </span>
                  )}
                  {row.sds_revision_date && <span>SDS rev: {row.sds_revision_date}</span>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void adopt(row)}
                disabled={adoptingId === row.id}
                className="shrink-0 inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-medium"
              >
                {adoptingId === row.id
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Plus className="w-4 h-4" />}
                Adopt
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
