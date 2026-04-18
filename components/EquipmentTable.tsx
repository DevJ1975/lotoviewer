'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import StatusBadge from './StatusBadge'
import type { Equipment } from '@/lib/types'

type Filter  = 'all' | 'missing' | 'partial' | 'complete'
type SortKey = 'equipment_id' | 'description' | 'photo_status'

const PAGE_SIZE = 25

interface Props {
  equipment: Equipment[]
}

function exportCsv(rows: Equipment[]) {
  const headers = ['Equipment ID', 'Description', 'Department', 'Status', 'Equipment Photo', 'ISO Photo', 'Placard URL']
  const escape  = (v: string) => `"${v.replace(/"/g, '""')}"`
  const body    = rows.map(e => [
    e.equipment_id,
    e.description,
    e.department,
    e.photo_status,
    e.has_equip_photo ? 'Yes' : 'No',
    e.has_iso_photo   ? 'Yes' : 'No',
    e.placard_url ?? '',
  ].map(escape).join(','))

  const csv  = [headers.map(escape).join(','), ...body].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `equipment-${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function EquipmentTable({ equipment }: Props) {
  const [filter, setFilter]   = useState<Filter>('all')
  const [search, setSearch]   = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('equipment_id')
  const [sortAsc, setSortAsc] = useState(true)
  const [page, setPage]       = useState(1)

  const filtered = useMemo(() => {
    let rows = equipment
    if (filter !== 'all') rows = rows.filter(e => e.photo_status === filter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(e =>
        e.equipment_id.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      )
    }
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
    return rows
  }, [equipment, filter, search, sortKey, sortAsc])

  // Reset to page 1 whenever the filtered set changes
  useEffect(() => { setPage(1) }, [filter, search, sortKey, sortAsc])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pagedRows  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc(p => !p)
    else { setSortKey(key); setSortAsc(true) }
  }

  function sortIcon(k: SortKey) {
    return sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ' ↕'
  }

  const filterBtns: { label: string; value: Filter }[] = [
    { label: 'All',      value: 'all' },
    { label: 'Missing',  value: 'missing' },
    { label: 'Partial',  value: 'partial' },
    { label: 'Complete', value: 'complete' },
  ]

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Search by ID or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
        />
        <div className="flex gap-2 flex-wrap">
          {filterBtns.map(b => (
            <Button
              key={b.value}
              variant={filter === b.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(b.value)}
            >
              {b.label}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportCsv(filtered)}
            title="Export current view as CSV"
          >
            ↓ CSV
          </Button>
        </div>
      </div>

      <p className="text-xs text-slate-400 font-medium">
        {filtered.length} {filtered.length === 1 ? 'item' : 'items'}
        {totalPages > 1 && ` · page ${page} of ${totalPages}`}
      </p>

      {/* Table */}
      <div className="rounded-xl border border-slate-100 overflow-x-auto bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50/80">
              <TableHead
                className="cursor-pointer select-none whitespace-nowrap"
                onClick={() => toggleSort('equipment_id')}
              >
                Equipment ID{sortIcon('equipment_id')}
              </TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort('description')}
              >
                Description{sortIcon('description')}
              </TableHead>
              <TableHead
                className="cursor-pointer select-none"
                onClick={() => toggleSort('photo_status')}
              >
                Status{sortIcon('photo_status')}
              </TableHead>
              <TableHead>Photos</TableHead>
              <TableHead>Placard</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-gray-400">
                  No equipment found.
                </TableCell>
              </TableRow>
            ) : (
              pagedRows.map(eq => {
                const from = `/departments/${encodeURIComponent(eq.department)}`
                const href = `/equipment/${encodeURIComponent(eq.equipment_id)}?from=${encodeURIComponent(from)}`
                return (
                  <TableRow key={eq.equipment_id} className="hover:bg-slate-50">
                    <TableCell className="font-mono text-sm font-medium">
                      <Link href={href} className="text-brand-navy hover:underline">
                        {eq.equipment_id}
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm">{eq.description}</TableCell>
                    <TableCell><StatusBadge status={eq.photo_status} /></TableCell>
                    <TableCell>
                      <span className="text-xs text-gray-500">
                        {[eq.has_equip_photo && 'Equipment', eq.has_iso_photo && 'ISO']
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {eq.placard_url ? (
                        <a
                          href={eq.placard_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline text-sm"
                        >
                          View PDF
                        </a>
                      ) : (
                        <span className="text-gray-300 text-sm">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(1)}
              disabled={page === 1}
            >
              «
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p - 1)}
              disabled={page === 1}
            >
              ‹
            </Button>
            <span className="text-xs text-slate-500 px-2 tabular-nums">{page} / {totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page === totalPages}
            >
              ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
            >
              »
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
