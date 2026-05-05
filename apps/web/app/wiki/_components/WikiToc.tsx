'use client'

import { useEffect, useState } from 'react'
import { List } from 'lucide-react'

export interface TocItem {
  id:    string
  label: string
}

// Sticky table-of-contents shown on the right side of every wiki module
// page (desktop only). Highlights the section currently in view via
// IntersectionObserver, and on mobile collapses behind a "Sections" toggle.

export default function WikiToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>(items[0]?.id ?? '')
  const [openMobile, setOpenMobile] = useState(false)

  useEffect(() => {
    if (items.length === 0) return
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )
    items.forEach(item => {
      const el = document.getElementById(item.id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [items])

  return (
    <>
      {/* Desktop sticky TOC */}
      <aside
        className="hidden lg:block w-56 shrink-0"
        aria-label="On-page navigation"
      >
        <div className="sticky top-6">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2 px-2">
            On this page
          </p>
          <ul className="space-y-0.5 border-l border-slate-200 dark:border-slate-800">
            {items.map(item => {
              const isActive = item.id === active
              return (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    onClick={() => setActive(item.id)}
                    className={[
                      'block pl-4 pr-2 py-1 text-xs leading-5 -ml-px border-l-2 transition-colors',
                      isActive
                        ? 'border-brand-navy text-brand-navy font-semibold dark:border-brand-yellow dark:text-brand-yellow'
                        : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200',
                    ].join(' ')}
                  >
                    {item.label}
                  </a>
                </li>
              )
            })}
          </ul>
        </div>
      </aside>

      {/* Mobile: collapsible bar pinned under the header */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpenMobile(o => !o)}
          aria-expanded={openMobile}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 text-sm text-slate-700 dark:text-slate-300"
        >
          <span className="inline-flex items-center gap-2 font-semibold">
            <List className="h-4 w-4" /> Sections
          </span>
          <span className="text-xs text-slate-400">{items.length}</span>
        </button>
        {openMobile && (
          <ul className="mt-2 ml-1 space-y-0.5 border-l border-slate-200 dark:border-slate-800">
            {items.map(item => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  onClick={() => setOpenMobile(false)}
                  className="block pl-4 pr-2 py-1.5 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
