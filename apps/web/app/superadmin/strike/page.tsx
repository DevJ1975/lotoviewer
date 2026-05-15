'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, ArrowLeft, BookOpenCheck, ClipboardCheck, Clock, FileVideo,
  Loader2, Plus, RefreshCw, Sparkles,
} from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import type {
  StrikeStudioModuleRow,
  StrikeStudioRequestRow,
  StrikeStudioResponse,
  StrikeStudioTenantRow,
} from '@/app/api/superadmin/strike/route'

type Scope = 'global' | 'tenant'

const STATUS_STYLES: Record<string, string> = {
  draft:      'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  in_review: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  archived:  'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
  superseded: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  requested: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  scoping:   'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  scheduled: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  filming:   'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  editing:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  review:    'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
  delivered: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',
}

export default function StrikeStudioPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tenants, setTenants] = useState<StrikeStudioTenantRow[]>([])
  const [modules, setModules] = useState<StrikeStudioModuleRow[]>([])
  const [requests, setRequests] = useState<StrikeStudioRequestRow[]>([])

  const [showNew, setShowNew] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [scope, setScope] = useState<Scope>('global')
  const [tenantId, setTenantId] = useState('')
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [category, setCategory] = useState('')
  const [estimatedMinutes, setEstimatedMinutes] = useState('10')
  const [tags, setTags] = useState('')
  const [description, setDescription] = useState('')
  const [transcript, setTranscript] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const result = await superadminJson<StrikeStudioResponse>(
      '/api/superadmin/strike',
      { method: 'GET' },
    )
    if (!result.ok || !result.body) {
      setError(result.error ?? 'Could not load STRIKE Studio')
      setLoading(false)
      return
    }
    setTenants(result.body.tenants)
    setModules(result.body.modules)
    setRequests(result.body.requests)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const stats = useMemo(() => {
    const published = modules.filter(m => m.status === 'published').length
    const drafts = modules.filter(m => m.status === 'draft' || m.status === 'in_review').length
    const openRequests = requests.filter(r => !['delivered', 'cancelled'].includes(r.status)).length
    return { published, drafts, openRequests }
  }, [modules, requests])

  async function createModule() {
    if (creating) return
    setCreateError(null)
    if (!title.trim()) {
      setCreateError('Title is required.')
      return
    }
    if (scope === 'tenant' && !tenantId) {
      setCreateError('Pick a tenant for tenant-scoped modules.')
      return
    }

    setCreating(true)
    const result = await superadminJson<{ module: StrikeStudioModuleRow }>(
      '/api/superadmin/strike',
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          slug,
          library_scope: scope,
          tenant_id: scope === 'tenant' ? tenantId : null,
          description,
          category,
          estimated_minutes: estimatedMinutes,
          tags,
          transcript,
        }),
      },
    )
    setCreating(false)
    if (!result.ok) {
      setCreateError(result.error ?? 'Could not create STRIKE module')
      return
    }

    setShowNew(false)
    setTitle('')
    setSlug('')
    setCategory('')
    setEstimatedMinutes('10')
    setTags('')
    setDescription('')
    setTranscript('')
    await load()
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow mt-1" aria-label="Back to superadmin home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <BookOpenCheck className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              STRIKE Studio
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-3xl">
              Create global or tenant-specific microlearning modules, review production requests, and monitor the STRIKE training library.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowNew(v => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New module
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
            className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Metric label="Published modules" value={stats.published} icon={<Sparkles className="h-4 w-4" />} />
        <Metric label="Drafts and reviews" value={stats.drafts} icon={<FileVideo className="h-4 w-4" />} />
        <Metric label="Open studio requests" value={stats.openRequests} icon={<Clock className="h-4 w-4" />} />
      </section>

      {showNew && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Create STRIKE module</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              This creates a draft module and version 1 shell. Publish controls can build on the same Studio route.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="block md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Title</span>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                placeholder="Arc flash refresher"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Slug</span>
              <input
                value={slug}
                onChange={e => setSlug(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                placeholder="auto"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Minutes</span>
              <input
                type="number"
                min={1}
                max={60}
                value={estimatedMinutes}
                onChange={e => setEstimatedMinutes(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Scope</span>
              <select
                value={scope}
                onChange={e => setScope(e.target.value as Scope)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              >
                <option value="global">Global library</option>
                <option value="tenant">Tenant custom</option>
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tenant</span>
              <select
                value={tenantId}
                onChange={e => setTenantId(e.target.value)}
                disabled={scope === 'global'}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
              >
                <option value="">Select tenant</option>
                {tenants.map(tenant => (
                  <option key={tenant.id} value={tenant.id}>
                    #{tenant.tenant_number} - {tenant.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Category</span>
              <input
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                placeholder="Electrical"
              />
            </label>
            <label className="block md:col-span-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tags</span>
              <input
                value={tags}
                onChange={e => setTags(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                placeholder="ppe, loto, electrical"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
              <textarea
                rows={4}
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Initial transcript</span>
              <textarea
                rows={4}
                value={transcript}
                onChange={e => setTranscript(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
          </div>

          {createError && <p className="text-xs text-rose-700 dark:text-rose-300">{createError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowNew(false); setCreateError(null) }}
              disabled={creating}
              className="px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createModule()}
              disabled={creating}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create draft
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <section className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Training library</h2>
            </div>
            {modules.length === 0 ? (
              <EmptyState>No STRIKE modules have been created yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {modules.map(module => (
                  <li key={module.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{module.title}</h3>
                          <StatusPill status={module.status} />
                          <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {module.library_scope === 'global' ? 'Global' : module.tenant_name ?? 'Tenant'}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          <span className="font-mono">{module.slug}</span>
                          {module.category ? ` - ${module.category}` : ''}
                          {module.estimated_minutes ? ` - ${module.estimated_minutes} min` : ''}
                        </p>
                        {module.description && (
                          <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 line-clamp-2">{module.description}</p>
                        )}
                      </div>
                      <div className="text-right text-xs text-slate-500 dark:text-slate-400 shrink-0">
                        <div>{module.versions_count} version{module.versions_count === 1 ? '' : 's'}</div>
                        <div className="mt-1">{module.latest_version ? `v${module.latest_version.version_number}` : 'No version'}</div>
                        <Link
                          href={`/superadmin/strike/${module.id}/quiz`}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-semibold text-brand-navy hover:bg-slate-50 dark:text-brand-yellow dark:hover:bg-slate-800"
                        >
                          <ClipboardCheck className="h-3 w-3" />
                          Edit quiz
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Studio requests</h2>
            </div>
            {requests.length === 0 ? (
              <EmptyState>No studio requests yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {requests.slice(0, 12).map(request => (
                  <li key={request.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{request.title}</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {request.tenant_name ?? 'Unknown tenant'} - {request.request_type.replaceAll('_', ' ')}
                        </p>
                      </div>
                      <StatusPill status={request.status} />
                    </div>
                    {request.task_description && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-2 line-clamp-3">{request.task_description}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <span className="text-brand-navy dark:text-brand-yellow">{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-semibold text-slate-900 dark:text-slate-100 mt-2">{value}</div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full font-semibold ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}>
      {status.replaceAll('_', ' ')}
    </span>
  )
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="p-6 text-sm text-slate-500 dark:text-slate-400 italic">
      {children}
    </div>
  )
}
