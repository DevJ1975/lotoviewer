'use client'

import { useEffect, useState } from 'react'
import { Loader2, Plus, Shield, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import {
  addBoardAccess, listBoardAccess, removeBoardAccess,
  type BoardAccessRow,
} from '@/lib/safetyBoards/client'

// Admin-only editor for per-board access scopes. If the list is empty
// the board is open to any tenant member (default). Adding any row
// narrows access to (role=… OR department=…).
//
// Shown inline in the board header for admins.

const ROLES = ['owner', 'admin', 'member', 'viewer'] as const

interface Props {
  boardId: string
  className?: string
}

export default function BoardAccessEditor({ boardId, className }: Props) {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<BoardAccessRow[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [scopeType, setScopeType] = useState<'role' | 'department'>('role')
  const [roleValue, setRoleValue] = useState<typeof ROLES[number]>('member')
  const [deptValue, setDeptValue] = useState('')

  async function refresh() {
    if (!tenant?.id) return
    setLoading(true)
    try {
      const list = await listBoardAccess(tenant.id, boardId)
      setRows(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh() }, [tenant?.id, boardId])

  async function add() {
    if (!tenant?.id) return
    setBusy(true); setError(null)
    try {
      const value = scopeType === 'role' ? roleValue : deptValue.trim().toLowerCase()
      if (scopeType === 'department' && !value) {
        throw new Error('Department slug required.')
      }
      await addBoardAccess(tenant.id, boardId, { scope_type: scopeType, scope_value: value })
      setDeptValue('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setBusy(false) }
  }

  async function remove(rowId: string) {
    if (!tenant?.id) return
    setError(null)
    try {
      await removeBoardAccess(tenant.id, boardId, rowId)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading) return null

  const label =
    rows.length === 0
      ? 'All tenant members'
      : `${rows.length} access rule${rows.length === 1 ? '' : 's'}`

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
      >
        <Shield className="h-3.5 w-3.5" />
        Access: {label}
      </button>
      {open && (
        <div className="mt-2 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-2 space-y-2">
          {rows.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 italic">
              No restrictions — any tenant member can view + post.
            </p>
          ) : (
            <ul className="space-y-1">
              {rows.map(r => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-xs">
                  <span>
                    <span className="font-mono text-slate-500 dark:text-slate-400">{r.scope_type}</span>
                    {' = '}
                    <span className="font-medium text-slate-700 dark:text-slate-200">{r.scope_value}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void remove(r.id)}
                    className="text-slate-400 hover:text-rose-500"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="text-xs">
              <span className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</span>
              <select
                value={scopeType}
                onChange={e => setScopeType(e.target.value as 'role' | 'department')}
                className="rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-1.5 py-0.5 text-xs"
              >
                <option value="role">role</option>
                <option value="department">department</option>
              </select>
            </label>
            <label className="text-xs flex-1 min-w-[12rem]">
              <span className="block text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">Value</span>
              {scopeType === 'role' ? (
                <select
                  value={roleValue}
                  onChange={e => setRoleValue(e.target.value as typeof ROLES[number])}
                  className="w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-1.5 py-0.5 text-xs"
                >
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : (
                <input
                  value={deptValue}
                  onChange={e => setDeptValue(e.target.value)}
                  placeholder="maintenance"
                  className="w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-1.5 py-0.5 text-xs"
                />
              )}
            </label>
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded bg-brand-navy text-white px-2 py-0.5 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Add
            </button>
          </div>
          {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
        </div>
      )}
    </div>
  )
}
