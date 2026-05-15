'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, Loader2, Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /bbs/observe — shop-floor BBS v2 capture form.
//
// Designed for one-handed, on-the-go use: large tap targets, minimal
// fields, no scrolling under normal use. Mobile-first; the desktop
// view simply centers the same column.
//
// All five inputs that drive the ratio metric (category, severity,
// description, optional photo, feedback_given) are above the fold.

type Category = 'safe_behavior' | 'unsafe_act' | 'unsafe_condition'
type Severity = 'minor' | 'major' | 'critical'
type HierarchyLevel = 'eliminate' | 'substitute' | 'engineering' | 'administrative' | 'ppe'

interface WorkerOption {
  id:        string
  full_name: string
}

const CATEGORY_CARDS: { value: Category; label: string; emoji: string; tone: string }[] = [
  { value: 'safe_behavior',    label: 'Safe behavior',    emoji: '✓', tone: 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100' },
  { value: 'unsafe_act',       label: 'Unsafe act',       emoji: '!', tone: 'border-amber-400  bg-amber-50  dark:bg-amber-950/40  text-amber-900  dark:text-amber-100' },
  { value: 'unsafe_condition', label: 'Unsafe condition', emoji: '⚠', tone: 'border-rose-400   bg-rose-50   dark:bg-rose-950/40   text-rose-900   dark:text-rose-100' },
]

export default function ObservePage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [category, setCategory]       = useState<Category | null>(null)
  const [severity, setSeverity]       = useState<Severity>('minor')
  const [observedId, setObservedId]   = useState<string>('')
  const [location, setLocation]       = useState('')
  const [description, setDescription] = useState('')
  const [recommendation, setRec]      = useState('')
  const [hierarchyLevel, setHier]     = useState<HierarchyLevel | ''>('')
  const [feedbackGiven, setFeedback]  = useState(false)
  const [followUpReq, setFollowUp]    = useState(false)
  const [workers, setWorkers]         = useState<WorkerOption[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [successAt, setSuccessAt]   = useState<number | null>(null)

  const loadWorkers = useCallback(async () => {
    if (!tenantId) return
    const { data } = await supabase
      .from('loto_workers')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('full_name', { ascending: true })
      .limit(500)
    setWorkers((data ?? []) as WorkerOption[])
  }, [tenantId])

  useEffect(() => { void loadWorkers() }, [loadWorkers])

  function reset() {
    setCategory(null)
    setSeverity('minor')
    setObservedId('')
    setLocation('')
    setDescription('')
    setRec('')
    setHier('')
    setFeedback(false)
    setFollowUp(false)
  }

  async function submit() {
    if (!tenantId || !profile?.id) { setError('Not signed in to a tenant.'); return }
    if (!category) { setError('Pick a category.'); return }
    if (description.trim().length < 5) { setError('Describe what you observed (at least 5 characters).'); return }
    setError(null)
    setSubmitting(true)
    const { error: err } = await supabase
      .from('bbs_observations_v2')
      .insert({
        tenant_id:               tenantId,
        observer_user_id:        profile.id,
        observed_worker_id:      observedId || null,
        location_text:           location.trim() || null,
        category,
        severity,
        description:             description.trim(),
        control_recommendation:  recommendation.trim() || null,
        hierarchy_level:         hierarchyLevel || null,
        feedback_given_at:       feedbackGiven ? new Date().toISOString() : null,
        follow_up_required:      followUpReq,
      })
    setSubmitting(false)
    if (err) { setError(formatSupabaseError(err, 'submit observation')); return }
    setSuccessAt(Date.now())
    reset()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-5 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Eye className="h-6 w-6 text-brand-navy" />
          New observation
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Quick BBS capture. Most observations take under 30 seconds — the goal is many small
          observations, not a few exhaustive ones.
        </p>
      </div>

      {successAt && Date.now() - successAt < 5000 && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-100 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> Observation logged. Capture another or head back.
        </div>
      )}

      <section className="space-y-2">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Category</span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {CATEGORY_CARDS.map(c => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              className={`rounded-xl border-2 px-3 py-4 text-left transition-colors ${
                category === c.value ? c.tone : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40'
              }`}
            >
              <span className="block text-2xl font-bold mb-1">{c.emoji}</span>
              <span className="block text-sm font-semibold">{c.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Severity</span>
        <div className="grid grid-cols-3 gap-2">
          {(['minor', 'major', 'critical'] as Severity[]).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setSeverity(s)}
              className={`rounded-lg border-2 px-3 py-3 text-sm font-semibold transition-colors capitalize ${
                severity === s
                  ? 'border-brand-navy bg-brand-navy/10 text-brand-navy'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/40'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Description</label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          placeholder="What did you see?"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
        />
      </section>

      <section className="space-y-2">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Worker observed (optional)</label>
        <select
          value={observedId}
          onChange={e => setObservedId(e.target.value)}
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
        >
          <option value="">— Not specified —</option>
          {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
        </select>
      </section>

      <section className="space-y-2">
        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Location</label>
        <input
          type="text"
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder="e.g. Bakery line 3, near oven"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
        />
      </section>

      {category && category !== 'safe_behavior' && (
        <>
          <section className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Recommended control (hierarchy)</label>
            <select
              value={hierarchyLevel}
              onChange={e => setHier(e.target.value as HierarchyLevel | '')}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            >
              <option value="">— Pick a level —</option>
              <option value="eliminate">Eliminate</option>
              <option value="substitute">Substitute</option>
              <option value="engineering">Engineering control</option>
              <option value="administrative">Administrative control</option>
              <option value="ppe">PPE</option>
            </select>
          </section>

          <section className="space-y-2">
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Control recommendation</label>
            <textarea
              value={recommendation}
              onChange={e => setRec(e.target.value)}
              rows={2}
              placeholder="What would fix this?"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            />
          </section>
        </>
      )}

      <section className="space-y-2">
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-slate-200 dark:border-slate-700">
          <input type="checkbox" checked={feedbackGiven} onChange={e => setFeedback(e.target.checked)} className="h-5 w-5" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">I gave coaching feedback in the moment</span>
        </label>
        <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-slate-200 dark:border-slate-700">
          <input type="checkbox" checked={followUpReq} onChange={e => setFollowUp(e.target.checked)} className="h-5 w-5" />
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Follow-up needed (maintenance, training, etc.)</span>
        </label>
      </section>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={submitting || !category || description.trim().length < 5}
        className="w-full px-4 py-4 rounded-xl bg-brand-navy text-white text-base font-bold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
      >
        {submitting ? 'Submitting…' : 'Submit observation'}
      </button>
    </div>
  )
}
