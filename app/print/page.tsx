'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import StatusBadge from '@/components/StatusBadge'

const PAGE_SIZE = 25

export default function PrintQueuePage() {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<Set<string>>(new Set())
  const [search, setSearch]       = useState('')
  const [page, setPage]           = useState(1)
  const [groupByDept, setGroupByDept] = useState(false)
  const [merging, setMerging]     = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('loto_equipment')
      .select('*')
      .not('placard_url', 'is', null)
      .order('department')
      .then(({ data }) => {
        if (data) setEquipment(data as Equipment[])
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return equipment
    const q = search.toLowerCase()
    return equipment.filter(
      e => e.equipment_id.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    )
  }, [equipment, search])

  const totalPages        = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pagedRows         = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selected.has(e.equipment_id))
  const someSelected      = selected.size > 0

  // Group by department for the grouped view
  const departments = useMemo(() => {
    const map = new Map<string, Equipment[]>()
    for (const eq of filtered) {
      const list = map.get(eq.department) ?? []
      list.push(eq)
      map.set(eq.department, list)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [filtered])

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (allFilteredSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(e => e.equipment_id)))
    }
  }

  function toggleDept(eqs: Equipment[]) {
    const ids  = eqs.map(e => e.equipment_id)
    const allOn = ids.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      ids.forEach(id => allOn ? next.delete(id) : next.add(id))
      return next
    })
  }

  function openSelected() {
    for (const eq of equipment) {
      if (selected.has(eq.equipment_id)) {
        const url = eq.signed_placard_url ?? eq.placard_url
        if (url) window.open(url, '_blank')
      }
    }
  }

  async function downloadSelected() {
    const { mergePdfs, downloadPdf } = await import('@/lib/pdfUtils')
    const urls = equipment
      .filter(e => selected.has(e.equipment_id))
      .map(e => e.signed_placard_url ?? e.placard_url)
      .filter(Boolean) as string[]
    if (!urls.length) return
    const bytes = await mergePdfs(urls)
    downloadPdf(bytes, 'selected-placards.pdf')
  }

  async function downloadDepartment(dept: string, eqs: Equipment[]) {
    setMerging(dept)
    try {
      const { mergePdfs, downloadPdf } = await import('@/lib/pdfUtils')
      const urls = eqs.map(e => e.signed_placard_url ?? e.placard_url).filter(Boolean) as string[]
      const bytes = await mergePdfs(urls)
      downloadPdf(bytes, `${dept}-placards.pdf`)
    } finally {
      setMerging(null)
    }
  }

  function placardUrl(eq: Equipment) {
    return eq.signed_placard_url ?? eq.placard_url
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Print Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {equipment.length} placards ready · {selected.size} selected
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={openSelected} disabled={!someSelected}>
            Print Selected ({selected.size})
          </Button>
          <Button
            onClick={downloadSelected}
            disabled={!someSelected}
            className="bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            Download Selected ({selected.size})
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search by ID or description…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="flex-1 min-w-[200px] sm:max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={() => setGroupByDept(v => !v)}
          className={`px-3 py-2 rounded-md text-sm font-medium border transition-colors ${
            groupByDept
              ? 'bg-brand-navy text-white border-brand-navy'
              : 'border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          Group by Department
        </button>
      </div>

      {groupByDept ? (
        // ── Department grouped view ──────────────────────────────────────────
        <div className="space-y-6">
          {departments.map(([dept, eqs]) => {
            const deptAllSelected = eqs.every(e => selected.has(e.equipment_id))
            return (
              <div key={dept} className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={deptAllSelected}
                      onChange={() => toggleDept(eqs)}
                      className="rounded"
                      aria-label={`Select all in ${dept}`}
                    />
                    <span className="font-semibold text-sm text-gray-800">{dept}</span>
                    <span className="text-xs text-gray-400">{eqs.length} placard{eqs.length !== 1 ? 's' : ''}</span>
                    {eqs.some(e => e.signed_placard_url) && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                        Signed
                      </span>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => downloadDepartment(dept, eqs)}
                    disabled={merging === dept}
                    className="text-xs h-7 px-3"
                  >
                    {merging === dept ? 'Merging…' : 'Download Dept PDF'}
                  </Button>
                </div>
                <Table>
                  <TableBody>
                    {eqs.map(eq => (
                      <TableRow
                        key={eq.equipment_id}
                        className={`hover:bg-gray-50 cursor-pointer ${selected.has(eq.equipment_id) ? 'bg-blue-50' : ''}`}
                        onClick={() => toggleOne(eq.equipment_id)}
                      >
                        <TableCell className="w-10" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(eq.equipment_id)}
                            onChange={() => toggleOne(eq.equipment_id)}
                            aria-label={`Select ${eq.equipment_id}`}
                            className="rounded"
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm font-medium">{eq.equipment_id}</TableCell>
                        <TableCell className="text-sm">{eq.description}</TableCell>
                        <TableCell><StatusBadge status={eq.photo_status} /></TableCell>
                        <TableCell>
                          {eq.signed_placard_url
                            ? <span className="text-[11px] font-semibold text-emerald-700">✓ Signed</span>
                            : <span className="text-[11px] text-gray-400">Unsigned</span>
                          }
                        </TableCell>
                        <TableCell>
                          <a
                            href={placardUrl(eq)!}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="text-blue-600 hover:underline text-sm"
                          >
                            View PDF
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          })}
        </div>
      ) : (
        // ── Flat list view ───────────────────────────────────────────────────
        <>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAll}
                      className="rounded"
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Equipment ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Signed</TableHead>
                  <TableHead>Placard</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-gray-400">
                      No placards found.
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedRows.map(eq => (
                    <TableRow
                      key={eq.equipment_id}
                      className={`hover:bg-gray-50 cursor-pointer ${selected.has(eq.equipment_id) ? 'bg-blue-50' : ''}`}
                      onClick={() => toggleOne(eq.equipment_id)}
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(eq.equipment_id)}
                          onChange={() => toggleOne(eq.equipment_id)}
                          aria-label={`Select ${eq.equipment_id}`}
                          className="rounded"
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm font-medium">{eq.equipment_id}</TableCell>
                      <TableCell className="text-sm">{eq.description}</TableCell>
                      <TableCell className="text-sm text-gray-600">{eq.department}</TableCell>
                      <TableCell><StatusBadge status={eq.photo_status} /></TableCell>
                      <TableCell>
                        {eq.signed_placard_url
                          ? <span className="text-[11px] font-semibold text-emerald-700">✓ Signed</span>
                          : <span className="text-[11px] text-gray-400">—</span>
                        }
                      </TableCell>
                      <TableCell>
                        <a
                          href={placardUrl(eq)!}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-blue-600 hover:underline text-sm"
                        >
                          View PDF
                        </a>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1.5 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
