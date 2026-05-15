'use client'

import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { LotoReview } from '@soteria/core/types'
import { useTenant } from '@/components/TenantProvider'
import { emitReviewSigned } from '@/lib/xapi/emit'

export function useReviews(department: string) {
  const [reviews, setReviews]   = useState<LotoReview[]>([])
  const [loading, setLoading]   = useState(false)
  const { tenantId } = useTenant()

  const fetchReviews = useCallback(async () => {
    if (!tenantId) {
      setReviews([])
      return
    }
    setLoading(true)
    const { data } = await supabase
      .from('loto_reviews')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('department', department)
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setReviews(data as LotoReview[])
    setLoading(false)
  }, [department, tenantId])

  const submitReview = useCallback(async (payload: {
    reviewer_name: string
    reviewer_email: string | null
    notes: string | null
    approved: boolean
  }) => {
    if (!tenantId) {
      return { data: null, error: { message: 'No active tenant selected.' } }
    }
    const { data, error } = await supabase
      .from('loto_reviews')
      .insert({ tenant_id: tenantId, department, ...payload, signed_at: new Date().toISOString() })
      .select()
      .single()

    if (!error && data) {
      const row = data as LotoReview
      setReviews(prev => [row, ...prev])
      // Fire-and-forget xAPI emission. Failures must never block the
      // sign-off UI; lib/xapi/emit.ts logs and swallows.
      emitReviewSigned({
        department,
        reviewId:     row.id,
        approved:     row.approved,
        notesPresent: !!payload.notes && payload.notes.trim().length > 0,
      })
    }
    return { data: data as LotoReview | null, error }
  }, [department, tenantId])

  return { reviews, loading, fetchReviews, submitReview }
}
