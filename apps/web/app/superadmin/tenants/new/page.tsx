'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type FormEvent } from 'react'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import { getModules, type FeatureCategory, type FeatureDef } from '@/lib/features'

// Create a new tenant. Submits to /api/superadmin/tenants which uses
// requireSuperadmin() for both the env-allowlist check and the DB-flag
// check, then inserts via supabaseAdmin so RLS doesn't get in the way.
//
// The slug auto-derives from the name as the user types but stays
// editable so corner cases ("Acme Corp Inc." → "acme") can be cleaned up.
// Modules render as one checkbox per top-level entry from lib/features.ts;
// children inherit, coming-soon entries don't appear.

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  safety:  'Safety',
  reports: 'Reports',
  admin:   'Admin',
}
const CATEGORY_ORDER: FeatureCategory[] = ['safety', 'reports', 'admin']

// Defaults match what most tenants will want — full safety stack on, the
// expensive analytics off. Superadmin can tick more before submit.
const DEFAULT_MODULES: Record<string, boolean> = {
  loto:                       true,
  'confined-spaces':          true,
  'hot-work':                 true,
  'reports-scorecard':        true,
  'reports-compliance-bundle':true,
  'reports-inspector':        true,
  'admin-configuration':      true,
  'settings-notifications':   true,
  'support':                  true,
}

function deriveSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036F]/g, '')  // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

export default function NewTenantPage() {
  const router = useRouter()

  const [name,    setName]    = useState('')
  const [slug,    setSlug]    = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [isDemo,  setIsDemo]  = useState(false)
  const [modules, setModules] = useState<Record<string, boolean>>(() => ({ ...DEFAULT_MODULES }))
  const [submitting, setSubmitting] = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Module catalog grouped by category, top-level only, no Coming-Soon.
  const groups = useMemo(
    () => CATEGORY_ORDER.map(cat => ({
      category: cat,
      label:    CATEGORY_LABELS[cat],
      modules:  getModules(cat).filter(m => !m.comingSoon),
    })).filter(g => g.modules.length > 0),
    [],
  )

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) setSlug(deriveSlug(value))
  }

  function toggleModule(id: string) {
    setModules(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedName = name.trim()
    if (trimmedName.length < 1) { setError('Name is required'); return }
    if (!SLUG_RE.test(slug)) {
      setError('Slug must be lowercase letters, digits, and hyphens (3–64 chars, no leading/trailing hyphen)')
      return
    }

    setSubmitting(true)
    const result = await superadminJson<{ tenant: { tenant_number: string } }>(
      '/api/superadmin/tenants',
      {
        method: 'POST',
        body:   JSON.stringify({ name: trimmedName, slug, is_demo: isDemo, modules }),
      },
    )
    if (!result.ok || !result.body) {
      setError(result.error ?? 'Request failed')
      setSubmitting(false)
      return
    }
    router.push(`/superadmin/tenants/${result.body.tenant.tenant_number}`)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <Link
        href="/superadmin/tenants"
        className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All tenants
      </Link>

      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">
          Superadmin
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
          New tenant
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          The 4-digit number is allocated automatically by the database.
          Owner invites go out from the tenant detail page after creation.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
            Tenant name
          </label>
          <input
            id="name"
            type="text"
            required
            maxLength={200}
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            placeholder="Acme Refining"
            className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
          />
        </div>

        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
            Slug
          </label>
          <input
            id="slug"
            type="text"
            required
            maxLength={64}
            value={slug}
            onChange={e => { setSlug(e.target.value.toLowerCase()); setSlugTouched(true) }}
            placeholder="acme-refining"
            className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            URL-safe identifier used in support tickets and audit logs.
            Auto-derived from name; edit if needed.
          </p>
        </div>

        <div className="flex items-start gap-2">
          <input
            id="is_demo"
            type="checkbox"
            checked={isDemo}
            onChange={e => setIsDemo(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy"
          />
          <label htmlFor="is_demo" className="text-sm text-slate-700 dark:text-slate-200">
            <span className="font-medium">Demo tenant</span>
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              Eligible for the &quot;Reset Demo&quot; button. Status defaults to <span className="font-mono">trial</span>.
            </span>
          </label>
        </div>

        <fieldset>
          <legend className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
            Modules
          </legend>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Top-level modules. Children inherit their parent&apos;s setting.
          </p>
          <div className="space-y-5">
            {groups.map(g => (
              <div key={g.category}>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
                  {g.label}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {g.modules.map(m => (
                    <ModuleCheckbox
                      key={m.id}
                      module={m}
                      checked={modules[m.id] === true}
                      onToggle={() => toggleModule(m.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {error && (
          <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Link
            href="/superadmin/tenants"
            className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Creating…' : 'Create tenant'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ModuleCheckbox({
  module: m, checked, onToggle,
}: { module: FeatureDef; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-start gap-2 p-2 rounded-md border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{m.name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{m.description}</div>
      </div>
    </label>
  )
}
