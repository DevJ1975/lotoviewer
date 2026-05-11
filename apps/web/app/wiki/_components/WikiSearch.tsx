'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search, ArrowRight, X } from 'lucide-react'
import { WIKI_MANIFEST, WIKI_CATEGORIES, type ManifestEntry } from '../_lib/manifest'

// Client-side search box for the wiki index. Filters the manifest by
// module name + tagline + slug. Categories with zero matches collapse.

const CATEGORY_DOT: Record<ManifestEntry['category'], string> = {
  safety:    'bg-emerald-500',
  reports:   'bg-sky-500',
  admin:     'bg-amber-500',
  workspace: 'bg-violet-500',
  public:    'bg-rose-500',
}

export default function WikiSearch() {
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()

  const filtered = useMemo(() => {
    if (!needle) return WIKI_MANIFEST
    return WIKI_MANIFEST.filter(e =>
      e.module.toLowerCase().includes(needle) ||
      e.tagline.toLowerCase().includes(needle) ||
      e.slug.toLowerCase().includes(needle),
    )
  }, [needle])

  const byCategory = WIKI_CATEGORIES
    .map(cat => ({ ...cat, entries: filtered.filter(e => e.category === cat.id) }))
    .filter(g => g.entries.length > 0)

  return (
    <div className="space-y-8">
      <div className="relative">
        <Search className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={`Search ${WIKI_MANIFEST.length} modules…`}
          aria-label="Search wiki"
          className="w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 pl-11 pr-10 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy dark:focus:border-brand-yellow"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {byCategory.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
          No modules match <span className="font-mono">&quot;{q}&quot;</span>.
        </p>
      )}

      {byCategory.map(cat => (
        <section key={cat.id} id={`cat-${cat.id}`} className="space-y-3 scroll-mt-20">
          <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${CATEGORY_DOT[cat.id]}`} aria-hidden />
              <h2 className="text-lg font-bold tracking-tight">{cat.label}</h2>
              <span className="text-xs text-slate-400 dark:text-slate-500">({cat.entries.length})</span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">{cat.blurb}</p>
          </div>
          <ul className="grid sm:grid-cols-2 gap-3">
            {cat.entries.map(entry => (
              <li key={entry.slug}>
                <Link
                  href={`/wiki/${entry.slug}`}
                  className="group block h-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4 hover:border-brand-navy dark:hover:border-brand-yellow hover:shadow-md hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-brand-navy dark:group-hover:text-brand-yellow transition-colors">
                        {entry.module}
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-5">
                        {entry.tagline}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-brand-navy dark:group-hover:text-brand-yellow group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                  </div>
                  {entry.href && (
                    <div className="mt-3 text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate">
                      {entry.href}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function CategoryNav() {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Jump to category">
      {WIKI_CATEGORIES.map(cat => {
        const count = WIKI_MANIFEST.filter(e => e.category === cat.id).length
        return (
          <a
            key={cat.id}
            href={`#cat-${cat.id}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 text-slate-700 dark:text-slate-300 hover:border-brand-navy hover:text-brand-navy dark:hover:border-brand-yellow dark:hover:text-brand-yellow transition-colors"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${CATEGORY_DOT[cat.id]}`} aria-hidden />
            {cat.label}
            <span className="text-slate-400 dark:text-slate-500">{count}</span>
          </a>
        )
      })}
    </nav>
  )
}
