'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import EquipmentTable from '@/components/EquipmentTable'
import ReviewModal from '@/components/ReviewModal'
import Toast from '@/components/Toast'
import { Button } from '@/components/ui/button'
import ClientReviewPanel from '@/components/departments/ClientReviewPanel'
import { useReviews } from '@/hooks/useReviews'
import { useToast } from '@/hooks/useToast'
import { useTenant } from '@/components/TenantProvider'
import { signedPlacardPath } from '@/lib/storagePaths'

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
  const mountedRef                  = useRef(true)
  const { toast, showToast, clearToast } = useToast()
  const { tenantId } = useTenant()

  useEffect(() => () => { mountedRef.current = false }, [])

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
    if (!tenantId) {
      showToast('No active tenant — cannot sign placards', 'error')
      return
    }
    const targets = equipment.filter(e => e.placard_url)
    if (!targets.length) return
    setSigning(true)
    let signed = 0, failed = 0
    // Lazy-load pdf-lib helpers — only the reviewer flow needs them.
    const { stampSignature, downloadPdf } = await import('@/lib/pdfUtils')
    try {
      for (const eq of targets) {
        if (!mountedRef.current) return  // user left the page
        try {
          const bytes       = await stampSignature(eq.placard_url!, signatureDataUrl, reviewerName, signedAt)
          const storagePath = signedPlacardPath(tenantId, eq.equipment_id)
          const { error: upErr } = await supabase.storage
            .from('loto-photos')
            .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: true })
          if (upErr) { failed++; continue }
          const { data: { publicUrl } } = supabase.storage.from('loto-photos').getPublicUrl(storagePath)
          const { error: patchErr } = await supabase.from('loto_equipment')
            .update({ signed_placard_url: publicUrl })
            .eq('equipment_id', eq.equipment_id)
          if (patchErr) failed++
          else signed++
        } catch {
          failed++
        }
      }

      if (!mountedRef.current) return

      // Refresh equipment list to pick up signed_placard_url
      const { data: fresh } = await supabase.from('loto_equipment').select('*').eq('department', dept)
      if (fresh && mountedRef.current) setEquipment(fresh as Equipment[])

      // Download merged signed PDF for the reviewer
      const urls = (fresh as Equipment[] ?? targets).map(e => e.signed_placard_url ?? e.placard_url).filter(Boolean) as string[]
      if (urls.length) {
        try {
          const { mergePdfs } = await import('@/lib/pdfUtils')
          const merged = await mergePdfs(urls)
          downloadPdf(merged, `${dept}-signed-placards.pdf`)
        } catch { /* merge or download failed — non-critical, signing already done */ }
      }

      if (failed > 0 && mountedRef.current) {
        showToast(`Signed ${signed} placard${signed === 1 ? '' : 's'}, ${failed} failed. Check your connection and try again.`, 'error')
      } else if (mountedRef.current) {
        showToast(`Signed ${signed} placard${signed === 1 ? '' : 's'}.`, 'success')
      }
    } catch {
      if (mountedRef.current) showToast('Could not complete sign-off. Please try again.', 'error')
    } finally {
      if (mountedRef.current) setSigning(false)
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm text-slate-400 dark:text-slate-500 mb-2">
            <Link href="/departments" className="hover:text-slate-600 dark:hover:text-slate-300 transition-colors">Departments</Link>
            <span>/</span>
            <span className="text-slate-700 dark:text-slate-300 font-medium">{dept}</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{dept}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{equipment.length} equipment · {pct}% complete</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {latest && (
            <div className="text-right hidden sm:block">
              <p className="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Last Review</p>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">{latest.reviewer_name ?? 'Unknown'}</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">{formatDate(latest.created_at)}</p>
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
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-6">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-4">Review History</h2>
          <div className="space-y-3">
            {reviews.map(r => (
              <div key={r.id} className="flex items-start justify-between gap-4 py-3 border-b border-slate-50 last:border-0">
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    r.approved ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400'
                  }`}>
                    {r.approved ? '✓' : '✗'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{r.reviewer_name ?? 'Unknown reviewer'}</p>
                    {r.reviewer_email && <p className="text-xs text-slate-400 dark:text-slate-500">{r.reviewer_email}</p>}
                    {r.notes && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 italic">&ldquo;{r.notes}&rdquo;</p>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    r.approved ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  }`}>
                    {r.approved ? 'Approved' : 'Needs Action'}
                  </span>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{formatDate(r.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <ClientReviewPanel department={dept} />

      {showModal && (
        <ReviewModal
          department={dept}
          onSubmit={submitReview}
          onClose={() => setShowModal(false)}
          onApproved={handleApproved}
        />
      )}

      {toast && <Toast {...toast} onClose={clearToast} />}
    </div>
  )
}
