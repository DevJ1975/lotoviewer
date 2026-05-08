'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { BookOpen, Clock, Loader2, ScrollText } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { listManuals, type ManualSummary } from '@/lib/manuals/client'
import ManualSearch from '@/components/manuals/ManualSearch'
import { FEATURES, type FeatureCategory } from '@soteria/core/features'

// /manuals — index of every manual the caller can see, grouped by
// category. Section headings come from the FEATURES registry so any
// new module shows up here as soon as the bootstrap endpoint creates
// a stub for it. If a module has no manual yet, we hide it from this
// list (only the bootstrap endpoint surfaces missing modules to
// superadmins via /superadmin/manuals).

function relative(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

const CATEGORY_LABEL: Record<FeatureCategory, string> = {
  safety:  'Safety modules',
  reports: 'Reports',
  admin:   'Admin & platform',
}

export default function ManualsIndex() {
  const { profile } = useAuth()
  const [manuals, setManuals] = useState<ManualSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const isSuperadmin = profile?.is_superadmin === true

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await listManuals()
        if (!cancelled) setManuals(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Index by module_id for quick lookup.
  const byModule = useMemo(() => {
    const m = new Map<string, ManualSummary>()
    for (const x of manuals) m.set(x.module_id, x)
    return m
  }, [manuals])

  // Module → category lookup, walking parents up to a top-level
  // feature for any feature with no manuals row of its own.
  const moduleToCategory = useMemo(() => {
    const m = new Map<string, FeatureCategory>()
    for (const f of FEATURES) {
      let category = f.category
      let cur: typeof f | undefined = f
      while (cur?.parent) {
        const parent = FEATURES.find(p => p.id === cur!.parent)
        if (!parent) break
        category = parent.category
        cur = parent
      }
      m.set(f.id, category)
    }
    return m
  }, [])

  const grouped = useMemo(() => {
    const g = new Map<FeatureCategory, ManualSummary[]>()
    g.set('safety', [])
    g.set('reports', [])
    g.set('admin', [])
    for (const m of manuals) {
      const cat = moduleToCategory.get(m.module_id) ?? 'admin'
      g.get(cat)!.push(m)
    }
    for (const [, list] of g) list.sort((a, b) => a.title.localeCompare(b.title))
    return g
  }, [manuals, moduleToCategory])

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 inline-flex items-center gap-2">
            <BookOpen className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
            User manuals
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Module-by-module guides. Maintained by the Soteria team. Every change is versioned with a change note.
          </p>
        </div>
        <Link
          href="/manuals/changelog"
          className="inline-flex items-center gap-1.5 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <ScrollText className="h-4 w-4" />
          Master changelog
        </Link>
      </header>

      {error && <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>}

      <ManualSearch />

      {(['safety', 'reports', 'admin'] as FeatureCategory[]).map(cat => {
        const list = grouped.get(cat) ?? []
        if (list.length === 0) return null
        return (
          <section key={cat}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              {CATEGORY_LABEL[cat]}
            </h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {list.map(m => (
                <li key={m.id}>
                  <Link
                    href={`/manuals/${m.module_id}`}
                    className="block rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:border-brand-navy/40 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {m.title}
                          {!m.published_at && (
                            <span className="ml-1.5 inline-block rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200 align-middle">
                              draft
                            </span>
                          )}
                        </h3>
                        {m.summary && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{m.summary}</p>}
                      </div>
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <Clock className="h-3 w-3" />
                      v{m.version} · updated {relative(m.updated_at)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {byModule.size === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No published manuals yet.</p>
          {isSuperadmin && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              POST <code>/api/superadmin/manuals/bootstrap</code> to seed stubs.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
