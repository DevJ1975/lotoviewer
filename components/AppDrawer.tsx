'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { FEATURES, isFeatureAccessible, type FeatureCategory, type FeatureDef } from '@/lib/features'

// Side drawer that hosts every feature in the app. Replaces the inline
// top-nav links so the chrome stays minimal as more modules ship. Reads
// from lib/features.ts — feature.enabled hides an entry; feature.comingSoon
// shows it but disables the click. When multi-tenant lands the registry
// will be hydrated from a tenant_features table; nothing in this component
// changes.

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

export default function AppDrawer({ open, onClose }: Props) {
  const pathname = usePathname()

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

  if (!open) return null

  // Group enabled features by category. Coming-soon items are kept in the
  // list (rendered as disabled) so users see what's planned.
  const groups = CATEGORY_ORDER.map(cat => ({
    category: cat,
    items: FEATURES.filter(f => f.category === cat && f.enabled),
  })).filter(g => g.items.length > 0)

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

      <aside className="relative bg-white w-72 sm:w-80 max-w-[85vw] h-full flex flex-col shadow-2xl">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs bg-brand-yellow text-brand-navy tracking-tight shrink-0">
              SL
            </div>
            <span className="text-slate-900 font-semibold text-sm tracking-tight truncate">
              Soteria <span className="text-brand-navy font-bold tracking-wider">FIELD</span>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md h-9 w-9 flex items-center justify-center transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto py-2">
          {groups.map(({ category, items }) => (
            <section key={category} className="px-2 py-2">
              <h3 className="px-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                {CATEGORY_LABELS[category]}
              </h3>
              <ul className="space-y-0.5">
                {items.map(f => (
                  <DrawerItem key={f.id} feature={f} active={pathname === f.href} onNavigate={onClose} />
                ))}
              </ul>
            </section>
          ))}
        </nav>

        <footer className="px-4 py-3 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
          Manage features in <span className="font-mono">lib/features.ts</span>.
          Multi-tenant overrides will layer on later.
        </footer>
      </aside>
    </div>
  )
}

function DrawerItem({
  feature, active, onNavigate,
}: { feature: FeatureDef; active: boolean; onNavigate: () => void }) {
  // Single source of truth for "is this clickable" — the same predicate a
  // future tenant route guard would use (see lib/features.ts).
  const isClickable = isFeatureAccessible(feature.id)

  const body = (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center justify-between gap-2">
        <span className={`text-[14px] font-semibold ${
          active ? 'text-brand-navy' : feature.comingSoon ? 'text-slate-500' : 'text-slate-900'
        }`}>
          {feature.name}
        </span>
        {feature.comingSoon && (
          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-800">
            Coming Soon
          </span>
        )}
      </span>
      <span className={`text-[11px] leading-snug ${feature.comingSoon ? 'text-slate-400' : 'text-slate-500'}`}>
        {feature.description}
      </span>
    </div>
  )

  if (!isClickable) {
    return (
      <li>
        <div
          aria-disabled="true"
          className="block px-3 py-2.5 rounded-lg cursor-not-allowed opacity-80"
        >
          {body}
        </div>
      </li>
    )
  }

  return (
    <li>
      <Link
        href={feature.href!}
        onClick={onNavigate}
        className={`block px-3 py-2.5 rounded-lg transition-colors ${
          active ? 'bg-brand-navy/5 hover:bg-brand-navy/10' : 'hover:bg-slate-100'
        }`}
      >
        {body}
      </Link>
    </li>
  )
}
