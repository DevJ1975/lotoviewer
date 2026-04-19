'use client'

import Link from 'next/link'
import type { Equipment } from '@/lib/types'
import StatusBadge from '@/components/StatusBadge'

interface Props {
  equipment: Equipment | null
  loading:   boolean
}

export default function PlacardDetailPanel({ equipment, loading }: Props) {
  if (loading) {
    return (
      <aside className="shrink-0 w-full lg:w-[440px] bg-white border-l border-slate-100 flex items-center justify-center">
        <div className="text-slate-400 text-sm">Loading…</div>
      </aside>
    )
  }

  if (!equipment) {
    return (
      <aside className="shrink-0 w-full lg:w-[440px] bg-white border-l border-slate-100 flex items-center justify-center">
        <div className="text-center px-6">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-2xl mx-auto mb-3">📋</div>
          <p className="text-sm font-semibold text-slate-700">Select an equipment item</p>
          <p className="text-xs text-slate-400 mt-1">Its placard details will appear here.</p>
        </div>
      </aside>
    )
  }

  const href = `/equipment/${encodeURIComponent(equipment.equipment_id)}?from=${encodeURIComponent('/')}`

  return (
    <aside className="shrink-0 w-full lg:w-[440px] bg-white border-l border-slate-100 flex flex-col">
      <div className="p-5 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Equipment</p>
          <h2 className="font-mono text-lg font-bold text-slate-900 truncate">{equipment.equipment_id}</h2>
          <p className="text-xs text-slate-500 truncate mt-0.5">{equipment.department}</p>
        </div>
        <StatusBadge status={equipment.photo_status} />
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {/* Description */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Description</p>
          <p className="text-sm text-slate-800">{equipment.description}</p>
        </div>

        {/* Photos */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Photos</p>
          <div className="grid grid-cols-2 gap-2">
            <PhotoTile label="Equipment"   url={equipment.equip_photo_url} />
            <PhotoTile label="Isolation"   url={equipment.iso_photo_url}  />
          </div>
        </div>

        {/* Notes */}
        {equipment.notes && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Notes</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{equipment.notes}</p>
          </div>
        )}

        {/* Placard */}
        {equipment.placard_url && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-1">Placard</p>
            <a href={equipment.placard_url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand-navy font-semibold hover:underline">
              View Placard PDF →
            </a>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-slate-100">
        <Link
          href={href}
          className="block w-full text-center bg-brand-navy text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          Open Full Details →
        </Link>
      </div>
    </aside>
  )
}

function PhotoTile({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <div className="aspect-video rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-slate-300 mb-0.5">—</div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
        </div>
      </div>
    )
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="aspect-video rounded-lg overflow-hidden bg-slate-100 relative group block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
      <span className="absolute bottom-1 left-1 bg-white/90 text-[10px] font-semibold uppercase tracking-wide text-slate-700 px-1.5 py-0.5 rounded">{label}</span>
    </a>
  )
}
