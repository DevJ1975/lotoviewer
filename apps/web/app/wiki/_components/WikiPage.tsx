import Link from 'next/link'
import {
  ArrowLeft, BookOpen, Clock, ExternalLink, ChevronRight,
  CheckCircle2, XCircle, Hash,
} from 'lucide-react'
import type { ReactNode } from 'react'
import WikiToc, { type TocItem } from './WikiToc'
import FaqGroup, { type FaqItem } from './FaqGroup'

// Shared layout for every /wiki/[module] page.
//
// Why a TSX template instead of a markdown CMS:
//   - matches the existing /loto/manual precedent (zero new deps)
//   - lets each page deep-link into the live module with type-checked hrefs
//   - keeps the version + last-updated stamp colocated with the prose so
//     the wiki-sync check (scripts/check-wiki-sync.mjs) can grep them
//
// Update protocol when a page's module changes:
//   1. Edit the relevant Section / Faq / DoDont entries below.
//   2. Bump CURRENT_VERSION + prepend a CHANGELOG row (newest on top).
//   3. The `npm run check:wiki` script (CI + pre-push) will fail the
//      build if the source module was touched without bumping the
//      matching wiki page. Mirror the change here, or pass
//      WIKI_SYNC_SKIP=1 with a justification in the commit body.

export type { FaqItem }
export interface ChangelogEntry {
  version: string
  date:    string
  changes: string[]
}

interface Props {
  /** Display name shown in the page header (e.g. "Hot Work Permits"). */
  title:        string
  /** One-line subtitle under the title. */
  subtitle?:    string
  /** Live module deep link. Pass null for token-only / public portals. */
  modulePath:   string | null
  /** Audience badge. */
  audience:     'live' | 'admin' | 'superadmin' | 'public-token' | 'coming-soon'
  /** Category breadcrumb label, e.g. "Safety". */
  category?:    string
  version:      string
  lastUpdated:  string
  changelog:    ChangelogEntry[]
  /** Sections rendered in the on-page TOC sidebar. */
  toc:          TocItem[]
  children:     ReactNode
}

const AUDIENCE_LABELS: Record<Props['audience'], { label: string; cls: string }> = {
  'live':         { label: 'Live module',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  'admin':        { label: 'Admin only',         cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  'superadmin':   { label: 'Superadmin only',    cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300' },
  'public-token': { label: 'Public (tokenized)', cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300' },
  'coming-soon':  { label: 'Coming soon',        cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400' },
}

export default function WikiPage({
  title, subtitle, modulePath, audience, category,
  version, lastUpdated, changelog, toc, children,
}: Props) {
  const aud = AUDIENCE_LABELS[audience]
  const fullToc: TocItem[] = [...toc, { id: 'changelog', label: 'Changelog' }]

  return (
    <main className="max-w-7xl mx-auto px-4 py-8 text-slate-800 dark:text-slate-100">
      {/* Breadcrumbs */}
      <nav aria-label="Breadcrumb" className="mb-6 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/wiki" className="inline-flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft className="h-3 w-3" /> Wiki
        </Link>
        {category && (
          <>
            <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
            <span>{category}</span>
          </>
        )}
        <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600" />
        <span className="text-slate-700 dark:text-slate-200 font-medium truncate">{title}</span>
      </nav>

      <div className="grid lg:grid-cols-[1fr_14rem] gap-8">
        {/* Main column */}
        <div className="space-y-8 min-w-0">
          <header className="space-y-3 pb-6 border-b border-slate-200 dark:border-slate-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow text-xs font-semibold">
                <BookOpen className="h-3.5 w-3.5" /> User wiki
              </span>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${aud.cls}`}>
                {aud.label}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[11px] font-mono">
                <Clock className="h-3 w-3" />
                v{version} · {lastUpdated}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
              {title}
            </h1>
            {subtitle && (
              <p className="text-base text-slate-600 dark:text-slate-300 max-w-2xl">
                {subtitle}
              </p>
            )}
            {modulePath && (
              <Link
                href={modulePath}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-navy dark:text-brand-yellow hover:underline"
              >
                Open the live module <ExternalLink className="h-3.5 w-3.5" />
                <span className="font-mono text-xs text-slate-400 dark:text-slate-500 ml-1">{modulePath}</span>
              </Link>
            )}
          </header>

          {/* Mobile TOC */}
          <div className="lg:hidden">
            <WikiToc items={fullToc} />
          </div>

          {children}

          <Section id="changelog" title="Changelog">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The version + last-updated stamp at the top of this page maps to
              the topmost entry below. Add a new row when you change module
              behavior or update this wiki page.
            </p>
            <div className="space-y-3 mt-3">
              {changelog.map(entry => (
                <article
                  key={entry.version}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-3"
                >
                  <header className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-brand-navy dark:text-brand-yellow">v{entry.version}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{entry.date}</span>
                  </header>
                  <ul className="mt-2 ml-5 list-disc text-sm space-y-1">
                    {entry.changes.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </Section>

          <footer className="pt-6 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-400 dark:text-slate-500 space-y-1">
            <p>
              Edits welcome via PR. The wiki-sync check (<code className="font-mono">npm run check:wiki</code>)
              fails CI if a module changes without a matching wiki update.
            </p>
            <p>
              Source: <code className="font-mono">apps/web/app/wiki/</code>.
            </p>
          </footer>
        </div>

        {/* Desktop TOC */}
        <WikiToc items={fullToc} />
      </div>
    </main>
  )
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3 group">
      <h2 className="text-xl font-bold tracking-tight border-b border-slate-200 dark:border-slate-800 pb-2 flex items-center gap-2">
        <a
          href={`#${id}`}
          aria-label={`Anchor link to ${title}`}
          className="opacity-0 group-hover:opacity-100 text-slate-300 dark:text-slate-600 hover:text-brand-navy dark:hover:text-brand-yellow transition-opacity -ml-7 pr-1"
        >
          <Hash className="h-5 w-5" />
        </a>
        <span>{title}</span>
      </h2>
      <div className="prose prose-slate dark:prose-invert max-w-none text-sm leading-7 [&>p]:my-2 [&>ul]:my-2 [&>ul]:ml-5 [&>ul]:list-disc [&_a]:underline [&_a]:text-brand-navy dark:[&_a]:text-brand-yellow">
        {children}
      </div>
    </section>
  )
}

export function Faq({ items }: { items: FaqItem[] }) {
  return <FaqGroup items={items} />
}

export function DoDont({ dos, donts }: { dos: string[]; donts: string[] }) {
  return (
    <div className="not-prose grid sm:grid-cols-2 gap-4 mt-3">
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-900/10 p-4">
        <h4 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4" /> Do
        </h4>
        <ul className="text-sm space-y-2 text-emerald-900 dark:text-emerald-200">
          {dos.map((d, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-emerald-500 mt-1.5 h-1 w-1 rounded-full bg-emerald-500 shrink-0" aria-hidden />
              <span className="leading-6">{d}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-900/10 p-4">
        <h4 className="text-sm font-bold text-rose-700 dark:text-rose-400 mb-3 flex items-center gap-1.5">
          <XCircle className="h-4 w-4" /> Don&apos;t
        </h4>
        <ul className="text-sm space-y-2 text-rose-900 dark:text-rose-200">
          {donts.map((d, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="text-rose-500 mt-1.5 h-1 w-1 rounded-full bg-rose-500 shrink-0" aria-hidden />
              <span className="leading-6">{d}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function Related({ items }: { items: { href: string; label: string }[] }) {
  return (
    <ul className="not-prose flex flex-wrap gap-2 mt-3">
      {items.map(item => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-brand-navy hover:text-white dark:hover:bg-brand-yellow dark:hover:text-brand-navy transition-colors"
          >
            {item.label}
            <ChevronRight className="h-3 w-3" />
          </Link>
        </li>
      ))}
    </ul>
  )
}
