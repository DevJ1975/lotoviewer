'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import StatusBadge from '@/components/StatusBadge'
import PhotoUploadZone from '@/components/PhotoUploadZone'
import Toast from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import type { Equipment } from '@/lib/types'

export default function EquipmentDetailPage() {
  const { id }       = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const router       = useRouter()
  const equipmentId  = decodeURIComponent(id)
  const fromUrl      = searchParams.get('from') ?? '/'

  const [equipment, setEquipment]   = useState<Equipment | null>(null)
  const [loading, setLoading]       = useState(true)
  const [notFound, setNotFound]     = useState(false)
  const [prevId, setPrevId]         = useState<string | null>(null)
  const [nextId, setNextId]         = useState<string | null>(null)

  function navTo(targetId: string) {
    router.push(`/equipment/${encodeURIComponent(targetId)}?from=${encodeURIComponent(fromUrl)}`)
  }

  const [description, setDescription]   = useState('')
  const [notes, setNotes]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [dirty, setDirty]               = useState(false)

  const { toast, showToast, clearToast } = useToast()

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('loto_equipment')
      .select('*')
      .eq('equipment_id', equipmentId)
      .single()

    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const eq = data as Equipment
    setEquipment(eq)
    setDescription(eq.description ?? '')
    setNotes(eq.notes ?? '')

    // Fetch the full ordered list for this department to compute prev/next
    const { data: siblings } = await supabase
      .from('loto_equipment')
      .select('equipment_id')
      .eq('department', eq.department)
      .order('equipment_id', { ascending: true })

    if (siblings) {
      const ids = siblings.map((r: { equipment_id: string }) => r.equipment_id)
      const idx = ids.indexOf(equipmentId)
      setPrevId(idx > 0 ? ids[idx - 1] : null)
      setNextId(idx < ids.length - 1 ? ids[idx + 1] : null)
    }

    setLoading(false)
  }, [equipmentId])

  useEffect(() => { load() }, [load])

  // Track edits
  useEffect(() => {
    if (!equipment) return
    setDirty(description !== equipment.description || notes !== (equipment.notes ?? ''))
  }, [description, notes, equipment])

  async function handleSave() {
    if (!equipment) return
    setSaving(true)
    const { error } = await supabase
      .from('loto_equipment')
      .update({ description, notes, updated_at: new Date().toISOString() })
      .eq('equipment_id', equipmentId)

    if (error) {
      showToast('Failed to save changes.', 'error')
    } else {
      setEquipment(prev => prev ? { ...prev, description, notes } : prev)
      setDirty(false)
      showToast('Changes saved.', 'success')
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        Loading…
      </div>
    )
  }

  if (notFound || !equipment) {
    return (
      <div className="text-center py-24">
        <p className="text-slate-500 text-lg font-medium mb-4">Equipment not found</p>
        <Link href="/" className="text-brand-navy text-sm font-semibold hover:underline">← Back to Dashboard</Link>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Breadcrumb + prev/next nav */}
      <div className="flex items-center justify-between gap-4">
        <nav className="flex items-center gap-2 text-sm text-slate-400">
          <Link href="/" className="hover:text-slate-600 transition-colors">Dashboard</Link>
          <span>/</span>
          <Link href={fromUrl} className="hover:text-slate-600 transition-colors">{equipment.department}</Link>
          <span>/</span>
          <span className="text-slate-700 font-medium font-mono">{equipmentId}</span>
        </nav>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => prevId && navTo(prevId)}
            disabled={!prevId}
            title={prevId ? `Previous: ${prevId}` : 'No previous'}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← {prevId ?? ''}
          </button>
          <button
            type="button"
            onClick={() => nextId && navTo(nextId)}
            disabled={!nextId}
            title={nextId ? `Next: ${nextId}` : 'No next'}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-600 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {nextId ?? ''} →
          </button>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-slate-900 font-mono">{equipmentId}</h1>
            <StatusBadge status={equipment.photo_status} />
          </div>
          <p className="text-sm text-slate-500">{equipment.department}</p>
        </div>
        {equipment.placard_url && (
          <a
            href={equipment.placard_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-navy border border-brand-navy/30 rounded-lg px-3 py-2 hover:bg-brand-navy/5 transition-colors whitespace-nowrap"
          >
            📄 View Placard PDF
          </a>
        )}
      </div>

      {/* Editable fields */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Details</h2>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600" htmlFor="description">Description</label>
          <input
            id="description"
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-slate-600" htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-4 text-xs text-slate-400">
            {equipment.verified && (
              <span className="flex items-center gap-1 text-emerald-600 font-medium">
                <span>✓</span> Verified{equipment.verified_by ? ` by ${equipment.verified_by}` : ''}
                {equipment.verified_date ? ` on ${new Date(equipment.verified_date).toLocaleDateString()}` : ''}
              </span>
            )}
            {equipment.updated_at && (
              <span>Updated {new Date(equipment.updated_at).toLocaleDateString()}</span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Photo upload zones */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-5">Photos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <PhotoUploadZone
            equipmentId={equipmentId}
            type="EQUIP"
            label="Equipment Photo"
            existingUrl={equipment.equip_photo_url}
            onSuccess={() => showToast('Equipment photo saved.', 'success')}
          />
          <PhotoUploadZone
            equipmentId={equipmentId}
            type="ISO"
            label="Isolation/Disconnect Photo"
            existingUrl={equipment.iso_photo_url}
            onSuccess={() => showToast('Isolation photo saved.', 'success')}
          />
        </div>
      </div>

      {toast && <Toast {...toast} onClose={clearToast} />}
    </div>
  )
}
