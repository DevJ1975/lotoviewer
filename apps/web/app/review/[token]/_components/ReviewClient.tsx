'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import SignaturePad, { type SignaturePadRef } from '@/components/SignaturePad'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'

// Public reviewer client. Per-placard cards with notes + status; bottom
// signoff section with typed name, drawn signature, overall outcome.
//
// Save semantics:
//   - Per-placard notes/status are debounced (700ms) and POSTed to the
//     public API. A "Saved" indicator next to the card flickers green
//     on success. Failed saves show "Retry" inline.
//   - Final signoff is a single explicit POST. After it succeeds the
//     page swaps to a thank-you state without a refetch — the server
//     component's signed-off branch will pick up the same state on
//     refresh.

type Status = 'approved' | 'needs_changes'

interface InitialReview {
  equipment_id: string
  status:       Status
  notes:        string | null
}

interface Props {
  token:            string
  reviewLinkId:     string
  tenantName:       string
  department:       string
  reviewerName:     string
  adminMessage:     string | null
  expiresAt:        string
  isFirstView:      boolean
  equipment:        Equipment[]
  stepsByEquipment: Record<string, LotoEnergyStep[] | undefined>
  initialReviews:   InitialReview[]
}

export default function ReviewClient({
  token,
  tenantName,
  department,
  reviewerName,
  adminMessage,
  expiresAt,
  isFirstView,
  equipment,
  stepsByEquipment,
  initialReviews,
}: Props) {
  // Send view-ack on first render (server component decided this is
  // the first view). Fire-and-forget; failures are non-fatal.
  useEffect(() => {
    if (!isFirstView) return
    void fetch(`/api/review/${token}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'view-ack' }),
    }).catch(() => {})
  }, [isFirstView, token])

  // Per-placard local state. Keyed by equipment_id; undefined = not yet
  // touched, no row in the DB. status is required when saving notes.
  type LocalReview = { status: Status; notes: string }
  const [reviews, setReviews] = useState<Record<string, LocalReview>>(() => {
    const initial: Record<string, LocalReview> = {}
    for (const r of initialReviews) {
      initial[r.equipment_id] = { status: r.status, notes: r.notes ?? '' }
    }
    return initial
  })
  const [savingByEqId, setSavingByEqId] = useState<Record<string, 'saving' | 'saved' | 'error' | undefined>>({})

  // Debounced auto-save per equipment_id. Each placard has its own
  // timeout handle so typing on one row doesn't cancel a save on
  // another.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  function scheduleSave(eqId: string, next: LocalReview) {
    const prev = saveTimers.current[eqId]
    if (prev) clearTimeout(prev)
    saveTimers.current[eqId] = setTimeout(() => { void save(eqId, next) }, 700)
  }

  async function save(eqId: string, next: LocalReview) {
    setSavingByEqId(s => ({ ...s, [eqId]: 'saving' }))
    try {
      const res = await fetch(`/api/review/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:       'submit-note',
          equipment_id: eqId,
          status:       next.status,
          notes:        next.notes,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`)
      setSavingByEqId(s => ({ ...s, [eqId]: 'saved' }))
      // Fade the saved indicator after 1.5s.
      setTimeout(() => {
        setSavingByEqId(s => ({ ...s, [eqId]: undefined }))
      }, 1500)
    } catch {
      setSavingByEqId(s => ({ ...s, [eqId]: 'error' }))
    }
  }

  // ─── Signoff section ────────────────────────────────────────────────────

  const sigRef = useRef<SignaturePadRef>(null)
  const [sigEmpty, setSigEmpty] = useState(true)
  const [typedName, setTypedName] = useState(reviewerName)
  const [overallApproved, setOverallApproved] = useState<'approved' | 'needs_changes' | ''>('')
  const [overallNotes, setOverallNotes] = useState('')
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState<string | null>(null)
  const [signedOff, setSignedOff] = useState(false)

  const canSign = !!typedName.trim() && !sigEmpty && !!overallApproved && !signing

  async function submitSignoff() {
    if (!canSign) return
    setSigning(true); setSignError(null)
    try {
      const signature = sigRef.current?.toDataURL() ?? ''
      const res = await fetch(`/api/review/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:     'signoff',
          typed_name: typedName.trim(),
          signature,
          approved:   overallApproved === 'approved',
          notes:      overallNotes.trim(),
        }),
      })
      if (!res.ok) {
        const msg = (await res.json().catch(() => ({}))).error ?? 'Submit failed'
        throw new Error(msg)
      }
      setSignedOff(true)
    } catch (e) {
      setSignError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setSigning(false)
    }
  }

  if (signedOff) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 max-w-md text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold">
            Submitted
          </div>
          <h1 className="text-xl font-bold text-emerald-900">Thanks, {typedName.trim()}.</h1>
          <p className="text-sm text-emerald-800">
            Your review of {tenantName}'s {department} placards has been recorded.
            You can close this tab.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="bg-brand-navy text-white rounded-xl p-5">
          <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">
            Soteria FIELD · Placard review
          </div>
          <h1 className="text-2xl font-bold mt-1">
            {tenantName} · {department}
          </h1>
          <p className="text-sm opacity-90 mt-2">
            {equipment.length} {equipment.length === 1 ? 'placard' : 'placards'} ready for your review.
            Link expires {formatDate(expiresAt)}.
          </p>
          {adminMessage ? (
            <blockquote className="mt-3 px-3 py-2 bg-white/10 rounded-lg text-sm italic">
              {adminMessage}
            </blockquote>
          ) : null}
        </header>

        <section className="space-y-4">
          {equipment.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500">
              No placards in this batch yet.
            </div>
          )}
          {equipment.map(eq => {
            const local = reviews[eq.equipment_id]
            const saving = savingByEqId[eq.equipment_id]
            const steps = stepsByEquipment[eq.equipment_id] ?? []
            return (
              <article key={eq.equipment_id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-sm font-bold text-slate-900">{eq.equipment_id}</div>
                    <div className="text-sm text-slate-700 mt-0.5">{eq.description}</div>
                  </div>
                  {saving === 'saving' && <span className="text-[11px] text-slate-500">Saving…</span>}
                  {saving === 'saved'   && <span className="text-[11px] text-emerald-600 font-semibold">Saved</span>}
                  {saving === 'error'   && (
                    <button
                      type="button"
                      onClick={() => local && void save(eq.equipment_id, local)}
                      className="text-[11px] text-rose-700 underline"
                    >Save failed — retry</button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <PhotoTile url={eq.equip_photo_url} label="Equipment" />
                  <PhotoTile url={eq.iso_photo_url}   label="Isolation" />
                </div>

                {steps.length > 0 && (
                  <details className="text-xs text-slate-600">
                    <summary className="cursor-pointer font-semibold">{steps.length} energy {steps.length === 1 ? 'step' : 'steps'}</summary>
                    <ol className="mt-2 ml-4 list-decimal space-y-1.5">
                      {steps.map(s => (
                        <li key={s.id}>
                          <span className="font-semibold uppercase tracking-wide text-[10px] text-slate-500">{s.energy_type}</span>
                          {s.tag_description ? <> · {s.tag_description}</> : null}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <StatusRadio
                    name={`status-${eq.equipment_id}`}
                    value={local?.status}
                    onChange={(status) => {
                      const next = { status, notes: local?.notes ?? '' }
                      setReviews(r => ({ ...r, [eq.equipment_id]: next }))
                      scheduleSave(eq.equipment_id, next)
                    }}
                  />
                </div>

                <textarea
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                  rows={2}
                  placeholder="Optional comment for this placard"
                  value={local?.notes ?? ''}
                  onChange={(e) => {
                    const status = local?.status ?? 'approved'
                    const next = { status, notes: e.target.value }
                    setReviews(r => ({ ...r, [eq.equipment_id]: next }))
                    scheduleSave(eq.equipment_id, next)
                  }}
                />
              </article>
            )
          })}
        </section>

        {/* ── Signoff ──────────────────────────────────────────────────── */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900">Sign off on this review</h2>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Your full name</span>
            <input
              type="text"
              value={typedName}
              onChange={e => setTypedName(e.target.value)}
              placeholder="Type your full name"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>

          <div>
            <span className="text-xs font-semibold text-slate-600">Signature</span>
            <div className="mt-1 border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
              <SignaturePad ref={sigRef} onChange={(empty) => setSigEmpty(empty)} />
            </div>
            <button
              type="button"
              className="text-[11px] text-slate-500 hover:text-slate-800 mt-1"
              onClick={() => { sigRef.current?.clear(); setSigEmpty(true) }}
            >
              Clear signature
            </button>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold text-slate-600">Outcome</legend>
            <div className="mt-2 flex gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="overall"
                  value="approved"
                  checked={overallApproved === 'approved'}
                  onChange={() => setOverallApproved('approved')}
                />
                <span>Approve all</span>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="overall"
                  value="needs_changes"
                  checked={overallApproved === 'needs_changes'}
                  onChange={() => setOverallApproved('needs_changes')}
                />
                <span>Needs changes</span>
              </label>
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Overall comments (optional)</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              rows={3}
              value={overallNotes}
              onChange={e => setOverallNotes(e.target.value)}
            />
          </label>

          {signError ? (
            <p className="text-sm text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">{signError}</p>
          ) : null}

          <button
            type="button"
            disabled={!canSign}
            onClick={submitSignoff}
            className="w-full bg-brand-navy text-white rounded-lg py-3 font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {signing ? 'Submitting…' : 'Submit review'}
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            By signing, you confirm you've reviewed every placard above.
          </p>
        </section>
      </div>
    </main>
  )
}

function PhotoTile({ url, label }: { url: string | null; label: string }) {
  if (!url) {
    return (
      <div className="bg-slate-100 border border-dashed border-slate-300 rounded-lg aspect-[4/3] flex items-center justify-center text-xs text-slate-400">
        No {label.toLowerCase()} photo
      </div>
    )
  }
  return (
    <div className="relative bg-slate-900 rounded-lg overflow-hidden aspect-[4/3]">
      {/* next/image works for arbitrary remote URLs once the host is in
          next.config.ts remotePatterns — Supabase storage is. */}
      <Image
        src={url}
        alt={label}
        fill
        sizes="(max-width: 640px) 100vw, 320px"
        className="object-cover"
      />
      <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white font-semibold">
        {label}
      </span>
    </div>
  )
}

function StatusRadio({
  name, value, onChange,
}: { name: string; value: Status | undefined; onChange: (s: Status) => void }) {
  return (
    <div className="flex gap-2">
      <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs cursor-pointer border ${
        value === 'approved'
          ? 'bg-emerald-100 border-emerald-300 text-emerald-800'
          : 'bg-white border-slate-200 text-slate-600'
      }`}>
        <input type="radio" name={name} value="approved" checked={value === 'approved'} onChange={() => onChange('approved')} className="sr-only" />
        ✓ Approve
      </label>
      <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs cursor-pointer border ${
        value === 'needs_changes'
          ? 'bg-amber-100 border-amber-300 text-amber-800'
          : 'bg-white border-slate-200 text-slate-600'
      }`}>
        <input type="radio" name={name} value="needs_changes" checked={value === 'needs_changes'} onChange={() => onChange('needs_changes')} className="sr-only" />
        ⚑ Needs changes
      </label>
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}
