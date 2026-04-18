'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useDebounce } from '@/hooks/useDebounce'
import StatusBadge from './StatusBadge'
import type { Equipment } from '@/lib/types'

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

  useEffect(() => {
    if (debouncedQuery.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    supabase
      .from('loto_equipment')
      .select('equipment_id, description, department, photo_status')
      .or(
        `equipment_id.ilike.%${debouncedQuery}%,` +
        `description.ilike.%${debouncedQuery}%,` +
        `department.ilike.%${debouncedQuery}%`
      )
      .limit(8)
      .then(({ data }) => {
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
          className="w-full rounded-lg bg-white/10 border border-white/20 pl-8 pr-3 py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-brand-yellow/40 focus:border-brand-yellow/40 transition-colors"
        />
      </div>

      {showDropdown && (
        <div className="absolute top-full mt-1.5 left-0 right-0 bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden z-50 max-h-80 overflow-y-auto">
          {loading && (
            <p className="px-4 py-3 text-sm text-slate-400">Searching…</p>
          )}
          {!loading && results.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">No results for &ldquo;{query}&rdquo;</p>
          )}
          {!loading && results.map(r => (
            <button
              key={r.equipment_id}
              onClick={() => navigate(r.equipment_id)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left transition-colors border-b border-slate-50 last:border-0"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 font-mono">{r.equipment_id}</p>
                <p className="text-xs text-slate-500 truncate">{r.description}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-400 hidden sm:block">{r.department}</span>
                <StatusBadge status={r.photo_status} />
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
