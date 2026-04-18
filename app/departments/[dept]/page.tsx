'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import EquipmentTable from '@/components/EquipmentTable'
import ReviewModal from '@/components/ReviewModal'
import { Button } from '@/components/ui/button'
import { useReviews } from '@/hooks/useReviews'
import { stampSignature, downloadPdf } from '@/lib/pdfUtils'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function DepartmentDetailPage() {
  const params = useParams()
  const dept   = decodeURIComponent(params.dept as string)

  const [equipment, setEquipment]   = useState<Equipment[]>([])
  const [loading, setLoading]       = useState(true)
  const [showModal, setShowModal]   = useState(false)
  const [signing, setSigning]       = useState(false)

  const { reviews, fetchReviews, submitReview } = useReviews(dept)

  useEffect(() => {
    supabase
      .from('loto_equipment')
      .select('*')
      .eq('department', dept)
      .then(({ data }) => {
        if (data) setEquipment(data as Equipment[])
        setLoading(false)
      })
    fetchReviews()
  }, [dept, fetchReviews])

  async function handleApproved(signatureDataUrl: string, reviewerName: string, signedAt: string) {
    const targets = equipment.filter(e => e.placard_url)
    if (!targets.length) return
    setSigning(true)
    try {
      for (const eq of targets) {
        try {
          const bytes       = await stampSignature(eq.placard_url!, signatureDataUrl, reviewerName, signedAt)
          const storagePath = `signed-placards/${eq.equipment_id}_${Date.now()}.pdf`
          const { error: upErr } = await supabase.storage
            .from('loto-photos')
            .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true })
          if (!upErr) {
            const { data: { publicUrl } } = supabase.storage.from('loto-photos').getPublicUrl(storagePath)
            await supabase.from('loto_equipment')
              .update({ signed_placard_url: publicUrl })
              .eq('equipment_id', eq.equipment_id)
          }
        } catch { /* skip individual failures */ }
      }
      // Refresh equipment list to pick up signed_placard_url
      const { data } = await supabase.from('loto_equipment').select('*').eq('department', dept)
      if (data) setEquipment(data as Equipment[])

      // Download merged signed PDF for the reviewer
      const { mergePdfs } = await import('@/lib/pdfUtils')
      const { data: fresh } = await supabase.from('loto_equipment').select('*').eq('department', dept)
      const urls = (fresh as Equipment[] ?? targets).map(e => e.signed_placard_url ?? e.placard_url).filter(Boolean) as string[]
      if (urls.length) {
        const merged = await mergePdfs(urls)
        downloadPdf(merged, `${dept}-signed-placards.pdf`)
      }
    } finally {
      setSigning(false)
    }
  }

  const complete = equipment.filter(e => e.photo_status === 'complete').length
  const pct      = equipment.length > 0 ? Math.round((complete / equipment.length) * 100) : 0
  const latest   = reviews[0] ?? null

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-brand-navy border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-slate-400 mb-2">
            <Link href="/departments" className="hover:text-slate-600 transition-colors">Departments</Link>
            <span>/</span>
            <span className="text-slate-700 font-medium">{dept}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{dept}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{equipment.length} equipment · {pct}% complete</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {latest && (
            <div className="text-right hidden sm:block">
              <p className="text-[11px] text-slate-400 uppercase tracking-wider font-semibold">Last Review</p>
              <p className="text-xs text-slate-600 font-medium">{latest.reviewer_name ?? 'Unknown'}</p>
              <p className="text-[11px] text-slate-400">{formatDate(latest.created_at)}</p>
            </div>
          )}
          <Button
            onClick={() => setShowModal(true)}
            disabled={signing}
            className="bg-brand-navy hover:bg-brand-navy/90 text-white text-sm font-semibold disabled:opacity-50"
          >
            {signing ? 'Signing…' : '✍ Sign Off'}
          </Button>
        </div>
      </div>

      <EquipmentTable equipment={equipment} />

      {/* Review history */}
      {reviews.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 mb-4">Review History</h2>
          <div className="space-y-3">
            {reviews.map(r => (
              <div key={r.id} className="flex items-start justify-between gap-4 py-3 border-b border-slate-50 last:border-0">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    r.approved ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
                  }`}>
                    {r.approved ? '✓' : '✗'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{r.reviewer_name ?? 'Unknown reviewer'}</p>
                    {r.reviewer_email && <p className="text-xs text-slate-400">{r.reviewer_email}</p>}
                    {r.notes && <p className="text-xs text-slate-500 mt-0.5 italic">&ldquo;{r.notes}&rdquo;</p>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    r.approved ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                  }`}>
                    {r.approved ? 'Approved' : 'Needs Action'}
                  </span>
                  <p className="text-[11px] text-slate-400 mt-1">{formatDate(r.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showModal && (
        <ReviewModal
          department={dept}
          onSubmit={submitReview}
          onClose={() => setShowModal(false)}
          onApproved={handleApproved}
        />
      )}
    </div>
  )
}
