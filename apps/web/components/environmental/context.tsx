'use client'

import Link from 'next/link'
import { useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { BookOpen, ChevronDown, Info, MapPin } from 'lucide-react'
import { useFacility } from '@/components/FacilityProvider'
import { cn } from '@/lib/utils'
import { getHowTo } from '@soteria/core/environmental/howTo'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import type { SiteDetail } from '@/lib/environmental/client'
import { CitationList, DraftBadge } from './badges'

// Context that frames every environmental screen: which part of the suite you
// are in, which jurisdiction's rules you are looking at, and how to use the page.

const TABS = [
  { href: '/environmental/compliance',            label: 'Overview',       exact: true },
  { href: '/environmental/compliance/calendar',   label: 'Calendar' },
  { href: '/environmental/compliance/checklists', label: 'Checklists' },
  { href: '/environmental/compliance/legal',      label: 'Legal register' },
  { href: '/environmental/compliance/permits',    label: 'Permits' },
  { href: '/environmental/compliance/outfalls',   label: 'Outfalls' },
] as const

export function EnvironmentalTabs() {
  const pathname = usePathname()
  return (
    <nav aria-label="Environmental compliance" className="-mx-1 flex gap-1 overflow-x-auto px-1">
      {TABS.map(tab => {
        const active = 'exact' in tab ? pathname === tab.href : pathname.startsWith(tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? 'bg-brand-navy text-white dark:bg-brand-yellow dark:text-slate-900'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}

/**
 * Says which jurisdiction's rules are showing. When the site has no state, or a
 * state the library does not cover, the screen is the federal baseline only, and
 * that is stated plainly rather than implied.
 */
export function JurisdictionBanner({ site }: { site: SiteDetail | null }) {
  if (!site) return null
  const label = site.jurisdiction.chain.map(j => (j === 'federal' ? 'Federal' : j)).join(' + ')
  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-2">
        <MapPin className="h-4 w-4 text-slate-500" />
        <span className="font-semibold text-slate-900 dark:text-slate-100">{site.facility.name}</span>
        <span className="text-slate-500">·</span>
        <span className="text-slate-700 dark:text-slate-300">{label}</span>
        <DraftBadge packs={site.packs} className="ml-auto" />
      </div>
      {site.notice && (
        <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{site.notice}</span>
        </p>
      )}
    </div>
  )
}

/** Shown when the all-sites roll-up is selected on a screen that works on one site. */
export function SiteRequired({ children }: { children?: ReactNode }) {
  const { available, switchFacility } = useFacility()
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
      <p className="font-semibold">Choose a site</p>
      <p className="mt-1">{children ?? 'This screen works on one site at a time, because the rules that apply depend on the site. Pick one to continue.'}</p>
      {available.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {available.map(f => (
            <button
              key={f.id}
              type="button"
              onClick={() => switchFacility(f.id)}
              className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
            >
              {f.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The how-to for a screen, from the same library that drives the content, so the
 * instructions and the rules cannot disagree. Closed unless `defaultOpen`: whether
 * a reader has seen it before is not something this component can know.
 */
export function HowToPanel({ pageKey, state, defaultOpen = false }: { pageKey: string; state: string | null; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const guides = getHowTo(pageKey, libraryForState(state).library)
  if (guides.length === 0) return null

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/60 dark:border-sky-900 dark:bg-sky-950/20">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold text-sky-900 dark:text-sky-200"
      >
        <BookOpen className="h-4 w-4" /> How to use this page
        <ChevronDown className={cn('ml-auto h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-sky-200 px-3 py-3 text-sm text-slate-700 dark:border-sky-900 dark:text-slate-300">
          {guides.map(guide => (
            <article key={guide.id} className="space-y-2">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{guide.title}</h3>
              <ol className="list-decimal space-y-1 pl-5">
                {guide.quickSteps.map(step => <li key={step}>{step}</li>)}
              </ol>
              {guide.sections.map(section => (
                <details key={section.id} className="rounded-md border border-sky-200 bg-white p-2 dark:border-sky-900 dark:bg-slate-900">
                  <summary className="cursor-pointer text-sm font-medium">{section.title}</summary>
                  <div className="mt-2 space-y-2">
                    {section.paragraphs.map(p => <p key={p}>{p}</p>)}
                    {section.bullets && <ul className="list-disc space-y-1 pl-5">{section.bullets.map(b => <li key={b}>{b}</li>)}</ul>}
                    {section.citations && <CitationList citations={section.citations} />}
                  </div>
                </details>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
