'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import StatusBadge from '@/components/StatusBadge'
import PhotoUploadZone from '@/components/PhotoUploadZone'
import Toast from '@/components/Toast'
import { useToast } from '@/hooks/useToast'
import type { Equipment } from '@/lib/types'
import type { LotoAssistResponse } from '@/app/api/assist-loto/route'

// ── Types ────────────────────────────────────────────────────────────────────

type LotoFields = {
  energy_tag:          string
  iso_description:     string
  iso_procedure:       string
  lockout_device:      string
  verification_method: string
}

const LOTO_FIELD_LABELS: Record<keyof LotoFields, string> = {
  energy_tag:          'Energy Tag',
  iso_description:     'ISO Description',
  iso_procedure:       'ISO Procedure',
  lockout_device:      'Lockout Device',
  verification_method: 'Method of Verification',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toForm(eq: Equipment): LotoFields {
  return {
    energy_tag:          eq.energy_tag          ?? '',
    iso_description:     eq.iso_description     ?? '',
    iso_procedure:       eq.iso_procedure       ?? '',
    lockout_device:      eq.lockout_device       ?? '',
    verification_method: eq.verification_method ?? '',
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EquipmentDetailPage() {
  const { id }        = useParams<{ id: string }>()
  const equipmentId   = decodeURIComponent(id)

  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const [loading, setLoading]     = useState(true)
  const [notFound, setNotFound]   = useState(false)

  // Basic fields
  const [description, setDescription] = useState('')
  const [notes, setNotes]             = useState('')

  // LOTO fields
  const [loto, setLoto]               = useState<LotoFields>({ energy_tag: '', iso_description: '', iso_procedure: '', lockout_device: '', verification_method: '' })

  const [saving, setSaving]           = useState(false)
  const [dirty, setDirty]             = useState(false)

  // AI assist state
  const [assisting, setAssisting]       = useState<keyof LotoFields | 'all' | null>(null)
  const [suggestions, setSuggestions]   = useState<Partial<LotoAssistResponse> | null>(null)

  const { toast, showToast, clearToast } = useToast()
  const equipRef = useRef(equipment)
  equipRef.current = equipment

  const load = useCallback(async () => {
    if (!equipmentId) return
    const { data, error } = await supabase
      .from('loto_equipment')
      .select('*')
      .eq('equipment_id', equipmentId)
      .single()

    if (error || !data) {
      setNotFound(true)
    } else {
      const eq = data as Equipment
      setEquipment(eq)
      setDescription(eq.description ?? '')
      setNotes(eq.notes ?? '')
      setLoto(toForm(eq))
    }
    setLoading(false)
  }, [equipmentId])

  useEffect(() => { load() }, [load])

  // Dirty tracking
  useEffect(() => {
    if (!equipment) return
    const baseDirty  = description !== equipment.description || notes !== (equipment.notes ?? '')
    const lotoDirty  = (Object.keys(loto) as (keyof LotoFields)[]).some(
      k => loto[k] !== (equipment[k] ?? '')
    )
    setDirty(baseDirty || lotoDirty)
  }, [description, notes, loto, equipment])

  async function handleSave() {
    if (!equipment) return
    setSaving(true)
    const { error } = await supabase
      .from('loto_equipment')
      .update({
        description,
        notes: notes || null,
        energy_tag:          loto.energy_tag          || null,
        iso_description:     loto.iso_description     || null,
        iso_procedure:       loto.iso_procedure       || null,
        lockout_device:      loto.lockout_device      || null,
        verification_method: loto.verification_method || null,
        updated_at: new Date().toISOString(),
      })
      .eq('equipment_id', equipmentId)

    if (error) {
      showToast('Failed to save changes.', 'error')
    } else {
      setEquipment(prev => prev ? { ...prev, description, notes, ...loto } : prev)
      setDirty(false)
      showToast('Changes saved.', 'success')
    }
    setSaving(false)
  }

  async function handleAiAssist(field?: keyof LotoFields) {
    if (!equipment) return
    const target = field ?? 'all'
    setAssisting(target)
    setSuggestions(null)
    try {
      const res  = await fetch('/api/assist-loto', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId,
          description,
          department: equipment.department,
          ...loto,
          field: field ?? undefined,
        }),
      })
      const json = await res.json() as LotoAssistResponse | { error: string }
      if ('error' in json) throw new Error(json.error)
      setSuggestions(field ? { [field]: json[field] } : json)
    } catch {
      showToast('AI assist failed. Please try again.', 'error')
    } finally {
      setAssisting(null)
    }
  }

  function acceptSuggestion(field: keyof LotoFields) {
    if (!suggestions?.[field]) return
    setLoto(prev => ({ ...prev, [field]: suggestions[field]! }))
    setSuggestions(prev => {
      if (!prev) return null
      const next = { ...prev }
      delete next[field]
      return Object.keys(next).length ? next : null
    })
  }

  function acceptAllSuggestions() {
    if (!suggestions) return
    setLoto(prev => ({ ...prev, ...suggestions }))
    setSuggestions(null)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return <div className="flex items-center justify-center h-48 text-slate-400 text-sm">Loading…</div>
  }

  if (notFound || !equipment) {
    return (
      <div className="text-center py-24">
        <p className="text-slate-500 text-lg font-medium mb-4">Equipment not found</p>
        <Link href="/" className="text-brand-navy text-sm font-semibold hover:underline">← Back to Dashboard</Link>
      </div>
    )
  }

  const lotoFields: (keyof LotoFields)[] = ['energy_tag', 'iso_description', 'iso_procedure', 'lockout_device', 'verification_method']
  const isMultiline = (f: keyof LotoFields) => f === 'iso_procedure' || f === 'iso_description' || f === 'verification_method'

  return (
    <div className="space-y-8 max-w-4xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-400">
        <Link href="/" className="hover:text-slate-600 transition-colors">Dashboard</Link>
        <span>/</span>
        <Link href={`/departments/${encodeURIComponent(equipment.department)}`} className="hover:text-slate-600 transition-colors">{equipment.department}</Link>
        <span>/</span>
        <span className="text-slate-700 font-medium font-mono">{equipmentId}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-slate-900 font-mono">{equipmentId}</h1>
            <StatusBadge status={equipment.photo_status} />
          </div>
          <p className="text-sm text-slate-500">{equipment.department}</p>
        </div>
        <div className="flex items-center gap-2">
          {(equipment.signed_placard_url || equipment.placard_url) && (
            <a
              href={equipment.signed_placard_url ?? equipment.placard_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-navy border border-brand-navy/30 rounded-lg px-3 py-2 hover:bg-brand-navy/5 transition-colors whitespace-nowrap"
            >
              📄 {equipment.signed_placard_url ? 'Signed Placard' : 'View Placard'}
            </a>
          )}
        </div>
      </div>

      {/* Basic details */}
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
            rows={2}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
          />
        </div>

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
      </div>

      {/* Energy & Lockout section */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Energy & Lockout</h2>
          <button
            type="button"
            onClick={() => handleAiAssist()}
            disabled={assisting !== null}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 disabled:opacity-50 transition-colors"
          >
            {assisting === 'all' ? (
              <><span className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin inline-block" /> Generating…</>
            ) : (
              <>✦ AI Assist All</>
            )}
          </button>
        </div>

        {/* Accept all banner */}
        {suggestions && Object.keys(suggestions).length > 1 && (
          <div className="flex items-center justify-between bg-violet-50 border border-violet-200 rounded-lg px-4 py-2.5">
            <p className="text-xs font-medium text-violet-700">AI suggestions ready for {Object.keys(suggestions).length} fields</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={acceptAllSuggestions}
                className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1 rounded-md transition-colors"
              >
                Accept All
              </button>
              <button
                type="button"
                onClick={() => setSuggestions(null)}
                className="text-xs font-semibold text-violet-600 hover:text-violet-800 px-2 py-1 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {lotoFields.map(field => (
          <div key={field} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-600" htmlFor={field}>
                {LOTO_FIELD_LABELS[field]}
              </label>
              <button
                type="button"
                onClick={() => handleAiAssist(field)}
                disabled={assisting !== null}
                className="text-[11px] font-semibold text-violet-500 hover:text-violet-700 disabled:opacity-40 transition-colors"
              >
                {assisting === field ? '…' : '✦ AI'}
              </button>
            </div>

            {isMultiline(field) ? (
              <textarea
                id={field}
                value={loto[field]}
                onChange={e => setLoto(prev => ({ ...prev, [field]: e.target.value }))}
                rows={field === 'iso_procedure' ? 5 : 3}
                placeholder={field === 'iso_procedure' ? '1. De-energize machine\n2. Apply lockout device…' : undefined}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors font-mono text-[13px] leading-relaxed"
              />
            ) : (
              <input
                id={field}
                type="text"
                value={loto[field]}
                onChange={e => setLoto(prev => ({ ...prev, [field]: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
              />
            )}

            {/* Per-field suggestion */}
            {suggestions?.[field] && suggestions[field] !== loto[field] && (
              <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 space-y-2">
                <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-wide">AI Suggestion</p>
                <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{suggestions[field]}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => acceptSuggestion(field)}
                    className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1 rounded-md transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestions(prev => { if (!prev) return null; const n = {...prev}; delete n[field]; return Object.keys(n).length ? n : null })}
                    className="text-xs text-violet-500 hover:text-violet-700 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Save bar */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="px-5 py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* Photos */}
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
