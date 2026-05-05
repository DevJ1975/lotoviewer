'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useDebounce } from '@/hooks/useDebounce'
import StatusBadge from './StatusBadge'
import type { Equipment } from '@soteria/core/types'

type SearchResult = Pick<Equipment, 'equipment_id' | 'description' | 'department' | 'photo_status'>

export default function GlobalSearch() {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen]       = useState(false)
  const [loading, setLoading] = useState(false)
  const debouncedQuery        = useDebounce(query, 300)
  const router                = useRouter()
  const containerRef          = useRef<HTMLDivElement>(null)
  const inputRef              = useRef<HTMLInputElement>(null)

  const reqToken = useRef(0)

  useEffect(() => {
    // Strip chars that would break PostgREST .or() parsing (, ( )) or act as
    // ILIKE wildcards (% _ \). Safer than escaping and preserves most useful input.
    const sanitized = debouncedQuery.replace(/[%_\\,()]/g, ' ').trim()

    if (sanitized.length < 2) {
      setResults([])
      setOpen(false)
      return
    }

    const myReq = ++reqToken.current
    setLoading(true)
    supabase
      .from('loto_equipment')
      .select('equipment_id, description, department, photo_status')
      .or(
        `equipment_id.ilike.%${sanitized}%,` +
        `description.ilike.%${sanitized}%,` +
        `department.ilike.%${sanitized}%`
      )
      .limit(8)
      .then(({ data }) => {
        // Drop stale results if a newer query has fired since
        if (myReq !== reqToken.current) return
        setResults((data as SearchResult[]) ?? [])
        setOpen(true)
        setLoading(false)
      })
  }, [debouncedQuery])

  // Close on outside click
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])

  // Global keyboard shortcuts: ⌘/Ctrl+K, or "/" while not typing in another
  // input. Focuses + selects so the user can immediately type or replace.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMeta = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable
      const isSlash = e.key === '/' && !inEditable
      if (!isMeta && !isSlash) return
      e.preventDefault()
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = useCallback((id: string) => {
    router.push(`/equipment/${encodeURIComponent(id)}`)
    setQuery('')
    setOpen(false)
  }, [router])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
  }

  const showDropdown = open && query.trim().length >= 2

  return (
    <div ref={containerRef} className="relative flex-1 max-w-sm">
      <div className="relative">
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 text-[13px] pointer-events-none">
          🔍
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search equipment…"
          aria-label="Search equipment"
          className="w-full rounded-lg bg-white/10 dark:bg-slate-900/10 border border-white/20 pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand-yellow/40 focus:border-brand-yellow/40 transition-colors"
        />
      </div>

      {showDropdown && (
        <div className="absolute top-full mt-1.5 left-0 right-0 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden z-50 max-h-80 overflow-y-auto">
          {loading && (
            <p className="px-4 py-3 text-sm text-slate-400 dark:text-slate-500">Searching…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400 dark:text-slate-500">No results for &ldquo;{query}&rdquo;</p>
          )}
          {!loading && results.map(r => (
            <button
              key={r.equipment_id}
              onClick={() => navigate(r.equipment_id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-900/40 text-left transition-colors border-b border-slate-50 last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 font-mono">{r.equipment_id}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{r.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-400 dark:text-slate-500 hidden sm:block">{r.department}</span>
                <StatusBadge status={r.photo_status} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
