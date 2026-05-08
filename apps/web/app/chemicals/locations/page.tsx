'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronRight, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { LOCATION_KINDS, type LocationKind } from '@soteria/core/chemicals'

interface LocationRow {
  id:          string
  parent_id:   string | null
  name:        string
  kind:        LocationKind
  path:        string | null
  notes:       string | null
  archived_at: string | null
  created_at:  string
}

interface TreeNode extends LocationRow {
  children: TreeNode[]
  depth:    number
}

export default function ChemicalsLocationsPage() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<LocationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy]   = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [parentId, setParentId] = useState<string>('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<LocationKind>('room')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const res  = await fetch('/api/chemicals/locations', { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      setRows([])
      return
    }
    setRows(body.locations ?? [])
  }, [tenant, buildHeaders])

  useEffect(() => { void load() }, [load])

  const tree = useMemo<TreeNode[]>(() => {
    if (!rows) return []
    const live = rows.filter(r => !r.archived_at)
    const byId = new Map<string, TreeNode>()
    for (const r of live) byId.set(r.id, { ...r, children: [], depth: 0 })
    const roots: TreeNode[] = []
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        const parent = byId.get(node.parent_id)!
        node.depth = parent.depth + 1
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    }
    const sortRec = (nodes: TreeNode[]) => {
      nodes.sort((a, b) => a.name.localeCompare(b.name))
      nodes.forEach(n => sortRec(n.children))
    }
    sortRec(roots)
    return roots
  }, [rows])

  const flat = useMemo<TreeNode[]>(() => {
    const out: TreeNode[] = []
    const walk = (nodes: TreeNode[]) => {
      for (const n of nodes) { out.push(n); walk(n.children) }
    }
    walk(tree)
    return out
  }, [tree])

  async function add() {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res  = await fetch('/api/chemicals/locations', {
        method:  'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body:    JSON.stringify({
          name: name.trim(),
          kind,
          parent_id: parentId || null,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setName('')
      setShowAdd(false)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function archive(id: string) {
    if (!confirm('Archive this location? Any active containers must be moved or disposed first.')) return
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res  = await fetch(`/api/chemicals/locations/${id}`, { method: 'DELETE', headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Storage locations</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Buildings → rooms → cabinets. Inventory containers attach to a location so reports + emergency-response views can roll up to the right place.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(s => !s)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium"
        >
          <Plus className="w-4 h-4" /> Add location
        </button>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Name</span>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Building A / Wash Bay 2 / Cabinet 3"
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Kind</span>
              <select
                value={kind}
                onChange={e => setKind(e.target.value as LocationKind)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                {LOCATION_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Parent (optional)</span>
              <select
                value={parentId}
                onChange={e => setParentId(e.target.value)}
                className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="">(top-level)</option>
                {flat.map(n => (
                  <option key={n.id} value={n.id}>
                    {'— '.repeat(n.depth)}{n.name} ({n.kind})
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700"
            >Cancel</button>
            <button
              onClick={() => void add()}
              disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add
            </button>
          </div>
        </div>
      )}

      {rows === null ? (
        <div className="flex items-center gap-2 text-slate-500 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      ) : flat.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No locations yet. Add a top-level site or building to get started.
        </div>
      ) : (
        <ul className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
          {flat.map(n => (
            <li key={n.id} className="flex items-center px-3 py-2 gap-2 text-sm">
              <span style={{ paddingLeft: `${n.depth * 18}px` }} className="inline-flex items-center gap-1">
                {n.depth > 0 && <ChevronRight className="w-3 h-3 text-slate-400" />}
                <span className="font-medium text-slate-900 dark:text-slate-100">{n.name}</span>
                <span className="text-xs text-slate-500">· {n.kind}</span>
              </span>
              <span className="ml-auto inline-flex items-center gap-2">
                <span className="text-xs text-slate-500 hidden sm:inline">{n.path}</span>
                <button
                  onClick={() => void archive(n.id)}
                  disabled={busy}
                  className="text-slate-400 hover:text-rose-600 disabled:opacity-50"
                  title="Archive location"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
