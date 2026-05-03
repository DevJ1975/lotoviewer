'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, FileArchive, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import { generateCompliancePdfBundle } from '@/lib/pdfBundle'
import type {
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
  HotWorkPermit,
} from '@/lib/types'

// Admin-only "compliance report bundle" generator. The user picks a date
// range, we fetch every permit issued in that window, and we hand back a
// single PDF that an OSHA inspector can review without bouncing between
// permit pages. Each permit's individual PDF bytes are SHA-256 hashed and
// listed on the cover sheet for chain-of-custody verification.
//
// Generation runs entirely client-side — the same machinery that powers
// the per-permit download. For a multi-month window with hundreds of
// permits this can take 10-30s; we surface progress with a busy state
// rather than blocking with a spinner.

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function nDaysAgoIso(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function CompliancePage() {
  const { profile, loading: authLoading } = useAuth()
  // Default to the last 90 days — typical inspector look-back.
  const [start, setStart] = useState<string>(() => nDaysAgoIso(90))
  const [end, setEnd]     = useState<string>(() => todayIso())
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Status messages so the user sees something is happening on a
  // long bundle. We update this between the fetch + hash + render
  // phases.
  const [stage, setStage] = useState<string | null>(null)
  const [lastBundle, setLastBundle] = useState<{ filename: string; permitCount: number; sizeKb: number } | null>(null)

  const inverted = useMemo(() => start && end && start > end, [start, end])

  async function generate() {
    if (inverted) { setError('Start date must be on or before end date.'); return }
    setBusy(true)
    setError(null)
    setStage('Loading permits…')
    setLastBundle(null)

    try {
      // Inclusive on both ends. We run two queries in parallel for the
      // CS and hot-work tables. `started_at` is the lifecycle anchor —
      // a permit issued at 23:59 on the start day belongs to the bundle.
      const startTs = new Date(`${start}T00:00:00.000Z`).toISOString()
      const endTs   = new Date(`${end}T23:59:59.999Z`).toISOString()

      const [csRes, hwRes] = await Promise.all([
        supabase
          .from('loto_confined_space_permits')
          .select('*')
          .gte('started_at', startTs)
          .lte('started_at', endTs)
          .order('started_at', { ascending: true }),
        supabase
          .from('loto_hot_work_permits')
          .select('*')
          .gte('started_at', startTs)
          .lte('started_at', endTs)
          .order('started_at', { ascending: true }),
      ])

      if (csRes.error) throw new Error(formatSupabaseError(csRes.error, 'load CS permits'))
      if (hwRes.error) throw new Error(formatSupabaseError(hwRes.error, 'load hot-work permits'))

      const csPermitsRaw = (csRes.data ?? []) as ConfinedSpacePermit[]
      const hwPermitsRaw = (hwRes.data ?? []) as HotWorkPermit[]

      if (csPermitsRaw.length === 0 && hwPermitsRaw.length === 0) {
        setError('No permits found in the selected window.')
        setBusy(false); setStage(null)
        return
      }

      setStage(`Found ${csPermitsRaw.length} CS + ${hwPermitsRaw.length} hot-work permits — loading dependencies…`)

      // For CS permits we need the parent space (for thresholds + header)
      // and the atmospheric tests (for the inline table). Two batched queries
      // by FK rather than N round trips.
      const spaceIds  = Array.from(new Set(csPermitsRaw.map(p => p.space_id))).filter(Boolean) as string[]
      const permitIds = csPermitsRaw.map(p => p.id)

      const [spacesRes, testsRes] = await Promise.all([
        spaceIds.length > 0
          ? supabase.from('loto_confined_spaces').select('*').in('space_id', spaceIds)
          : Promise.resolve({ data: [], error: null }),
        permitIds.length > 0
          ? supabase
              .from('loto_atmospheric_tests')
              .select('*')
              .in('permit_id', permitIds)
              .order('tested_at', { ascending: false })
          : Promise.resolve({ data: [], error: null }),
      ])

      if (spacesRes.error) throw new Error(formatSupabaseError(spacesRes.error, 'load spaces'))
      if (testsRes.error)  throw new Error(formatSupabaseError(testsRes.error, 'load atmospheric tests'))

      const spacesById = new Map<string, ConfinedSpace>()
      for (const s of (spacesRes.data ?? []) as ConfinedSpace[]) {
        spacesById.set(s.space_id, s)
      }
      const testsByPermit = new Map<string, AtmosphericTest[]>()
      for (const t of (testsRes.data ?? []) as AtmosphericTest[]) {
        const list = testsByPermit.get(t.permit_id) ?? []
        list.push(t)
        testsByPermit.set(t.permit_id, list)
      }

      // Filter out CS permits whose parent space is missing — usually
      // because the space row was renamed / deleted. Surface them in the
      // error string so the admin knows; don't crash the whole bundle.
      const csEntries = csPermitsRaw
        .map(p => {
          const space = spacesById.get(p.space_id)
          if (!space) return null
          return { permit: p, space, tests: testsByPermit.get(p.id) ?? [] }
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)

      const droppedCs = csPermitsRaw.length - csEntries.length

      setStage('Generating PDF — this can take 10-30s for large windows…')

      const origin = typeof window !== 'undefined' ? window.location.origin : undefined
      const bytes = await generateCompliancePdfBundle({
        startDate:      start,
        endDate:        end,
        csPermits:      csEntries,
        hotWorkPermits: hwPermitsRaw.map(p => ({ permit: p })),
        origin,
      })

      // Trigger download via blob + a transient anchor — same pattern as
      // the per-permit PDF download. Use a new tab where allowed so iOS
      // Safari shows the PDF in its native viewer.
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      const filename = `compliance-bundle-${start}-to-${end}.pdf`
      const newWin = window.open(url, '_blank', 'noopener,noreferrer')
      if (!newWin) {
        const a = document.createElement('a')
        a.href     = url
        a.download = filename
        a.rel      = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)

      setLastBundle({
        filename,
        permitCount: csEntries.length + hwPermitsRaw.length,
        sizeKb:      Math.round(bytes.byteLength / 1024),
      })
      setStage(droppedCs > 0
        ? `Done. ${droppedCs} CS permit${droppedCs === 1 ? '' : 's'} skipped because the parent space was missing.`
        : 'Done.')
    } catch (err) {
      console.error('[compliance-bundle] generation failed', err)
      setError(err instanceof Error ? err.message : 'Could not generate bundle.')
      setStage(null)
    } finally {
      setBusy(false)
    }
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <FileArchive className="h-6 w-6 text-brand-navy" />
          Compliance Report Bundle
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          One inspector-ready PDF covering every CS and hot-work permit in a date range.
          Each permit&apos;s bytes are SHA-256 hashed on the cover sheet for chain-of-custody verification.
        </p>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Start date</span>
            <input
              type="date"
              value={start}
              onChange={e => setStart(e.target.value)}
              max={end || undefined}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">End date</span>
            <input
              type="date"
              value={end}
              onChange={e => setEnd(e.target.value)}
              min={start || undefined}
              max={todayIso()}
              disabled={busy}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
            />
          </label>
        </div>

        {/* Quick range presets — saves typing for the common windows. */}
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Last 7 days',   days: 7 },
            { label: 'Last 30 days',  days: 30 },
            { label: 'Last 90 days',  days: 90 },
            { label: 'Last 12 months', days: 365 },
          ].map(preset => (
            <button
              key={preset.label}
              type="button"
              onClick={() => { setStart(nDaysAgoIso(preset.days)); setEnd(todayIso()) }}
              disabled={busy}
              className="px-3 py-1 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40 disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
        </div>

        {inverted && (
          <p className="text-xs text-rose-600 dark:text-rose-400">Start date must be on or before end date.</p>
        )}
        {error && (
          <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
            {error}
          </div>
        )}
        {stage && !error && (
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-700 dark:text-slate-300">
            {stage}
          </div>
        )}

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={generate}
            disabled={busy || inverted || !start || !end}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {busy ? 'Generating…' : 'Generate bundle'}
          </button>
        </div>
      </div>

      {lastBundle && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 p-4 text-xs text-emerald-900 dark:text-emerald-100">
          <p className="font-semibold">Last bundle</p>
          <p className="mt-1 font-mono">{lastBundle.filename}</p>
          <p className="mt-1">{lastBundle.permitCount} permits · {lastBundle.sizeKb} KB</p>
        </div>
      )}
    </div>
  )
}
