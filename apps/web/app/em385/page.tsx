'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle, Plus, FileArchive } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { em385Headers } from './_components/client'
import type { Em385ProjectRow } from '@soteria/core/em385'

// /em385 — EM-385 Compliance home. Lists the tenant's USACE contracts with a
// quick status roll-up, and links into each contract's compliance dashboard.

export default function Em385ProjectsPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const [projects, setProjects] = useState<Em385ProjectRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!tenantId) return
    setError(null)
    try {
      const headers = await em385Headers(tenantId)
      if (!headers || signal?.aborted) return
      const res = await fetch('/api/em385/projects', { headers, signal })
      const body = await res.json()
      if (signal?.aborted) return
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setProjects((body.projects ?? []) as Em385ProjectRow[])
    } catch (e) {
      if (signal?.aborted) return
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenantId])

  // Abort the in-flight request on unmount / tenant change so a late response
  // can't setState on a dead component or clobber newer data.
  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [load])

  const counts = useMemo(() => {
    const c = { active: 0, closed: 0, archived: 0 }
    for (const p of projects ?? []) c[p.status]++
    return c
  }, [projects])

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">EM-385 Compliance</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track the documents and records EM 385-1-1 requires, per USACE contract.
          </p>
        </div>
        <Link
          href="/em385/new"
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" />
          New Contract
        </Link>
      </header>

      <section className="grid grid-cols-3 gap-3">
        <CountTile label="Active"   count={counts.active} />
        <CountTile label="Closed"   count={counts.closed} />
        <CountTile label="Archived" count={counts.archived} />
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {projects === null && !error && (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      )}

      {projects && projects.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <FileArchive className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No contracts yet.</p>
          <Link href="/em385/new" className="mt-3 inline-block text-sm font-medium text-brand-navy hover:underline">
            Register the first contract →
          </Link>
        </div>
      )}

      {projects && projects.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-3 py-2 text-left">Contract #</th>
                <th className="px-3 py-2 text-left">Title</th>
                <th className="px-3 py-2 text-left">Edition</th>
                <th className="px-3 py-2 text-left">Prime</th>
                <th className="px-3 py-2 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
              {projects.map(p => (
                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                  <td className="px-3 py-2 font-mono text-xs text-slate-700 dark:text-slate-300">
                    <Link href={`/em385/${p.id}`} className="hover:underline">{p.contract_number}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                    <Link href={`/em385/${p.id}`} className="hover:underline">{p.title}</Link>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.edition}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.prime_contractor ?? '—'}</td>
                  <td className="px-3 py-2 capitalize text-slate-700 dark:text-slate-300">{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CountTile({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{count}</p>
    </div>
  )
}
