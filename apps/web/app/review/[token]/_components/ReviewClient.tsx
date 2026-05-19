'use client'

import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import Image from 'next/image'
import SignaturePad, { type SignaturePadRef } from '@/components/SignaturePad'
import { compressImageInWorker, heicToJpeg, isHeic } from '@/lib/imageUtils'
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
type PhotoSlot = 'EQUIP' | 'ISO'
type PhotoUploadState = 'uploading' | 'saved' | 'error'
const MAX_REVIEW_SOURCE_PHOTO_BYTES = 15_000_000

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
  /** When true, this is the tenant-wide supervisor-flow link. */
  isPublic:         boolean
  equipment:        Equipment[]
  stepsByEquipment: Record<string, LotoEnergyStep[] | undefined>
  initialReviews:   InitialReview[]
}

const REVIEWER_NAME_KEY_PREFIX = 'soteria.review.reviewer-name:'

export default function ReviewClient({
  token,
  tenantName,
  department,
  reviewerName,
  adminMessage,
  expiresAt,
  isFirstView,
  isPublic,
  equipment,
  stepsByEquipment,
  initialReviews,
}: Props) {
  const [equipmentRows, setEquipmentRows] = useState(equipment)

  // Public-link reviewer identity. The legacy per-reviewer link carries
  // the typed name from the admin's mint form; the public link doesn't,
  // so we prompt on first write and persist in sessionStorage so the
  // supervisor doesn't re-type on every action. The key is scoped to
  // the token so multiple links in one browser don't share names.
  const reviewerKey = `${REVIEWER_NAME_KEY_PREFIX}${token}`
  const [publicReviewerName, setPublicReviewerName] = useState<string>(() => {
    if (!isPublic || typeof window === 'undefined') return reviewerName
    return window.sessionStorage.getItem(reviewerKey) ?? ''
  })
  const [askingName, setAskingName] = useState(false)
  const [pendingAction, setPendingAction] = useState<null | (() => void)>(null)
  const effectiveReviewerName = isPublic ? publicReviewerName : reviewerName

  function ensureReviewerName(thenRun: () => void) {
    if (!isPublic || publicReviewerName.trim()) { thenRun(); return }
    setPendingAction(() => thenRun)
    setAskingName(true)
  }

  function commitName(name: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    setPublicReviewerName(trimmed)
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(reviewerKey, trimmed)
    }
    setAskingName(false)
    const next = pendingAction
    setPendingAction(null)
    if (next) next()
  }

  // Per-equipment "marked for review" local state. Mirrors the row's
  // flagged_for_review_at field — we don't refetch after marking; the
  // button flips locally on success.
  const [flaggedByEqId, setFlaggedByEqId] = useState<Record<string, { by: string; at: string } | undefined>>(() => {
    const initial: Record<string, { by: string; at: string }> = {}
    for (const eq of equipment) {
      if (eq.flagged_for_review_at && eq.flagged_for_review_by) {
        initial[eq.equipment_id] = {
          by: eq.flagged_for_review_by,
          at: eq.flagged_for_review_at,
        }
      }
    }
    return initial
  })
  const [flagBusyByEqId, setFlagBusyByEqId] = useState<Record<string, boolean>>({})

  async function markForReview(eqId: string) {
    ensureReviewerName(async () => {
      setFlagBusyByEqId(s => ({ ...s, [eqId]: true }))
      try {
        const name = (publicReviewerName || effectiveReviewerName).trim()
        const res = await fetch(`/api/review/${token}`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            action:        'mark-for-review',
            equipment_id:  eqId,
            reviewer_name: name,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        setFlaggedByEqId(s => ({
          ...s,
          [eqId]: { by: name, at: new Date().toISOString() },
        }))
      } catch (err) {
        // Surface as alert — there's no per-row error slot since this
        // is a button click, not a form, and the public surface
        // doesn't have a toast system.
        if (typeof window !== 'undefined') {
          window.alert(err instanceof Error ? err.message : 'Could not flag this equipment.')
        }
      } finally {
        setFlagBusyByEqId(s => ({ ...s, [eqId]: false }))
      }
    })
  }

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
  const [photoUploadByKey, setPhotoUploadByKey] = useState<Record<string, { status: PhotoUploadState; message?: string } | undefined>>({})

  // Debounced auto-save per equipment_id. Each placard has its own
  // timeout handle so typing on one row doesn't cancel a save on
  // another.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  function scheduleSave(eqId: string, next: LocalReview) {
    const prev = saveTimers.current[eqId]
    if (prev) clearTimeout(prev)
    saveTimers.current[eqId] = setTimeout(() => { void save(eqId, next) }, 700)
  }

  async function save(eqId: string, next: LocalReview, options?: { rethrow?: boolean }) {
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
    } catch (e) {
      setSavingByEqId(s => ({ ...s, [eqId]: 'error' }))
      if (options?.rethrow) throw e
    }
  }

  function replacePhoto(eqId: string, slot: PhotoSlot, file: File) {
    // Public-link path captures the reviewer's name on first action.
    // The legacy per-reviewer path already has the name on the link.
    ensureReviewerName(() => void doReplacePhoto(eqId, slot, file))
  }

  async function doReplacePhoto(eqId: string, slot: PhotoSlot, file: File) {
    const key = photoUploadKey(eqId, slot)
    setPhotoUploadByKey(s => ({ ...s, [key]: { status: 'uploading' } }))
    try {
      validateReviewPhotoCandidate(file)
      const normalized = await normalizeReviewPhoto(file)
      const form = new FormData()
      form.set('action', 'replace-photo')
      form.set('equipment_id',  eqId)
      form.set('slot',          slot)
      form.set('reviewer_name', (publicReviewerName || effectiveReviewerName).trim())
      form.set('photo', normalized)

      const res = await fetch(`/api/review/${token}`, {
        method: 'POST',
        body: form,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      const publicUrl = typeof body.public_url === 'string' ? body.public_url : ''
      if (!publicUrl) throw new Error('Upload succeeded but no photo URL was returned')

      const urlField = slot === 'EQUIP' ? 'equip_photo_url' : 'iso_photo_url'
      const photoStatus = isPhotoStatus(body.photo_status) ? body.photo_status : undefined
      // The server-side regen returns the new placard_url inline. If
      // regen failed (Sentry-logged, non-fatal), placard_url is null
      // and the next admin viewer will trigger a fresh render.
      const newPlacardUrl = typeof body.placard_url === 'string' ? body.placard_url : null
      setEquipmentRows(rows => rows.map(eq =>
        eq.equipment_id === eqId
          ? {
              ...eq,
              [urlField]: publicUrl,
              photo_status: photoStatus ?? eq.photo_status,
              placard_url: newPlacardUrl,
              signed_placard_url: null,
            }
          : eq,
      ))
      setPhotoUploadByKey(s => ({ ...s, [key]: { status: 'saved' } }))
      setTimeout(() => {
        setPhotoUploadByKey(s => ({ ...s, [key]: undefined }))
      }, 1800)
    } catch (e) {
      setPhotoUploadByKey(s => ({
        ...s,
        [key]: {
          status: 'error',
          message: e instanceof Error ? e.message : 'Photo upload failed',
        },
      }))
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

  const allPlacardsReviewed = equipmentRows.length > 0
    && equipmentRows.every(eq => Boolean(reviews[eq.equipment_id]?.status))
  const allPlacardsCurrent = equipmentRows.length > 0
    && equipmentRows.every(eq => eq.photo_status === 'complete' && Boolean(eq.placard_url))
  const canSign = !!typedName.trim() && !sigEmpty && !!overallApproved && allPlacardsReviewed && allPlacardsCurrent && !signing

  async function submitSignoff() {
    if (!canSign) return
    setSigning(true); setSignError(null)
    try {
      await Promise.all(equipmentRows.map(eq => {
        const review = reviews[eq.equipment_id]
        if (!review) throw new Error('Review every placard before submitting signoff.')
        const timer = saveTimers.current[eq.equipment_id]
        if (timer) {
          clearTimeout(timer)
          delete saveTimers.current[eq.equipment_id]
        }
        return save(eq.equipment_id, review, { rethrow: true })
      }))

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
            Your review of {tenantName}&apos;s {department} placards has been recorded.
            You can close this tab.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-50 py-8 px-4">
      {askingName && (
        <NameModal
          onCancel={() => { setAskingName(false); setPendingAction(null) }}
          onSubmit={commitName}
        />
      )}
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="bg-brand-navy text-white rounded-xl p-5">
          <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">
            SoteriaField · {isPublic ? 'Floor walk' : 'Placard review'}
          </div>
          <h1 className="text-2xl font-bold mt-1">
            {tenantName}{!isPublic && ` · ${department}`}
          </h1>
          <p className="text-sm opacity-90 mt-2">
            {equipmentRows.length} {equipmentRows.length === 1 ? 'placard' : 'placards'} ready for your review.
            Link expires {formatDate(expiresAt)}.
          </p>
          <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/95">
            {isPublic
              ? 'Spot a photo that’s missing, outdated, or unclear? Drag a replacement onto the tile, or flag the placard for closer admin review.'
              : 'If a photo is missing, outdated, or unclear, drag a replacement onto that photo tile before you submit.'}
          </p>
          {publicReviewerName && (
            <p className="mt-2 text-xs text-white/75">
              Signed in as <strong>{publicReviewerName}</strong>{' '}
              <button
                type="button"
                onClick={() => setAskingName(true)}
                className="ml-1 underline opacity-75 hover:opacity-100"
              >change</button>
            </p>
          )}
          {adminMessage ? (
            <blockquote className="mt-3 px-3 py-2 bg-white/10 rounded-lg text-sm italic">
              {adminMessage}
            </blockquote>
          ) : null}
        </header>

        <section className="space-y-4">
          {equipmentRows.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500">
              No placards in this batch yet.
            </div>
          )}
          {equipmentRows.map(eq => {
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
                  <PhotoTile
                    url={eq.equip_photo_url}
                    label="Equipment"
                    upload={photoUploadByKey[photoUploadKey(eq.equipment_id, 'EQUIP')]}
                    onReplace={(file) => void replacePhoto(eq.equipment_id, 'EQUIP', file)}
                  />
                  <PhotoTile
                    url={eq.iso_photo_url}
                    label="Isolation"
                    upload={photoUploadByKey[photoUploadKey(eq.equipment_id, 'ISO')]}
                    onReplace={(file) => void replacePhoto(eq.equipment_id, 'ISO', file)}
                  />
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
                  {!isPublic && (
                    <StatusRadio
                      name={`status-${eq.equipment_id}`}
                      value={local?.status}
                      onChange={(status) => {
                        const next = { status, notes: local?.notes ?? '' }
                        setReviews(r => ({ ...r, [eq.equipment_id]: next }))
                        scheduleSave(eq.equipment_id, next)
                      }}
                    />
                  )}
                  <ReviewFlagButton
                    flagged={flaggedByEqId[eq.equipment_id]}
                    busy={!!flagBusyByEqId[eq.equipment_id]}
                    onClick={() => void markForReview(eq.equipment_id)}
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

        {/* The signoff section only renders for the legacy per-reviewer
            flow. The public supervisor link is comments + photo + flag
            only — there is no terminal "submit" gate, because the link
            is alive until it expires or the admin revokes it. */}
        {!isPublic && (
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
          {!allPlacardsReviewed ? (
            <p className="text-sm text-amber-800 bg-amber-50 px-3 py-2 rounded-lg">
              Review every placard above before submitting your signoff.
            </p>
          ) : null}
          {!allPlacardsCurrent ? (
            <p className="text-sm text-amber-800 bg-amber-50 px-3 py-2 rounded-lg">
              Photo replacements require the sender to regenerate placards before final signoff.
            </p>
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
            By signing, you confirm you&apos;ve reviewed every placard above.
          </p>
        </section>
        )}

        {isPublic && (
          <p className="text-center text-xs text-slate-500">
            All updates save instantly. Close the tab when you&apos;re done.
          </p>
        )}
      </div>
    </main>
  )
}

function ReviewFlagButton({
  flagged, busy, onClick,
}: {
  flagged: { by: string; at: string } | undefined
  busy:    boolean
  onClick: () => void
}) {
  if (flagged) {
    return (
      <span
        title={`Flagged by ${flagged.by} on ${new Date(flagged.at).toLocaleString()}`}
        className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800"
      >
        ⚑ Flagged for review
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-amber-50 hover:border-amber-300 hover:text-amber-800 disabled:opacity-50"
    >
      {busy ? 'Flagging…' : '⚑ Mark for review'}
    </button>
  )
}

function NameModal({
  onCancel, onSubmit,
}: {
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState('')
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4"
    >
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
        <h2 className="text-lg font-bold text-slate-900">Your name, please</h2>
        <p className="mt-1 text-sm text-slate-600">
          Recorded on every photo replacement and flag so the admin team knows who walked the floor.
        </p>
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(name) }}
          className="mt-4 space-y-3"
        >
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full name"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >Cancel</button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-brand-navy px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-brand-navy/90"
            >Continue</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function PhotoTile({
  url, label, upload, onReplace,
}: {
  url: string | null
  label: string
  upload: { status: PhotoUploadState; message?: string } | undefined
  onReplace: (file: File) => void
}) {
  const reactId = useId()
  const inputId = `photo-${label}-${reactId}`
  const disabled = upload?.status === 'uploading'
  const [dragActive, setDragActive] = useState(false)

  function handleSelectedFile(file: File | undefined) {
    if (!file || disabled) return
    onReplace(file)
  }

  const dropHandlers = {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled) setDragActive(true)
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      if (!disabled) setDragActive(true)
    },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      const nextTarget = e.relatedTarget
      if (nextTarget instanceof Node && e.currentTarget.contains(nextTarget)) return
      setDragActive(false)
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setDragActive(false)
      handleSelectedFile(e.dataTransfer.files?.[0])
    },
  }

  const tileClass = `relative rounded-lg aspect-[4/3] overflow-hidden transition-colors ${
    dragActive
      ? 'ring-2 ring-brand-navy ring-offset-2 border-brand-navy'
      : ''
  }`

  const controls = (
    <div className="absolute left-2 right-2 bottom-2 flex items-center justify-between gap-2">
      <span className="px-1.5 py-0.5 rounded text-[10px] bg-black/60 text-white font-semibold">
        {label}
      </span>
      <label
        htmlFor={inputId}
        className={`px-2 py-1 rounded-md text-[11px] font-semibold shadow-sm ${
          disabled
            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
            : 'bg-white text-slate-800 cursor-pointer hover:bg-slate-100'
        }`}
      >
        {disabled ? 'Uploading...' : 'Choose photo'}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={disabled}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0]
          e.currentTarget.value = ''
          handleSelectedFile(file)
        }}
      />
    </div>
  )
  const dropOverlay = dragActive ? (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-brand-navy/85 text-center text-sm font-bold text-white">
      Drop photo to replace {label.toLowerCase()}
    </div>
  ) : null

  if (!url) {
    return (
      <div
        {...dropHandlers}
        className={`${tileClass} bg-slate-100 border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400`}
      >
        <div className="px-3 text-center">
          No {label.toLowerCase()} photo
          <div className="mt-1 text-[11px] font-semibold text-slate-500">Drag photo here</div>
        </div>
        {dropOverlay}
        {controls}
        <PhotoUploadMessage upload={upload} />
      </div>
    )
  }
  return (
    <div {...dropHandlers} className={`${tileClass} bg-slate-900`}>
      {/* next/image works for arbitrary remote URLs once the host is in
          next.config.ts remotePatterns — Supabase storage is. */}
      <Image
        src={url}
        alt={label}
        fill
        sizes="(max-width: 640px) 100vw, 320px"
        className="object-cover"
      />
      <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/55 to-transparent px-2 py-1.5 text-[11px] font-semibold text-white">
        Drag a photo here to replace
      </div>
      {dropOverlay}
      {controls}
      <PhotoUploadMessage upload={upload} />
    </div>
  )
}

function PhotoUploadMessage({
  upload,
}: { upload: { status: PhotoUploadState; message?: string } | undefined }) {
  if (!upload || upload.status === 'uploading') return null
  if (upload.status === 'saved') {
    return (
      <div className="absolute left-2 right-2 top-2 rounded-md bg-emerald-600 px-2 py-1 text-center text-[11px] font-semibold text-white">
        Photo updated; regenerate placard
      </div>
    )
  }
  return (
    <div className="absolute top-2 left-2 right-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 shadow">
      {upload.message ?? 'Photo upload failed'}
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

function photoUploadKey(eqId: string, slot: PhotoSlot): string {
  return `${eqId}:${slot}`
}

async function normalizeReviewPhoto(file: File): Promise<File> {
  const jpeg = isHeic(file) ? await heicToJpeg(file) : file
  return compressImageInWorker(jpeg, 1_000_000)
}

function validateReviewPhotoCandidate(file: File): void {
  if (file.size > MAX_REVIEW_SOURCE_PHOTO_BYTES) {
    throw new Error('Photo is too large. Choose a photo under 15 MB.')
  }
  if (!isReviewImageCandidate(file)) {
    throw new Error('Choose an image file for the replacement photo.')
  }
}

function isReviewImageCandidate(file: File): boolean {
  if (file.type.toLowerCase().startsWith('image/')) return true
  if (isHeic(file)) return true
  return /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
}

function isPhotoStatus(value: unknown): value is Equipment['photo_status'] {
  return value === 'missing' || value === 'partial' || value === 'complete'
}
