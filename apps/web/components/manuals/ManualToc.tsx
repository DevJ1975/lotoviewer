'use client'

import Link from 'next/link'
import type { ManualToc as Item } from '@/lib/manuals/client'

// Sticky-on-desktop, collapsed-on-mobile table of contents. Built
// server-side (extractToc in lib/manuals/markdown.ts) so the SSR'd
// output already contains the heading anchors the links target.

export default function ManualToc({ items }: { items: Item[] }) {
  if (items.length === 0) return null
  return (
    <nav className="text-sm">
      <p className="text-[11px] uppercase font-semibold tracking-wide text-slate-500 dark:text-slate-400 mb-2">
        Contents
      </p>
      <ul className="space-y-1">
        {items.map(item => (
          <li key={item.slug} style={{ marginLeft: (item.level - 2) * 12 }}>
            <Link
              href={`#${item.slug}`}
              className="block rounded px-2 py-0.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 truncate"
            >
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
