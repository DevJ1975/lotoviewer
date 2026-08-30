'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight } from 'lucide-react'

import { breadcrumbsFor } from '@/lib/breadcrumbs'

// Renders the ancestor trail for the current route. Client-only because it
// reads the pathname; kept out of PageHeader so PageHeader itself stays
// usable from a server component.
//
// Renders nothing on module homes and on any route whose ancestors are all
// uncatalogued — an empty <nav> landmark is worse than no landmark.

export function Breadcrumbs() {
  const pathname = usePathname()
  const crumbs = breadcrumbsFor(pathname ?? '')
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="mb-1">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        {crumbs.map((crumb, i) => (
          <li key={`${crumb.label}-${i}`} className="flex items-center gap-x-1.5">
            {i > 0 && (
              <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 text-slate-400 dark:text-slate-600" />
            )}
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="placard-label text-[10px] text-slate-500 hover:text-brand-navy hover:underline dark:text-slate-400 dark:hover:text-brand-yellow"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="placard-label text-[10px] text-slate-400 dark:text-slate-500">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
