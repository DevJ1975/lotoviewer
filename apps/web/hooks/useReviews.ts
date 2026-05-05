'use client'

import { useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { LotoReview } from '@soteria/core/types'

export function useReviews(department: string) {
  const [reviews, setReviews]   = useState<LotoReview[]>([])
  const [loading, setLoading]   = useState(false)

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('loto_reviews')
      .select('*')
      .eq('department', department)
      .order('created_at', { ascending: false })
      .limit(10)
    if (data) setReviews(data as LotoReview[])
    setLoading(false)
  }, [department])

  const submitReview = useCallback(async (payload: {
    reviewer_name: string
    reviewer_email: string | null
    notes: string | null
    approved: boolean
  }) => {
    const { data, error } = await supabase
      .from('loto_reviews')
      .insert({ department, ...payload, signed_at: new Date().toISOString() })
      .select()
      .single()

    if (!error && data) setReviews(prev => [data as LotoReview, ...prev])
    return { data: data as LotoReview | null, error }
  }, [department])

  return { reviews, loading, fetchReviews, submitReview }
}
