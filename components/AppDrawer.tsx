'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, X } from 'lucide-react'
import {
  getModules,
  getChildren,
  isFeatureAccessible,
  type FeatureCategory,
  type FeatureDef,
} from '@/lib/features'

// Side drawer that hosts every feature in the app. Replaces the inline
// top-nav links so the chrome stays minimal as more modules ship.
//
// Two-level nav: top-level rows are MODULES (LOTO, Confined Spaces, plus
// Coming-Soon advertisements). Modules with children get a chevron toggle
// that expands the children below — same iOS Settings pattern that field
// users already recognize on their iPads. The module name itself is a
// Link to the module's home; tapping the chevron only toggles the group.
//
// Reads from lib/features.ts via getModules() + getChildren(). When
// multi-tenant lands the registry will be hydrated from a tenant_features
// table; nothing in this component changes.

interface Props {
  open:    boolean
  onClose: () => void
}

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  safety:  'Safety',
  reports: 'Reports',
  admin:   'Admin',
}

const CATEGORY_ORDER: FeatureCategory[] = ['safety', 'reports', 'admin']

const EXPANDED_KEY = 'soteria.drawer.expanded'

// Resolve initial expanded state. Defaults: every module that has children
// starts expanded. localStorage overrides if the user has toggled before.
function loadExpanded(): Set<string> {
  const defaults = new Set<string>(
    CATEGORY_ORDER.flatMap(cat =>
      getModules(cat).filter(m => getChildren(m.id).length > 0).map(m => m.id),
    ),
  )
  if (typeof window === 'undefined') return defaults
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw === null) return defaults
    return new Set<string>(JSON.parse(raw))
  } catch {
    return defaults
  }
}

export default function AppDrawer({ open, onClose }: Props) {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded())

  // Close on Esc
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // When the user navigates to a sub-page, auto-expand its module so they
  // can see siblings without remembering to toggle. Only adds — never
  // overrides an explicit collapse on a different module.
  useEffect(() => {
    if (!pathname) return
    const matchingModule = CATEGORY_ORDER
      .flatMap(cat => getModules(cat))
      .find(m => getChildren(m.id).some(c => c.href === pathname))
    if (matchingModule) {
      setExpanded(prev => {
        if (prev.has(matchingModule.id)) return prev
        return new Set([...prev, matchingModule.id])
      })
    }
  }, [pathname])

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])) } catch { /* private mode */ }
      return next
    })
  }

  if (!open) return null

  const groups = CATEGORY_ORDER
    .map(cat => ({ category: cat, modules: getModules(cat) }))
    .filter(g => g.modules.length > 0)

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-label="Apps menu"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />

      <aside className="relative bg-white dark:bg-slate-900 w-72 sm:w-80 max-w-[85vw] h-full flex flex-col shadow-2xl">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs bg-brand-yellow text-brand-navy tracking-tight shrink-0">
              SL
            </div>
            <span className="text-slate-900 dark:text-slate-100 font-semibold text-sm tracking-tight truncate">
              Soteria <span className="text-brand-navy dark:text-brand-yellow font-bold tracking-wider">FIELD</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md h-9 w-9 flex items-center justify-center transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto py-2">
          {groups.map(({ category, modules }) => (
            <section key={category} className="px-2 py-2">
              <h3 className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-1">
                {CATEGORY_LABELS[category]}
              </h3>
              <ul className="space-y-0.5">
                {modules.map(m => (
                  <ModuleRow
                    key={m.id}
                    module={m}
                    expanded={expanded.has(m.id)}
                    onToggleExpand={() => toggleExpand(m.id)}
                    pathname={pathname ?? null}
                    onNavigate={onClose}
                  />
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <footer className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
          Manage features in <span className="font-mono">lib/features.ts</span>.
          Multi-tenant overrides will layer on later.
        </footer>
      </aside>
    </div>
  )
}

// ── Module row + (optional) children ──────────────────────────────────────

function ModuleRow({
  module: mod, expanded, onToggleExpand, pathname, onNavigate,
}: {
  module:         FeatureDef
  expanded:       boolean
  onToggleExpand: () => void
  pathname:       string | null
  onNavigate:     () => void
}) {
  const children = getChildren(mod.id)
  const hasChildren = children.length > 0
  const active = pathname === mod.href
  const isClickable = isFeatureAccessible(mod.id)

  // Module name + chevron live on the same row but are independent tap
  // targets. Both meet the 44pt iPad guideline (the chevron button is
  // 40pt wide × full row height, and the name link is row height tall).
  const nameContent = (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="flex items-center gap-2 flex-wrap">
        <span className={`text-[14px] font-semibold ${
          active ? 'text-brand-navy dark:text-brand-yellow'
          : mod.comingSoon ? 'text-slate-500 dark:text-slate-400'
          : 'text-slate-900 dark:text-slate-100'
        }`}>
          {mod.name}
        </span>
        {mod.comingSoon && (
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
            Coming Soon
          </span>
        )}
      </span>
      <span className={`text-[11px] leading-snug ${mod.comingSoon ? 'text-slate-400 dark:text-slate-500' : 'text-slate-500 dark:text-slate-400'}`}>
        {mod.description}
      </span>
    </div>
  )

  return (
    <li>
      <div className={`flex items-stretch rounded-lg ${
        active ? 'bg-brand-navy/5 dark:bg-brand-navy/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
      } transition-colors`}>
        {isClickable ? (
          <Link
            href={mod.href!}
            onClick={onNavigate}
            className="flex-1 px-3 py-2.5 min-w-0"
          >
            {nameContent}
          </Link>
        ) : (
          <div aria-disabled="true" className="flex-1 px-3 py-2.5 min-w-0 cursor-not-allowed opacity-80">
            {nameContent}
          </div>
        )}

        {hasChildren && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-label={expanded ? `Collapse ${mod.name}` : `Expand ${mod.name}`}
            aria-expanded={expanded}
            className="shrink-0 w-10 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <ul className="mt-0.5 ml-3 pl-3 border-l border-slate-200 dark:border-slate-700 space-y-0.5">
          {children.map(c => <ChildRow key={c.id} child={c} active={pathname === c.href} onNavigate={onNavigate} />)}
        </ul>
      )}
    </li>
  )
}

function ChildRow({ child, active, onNavigate }: { child: FeatureDef; active: boolean; onNavigate: () => void }) {
  const isClickable = isFeatureAccessible(child.id)

  const body = (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-[13px] font-medium ${
        active ? 'text-brand-navy dark:text-brand-yellow font-semibold'
        : child.comingSoon ? 'text-slate-500 dark:text-slate-400'
        : 'text-slate-700 dark:text-slate-200'
      }`}>
        {child.name}
      </span>
      {child.comingSoon && (
        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
          Coming Soon
        </span>
      )}
    </div>
  )

  if (!isClickable) {
    return (
      <li>
        <div aria-disabled="true" className="block px-3 py-2 rounded-lg cursor-not-allowed opacity-80">
          {body}
        </div>
      </li>
    )
  }

  return (
    <li>
      <Link
        href={child.href!}
        onClick={onNavigate}
        className={`block px-3 py-2 rounded-lg transition-colors ${
          active ? 'bg-brand-navy/5 dark:bg-brand-navy/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        {body}
      </Link>
    </li>
  )
}
