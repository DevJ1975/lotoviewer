'use client'

import { useEffect, useId, useRef, useState, type DragEvent } from 'react'
import Image from 'next/image'
import { compressImageInWorker, heicToJpeg, isHeic } from '@/lib/imageUtils'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'

// Public reviewer client. Anonymous comments-only model:
//   - Equipment grouped by department.
//   - One freeform "comment" textarea per placard.
//   - Comments auto-save (debounced 700ms). No status / approve /
//     sign-off; admins read comments and act on them.
//   - Photo replacement remains supported — the reviewer can drop a
//     fresh JPEG on any photo tile and the API re-uploads it.

type PhotoSlot = 'EQUIP' | 'ISO'
type PhotoUploadState = 'uploading' | 'saved' | 'error'
const MAX_REVIEW_SOURCE_PHOTO_BYTES = 15_000_000

interface InitialReview {
  equipment_id: string
  notes:        string | null
}

interface Props {
  token:            string
  reviewLinkId:     string
  tenantName:       string
  isFirstView:      boolean
  equipment:        Equipment[]
  stepsByEquipment: Record<string, LotoEnergyStep[] | undefined>
  initialReviews:   InitialReview[]
}

export default function ReviewClient({
  token,
  tenantName,
  isFirstView,
  equipment,
  stepsByEquipment,
  initialReviews,
}: Props) {
  const [equipmentRows, setEquipmentRows] = useState(equipment)

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

  // Per-placard local state. Keyed by equipment_id; the value is the
  // current comment text (empty string = no comment).
  const [comments, setComments] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const r of initialReviews) initial[r.equipment_id] = r.notes ?? ''
    return initial
  })
  const [savingByEqId, setSavingByEqId] = useState<Record<string, 'saving' | 'saved' | 'error' | undefined>>({})
  const [photoUploadByKey, setPhotoUploadByKey] = useState<Record<string, { status: PhotoUploadState; message?: string } | undefined>>({})

  // Debounced auto-save per equipment_id.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  function scheduleSave(eqId: string, next: string) {
    const prev = saveTimers.current[eqId]
    if (prev) clearTimeout(prev)
    saveTimers.current[eqId] = setTimeout(() => { void save(eqId, next) }, 700)
  }

  async function save(eqId: string, next: string) {
    setSavingByEqId(s => ({ ...s, [eqId]: 'saving' }))
    try {
      const res = await fetch(`/api/review/${token}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action:       'submit-note',
          equipment_id: eqId,
          notes:        next,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `${res.status}`)
      setSavingByEqId(s => ({ ...s, [eqId]: 'saved' }))
      setTimeout(() => {
        setSavingByEqId(s => ({ ...s, [eqId]: undefined }))
      }, 1500)
    } catch {
      setSavingByEqId(s => ({ ...s, [eqId]: 'error' }))
    }
  }

  async function replacePhoto(eqId: string, slot: PhotoSlot, file: File) {
    const key = photoUploadKey(eqId, slot)
    setPhotoUploadByKey(s => ({ ...s, [key]: { status: 'uploading' } }))
    try {
      validateReviewPhotoCandidate(file)
      const normalized = await normalizeReviewPhoto(file)
      const form = new FormData()
      form.set('action', 'replace-photo')
      form.set('equipment_id', eqId)
      form.set('slot', slot)
      form.set('photo', normalized)

      const res = await fetch(`/api/review/${token}`, { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      const publicUrl = typeof body.public_url === 'string' ? body.public_url : ''
      if (!publicUrl) throw new Error('Upload succeeded but no photo URL was returned')

      const urlField = slot === 'EQUIP' ? 'equip_photo_url' : 'iso_photo_url'
      const photoStatus = isPhotoStatus(body.photo_status) ? body.photo_status : undefined
      setEquipmentRows(rows => rows.map(eq =>
        eq.equipment_id === eqId
          ? {
              ...eq,
              [urlField]: publicUrl,
              photo_status: photoStatus ?? eq.photo_status,
              placard_url: null,
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
        [key]: { status: 'error', message: e instanceof Error ? e.message : 'Photo upload failed' },
      }))
    }
  }

  const groupedByDept = groupByDepartment(equipmentRows)

  return (
    <main className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-5">
        <header className="bg-brand-navy text-white rounded-xl p-5">
          <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">
            SoteriaField · Placard review
          </div>
          <h1 className="text-2xl font-bold mt-1">
            {tenantName}
          </h1>
          <p className="text-sm opacity-90 mt-2">
            {equipmentRows.length} {equipmentRows.length === 1 ? 'placard' : 'placards'} across {groupedByDept.length} {groupedByDept.length === 1 ? 'department' : 'departments'}.
          </p>
          <p className="mt-3 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white/95">
            Leave a comment under any placard. Comments save automatically — no account, no sign-off. If a photo looks wrong, drop a fresh JPEG onto the tile to replace it.
          </p>
        </header>

        {equipmentRows.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-slate-500">
            No active placards for this tenant yet.
          </div>
        )}

        {groupedByDept.map(group => (
          <section key={group.department} className="space-y-3">
            <h2 className="text-xs font-bold tracking-widest uppercase text-slate-500 px-1">
              {group.department}
            </h2>
            <div className="space-y-3">
              {group.rows.map(eq => {
                const comment = comments[eq.equipment_id] ?? ''
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
                          onClick={() => void save(eq.equipment_id, comment)}
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

                    <textarea
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                      rows={2}
                      placeholder="Leave a comment about this placard (optional)"
                      value={comment}
                      onChange={(e) => {
                        const next = e.target.value
                        setComments(c => ({ ...c, [eq.equipment_id]: next }))
                        scheduleSave(eq.equipment_id, next)
                      }}
                    />
                  </article>
                )
              })}
            </div>
          </section>
        ))}

        <p className="text-center text-xs text-slate-400 pt-2">
          Comments are saved automatically as you type. You can close this tab when you&apos;re done.
        </p>
      </div>
    </main>
  )
}

interface DeptGroup { department: string; rows: Equipment[] }
function groupByDepartment(rows: Equipment[]): DeptGroup[] {
  const map = new Map<string, Equipment[]>()
  for (const eq of rows) {
    const dept = eq.department || '(no department)'
    const list = map.get(dept) ?? []
    list.push(eq)
    map.set(dept, list)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([department, rows]) => ({ department, rows }))
}

// ─── PhotoTile + helpers (unchanged from prior version) ───────────────────

function PhotoTile({
  url, label, upload, onReplace,
}: {
  url:        string | null | undefined
  label:      'Equipment' | 'Isolation'
  upload:     { status: PhotoUploadState; message?: string } | undefined
  onReplace:  (file: File) => void
}) {
  const reactId = useId()
  const inputId = `replace-photo-${reactId}`
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const disabled = upload?.status === 'uploading'

  function handleSelectedFile(file: File | null | undefined) {
    if (!file || disabled) return
    onReplace(file)
  }

  const dropHandlers = {
    onDragEnter: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault(); e.stopPropagation()
      if (disabled) return
      dragDepthRef.current += 1
      if (dragDepthRef.current === 1) setDragActive(true)
    },
    onDragOver: (e: DragEvent<HTMLDivElement>) => { e.preventDefault(); e.stopPropagation() },
    onDragLeave: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault(); e.stopPropagation()
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) setDragActive(false)
    },
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault(); e.stopPropagation()
      dragDepthRef.current = 0
      setDragActive(false)
      if (disabled) return
      const file = e.dataTransfer?.files?.[0]
      handleSelectedFile(file)
    },
  }

  const tileClass = 'relative aspect-video rounded-lg overflow-hidden'
  const controls = (
    <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1">
      <label
        htmlFor={inputId}
        className={`text-[11px] font-semibold uppercase tracking-wide bg-white/95 text-slate-700 px-2 py-1 rounded-md shadow border border-slate-200 transition ${
          disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-white'
        }`}
      >
        {upload?.status === 'uploading' ? 'Uploading…' : url ? 'Replace photo' : 'Add photo'}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/heic,image/heif,.jpg,.jpeg,.heic,.heif"
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
        Photo updated; ask the admin to regenerate the placard.
      </div>
    )
  }
  return (
    <div className="absolute top-2 left-2 right-2 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-semibold text-rose-700 shadow">
      {upload.message ?? 'Photo upload failed'}
    </div>
  )
}

function photoUploadKey(eqId: string, slot: PhotoSlot): string {
  return `${eqId}:${slot}`
}

function isPhotoStatus(s: unknown): s is Equipment['photo_status'] {
  return s === 'missing' || s === 'partial' || s === 'complete'
}

function validateReviewPhotoCandidate(file: File) {
  if (file.size <= 0) throw new Error('Photo file is empty')
  if (file.size > MAX_REVIEW_SOURCE_PHOTO_BYTES) {
    throw new Error('Photo must be 15 MB or smaller before processing')
  }
}

async function normalizeReviewPhoto(input: File): Promise<File> {
  let candidate: File = input
  if (isHeic(candidate)) {
    try {
      const converted = await heicToJpeg(candidate)
      candidate = new File([converted], renameTo(candidate.name, 'jpg'), { type: 'image/jpeg' })
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : 'HEIC conversion failed')
    }
  }
  if (candidate.type !== 'image/jpeg') {
    throw new Error('Photo must be a JPEG (or HEIC we can convert)')
  }
  try {
    const compressed = await compressImageInWorker(candidate)
    return new File([compressed], candidate.name, { type: 'image/jpeg' })
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Photo compression failed')
  }
}

function renameTo(name: string, extension: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return `${name}.${extension}`
  return `${name.slice(0, dot)}.${extension}`
}
