'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import StatusBadge from '@/components/StatusBadge'

export default function PrintQueuePage() {
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

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

  function toggleOne(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filtered.map(e => e.equipment_id)))
    }
  }

  function printSelected() {
    for (const eq of equipment) {
      if (selected.has(eq.equipment_id) && eq.placard_url) {
        window.open(eq.placard_url, '_blank')
      }
    }
  }

  async function downloadAll() {
    const targets = equipment.filter(e => selected.has(e.equipment_id) && e.placard_url)
    for (const eq of targets) {
      try {
        const res = await fetch(eq.placard_url!)
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${eq.equipment_id}-placard.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } catch {
        window.open(eq.placard_url!, '_blank')
      }
    }
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(e => selected.has(e.equipment_id))
  const someSelected = selected.size > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Print Queue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {equipment.length} placards ready · {selected.size} selected
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={printSelected}
            disabled={!someSelected}
          >
            Print Selected ({selected.size})
          </Button>
          <Button
            onClick={downloadAll}
            disabled={!someSelected}
            className="bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            Download All ({selected.size})
          </Button>
        </div>
      </div>

      <input
        type="text"
        placeholder="Search by ID or description…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full sm:max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

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
              <TableHead>Placard</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-gray-400">
                  No placards found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map(eq => (
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
                      className="rounded"
                    />
                  </TableCell>
                  <TableCell className="font-mono text-sm font-medium">{eq.equipment_id}</TableCell>
                  <TableCell className="text-sm">{eq.description}</TableCell>
                  <TableCell className="text-sm text-gray-600">{eq.department}</TableCell>
                  <TableCell><StatusBadge status={eq.photo_status} /></TableCell>
                  <TableCell>
                    <a
                      href={eq.placard_url!}
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
    </div>
  )
}
