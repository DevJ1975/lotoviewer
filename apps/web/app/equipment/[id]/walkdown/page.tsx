'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Camera, ClipboardCheck, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { Equipment } from '@soteria/core/types'
import {
  checklistCompletion,
  defaultWalkdownItems,
  WALKDOWN_ITEM_STATUS_LABELS,
  type WalkdownChecklistRow,
  type WalkdownItem,
  type WalkdownItemStatus,
} from '@soteria/core/lotoWalkdownChecklist'
import { walkdownPhotoPath } from '@soteria/core/storagePaths'

// /equipment/[id]/walkdown — §147(c)(6) walkdown checklist form.
//
// Builds on the default 6-item checklist. Per-item photo upload uses
// the existing loto-photos bucket; the path is namespaced under
// /walkdowns/<eq>/ so the asset RLS keeps the photos tenant-scoped.

export default function WalkdownPage() {
  return (
    <Suspense fallback={<Loader />}>
      <WalkdownForm />
    </Suspense>
  )
}

function Loader() {
  return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
}

function WalkdownForm() {
  const { id } = useParams<{ id: string }>()
  const equipmentId = decodeURIComponent(id)
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const [history, setHistory] = useState<WalkdownChecklistRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null)

  // Form state — local-only until Sign + save.
  const [items, setItems] = useState<WalkdownItem[]>(defaultWalkdownItems())
  const [completedByName, setCompletedByName] = useState('')
  const [generalNotes, setGeneralNotes] = useState('')
  const [signedName, setSignedName] = useState('')

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    try {
      const [eqResult, historyResult] = await Promise.all([
        supabase.from('loto_equipment').select('*').eq('tenant_id', tenantId).eq('equipment_id', equipmentId).single(),
        supabase.from('loto_walkdown_checklists').select('*').eq('tenant_id', tenantId).eq('equipment_id', equipmentId).order('walkdown_date', { ascending: false }),
      ])
      if (eqResult.error)      throw new Error(formatSupabaseError(eqResult.error,      'load equipment'))
      if (historyResult.error) throw new Error(formatSupabaseError(historyResult.error, 'load walkdown history'))
      setEquipment(eqResult.data as Equipment)
      setHistory((historyResult.data ?? []) as WalkdownChecklistRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load walkdown.')
    }
  }, [tenantId, equipmentId])

  useEffect(() => { if (!authLoading && profile?.is_admin) load() }, [authLoading, profile, load])

  useEffect(() => {
    if (!completedByName && profile?.full_name) setCompletedByName(profile.full_name)
  }, [profile, completedByName])

  if (authLoading) return <Loader />
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }
  if (!equipment) return <Loader />

  function patchItem(itemId: string, patch: Partial<WalkdownItem>) {
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, ...patch } : it))
  }

  async function uploadPhoto(itemId: string, file: File) {
    if (!tenantId) return
    setUploadingItemId(itemId)
    setError(null)
    try {
      const path = walkdownPhotoPath(tenantId, equipmentId, itemId)
      const { error: upErr } = await supabase.storage.from('loto-photos').upload(path, file, {
        cacheControl: '3600',
        contentType:  file.type || 'image/jpeg',
        upsert:       true,
      })
      if (upErr) throw new Error(upErr.message)
      const { data } = supabase.storage.from('loto-photos').getPublicUrl(path)
      patchItem(itemId, { photo_url: data.publicUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload photo.')
    } finally {
      setUploadingItemId(null)
    }
  }

  async function saveSigned() {
    if (!tenantId || !profile) return
    setError(null)
    if (!completedByName.trim()) { setError('Inspector name is required.'); return }
    if (!signedName.trim()) { setError('Type your name to sign.'); return }
    const completion = checklistCompletion(items)
    if (!completion.complete) {
      if (completion.pending.length > 0) {
        setError(`Mark every item before signing — ${completion.pending.length} still pending.`)
      } else {
        setError(`Each Fail must include notes — ${completion.fails_without_notes.length} missing.`)
      }
      return
    }
    setBusy(true)
    try {
      const { error: err } = await supabase
        .from('loto_walkdown_checklists')
        .insert({
          tenant_id:            tenantId,
          equipment_id:         equipmentId,
          walkdown_date:        new Date().toISOString().slice(0, 10),
          items,
          completed_by_user_id: profile.id,
          completed_by_name:    completedByName.trim(),
          signed:               true,
          signed_name:          signedName.trim(),
          signed_at:            new Date().toISOString(),
          notes:                generalNotes.trim() || null,
        })
      if (err) throw new Error(formatSupabaseError(err, 'save walkdown'))
      // Reset to a fresh checklist + reload history so the new row
      // shows up at the top.
      setItems(defaultWalkdownItems())
      setGeneralNotes('')
      setSignedName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save walkdown.')
    } finally {
      setBusy(false)
    }
  }

  const completion = checklistCompletion(items)

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href={`/equipment/${encodeURIComponent(equipmentId)}`} className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to equipment
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-brand-navy" />
          Walkdown checklist · {equipment.equipment_id}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {equipment.description} · {equipment.department}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Walked by</span>
          <input
            type="text"
            value={completedByName}
            onChange={e => setCompletedByName(e.target.value)}
            disabled={busy}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
        </label>

        <ul className="space-y-3">
          {items.map(it => (
            <li key={it.id} className="rounded-md border border-slate-100 dark:border-slate-800 p-3 space-y-2">
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{it.label}</p>
              <div className="flex items-center gap-2 flex-wrap">
                {(['pass', 'fail', 'n_a'] as WalkdownItemStatus[]).map(s => (
                  <label key={s} className="inline-flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="radio"
                      name={`status-${it.id}`}
                      checked={it.status === s}
                      onChange={() => patchItem(it.id, { status: s })}
                      disabled={busy}
                      className="h-4 w-4 text-brand-navy focus:ring-brand-navy/30"
                    />
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                      s === 'pass' ? 'bg-emerald-100 text-emerald-800' :
                      s === 'fail' ? 'bg-rose-100 text-rose-800' :
                      'bg-slate-100 text-slate-700'
                    }`}>{WALKDOWN_ITEM_STATUS_LABELS[s]}</span>
                  </label>
                ))}
              </div>
              <textarea
                value={it.notes ?? ''}
                onChange={e => patchItem(it.id, { notes: e.target.value })}
                disabled={busy}
                placeholder={it.status === 'fail' ? 'Required for Fail — what was wrong?' : 'Notes (optional)'}
                rows={2}
                className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1 text-[11px] cursor-pointer text-slate-600 dark:text-slate-300 hover:text-brand-navy">
                  <Camera className="h-3.5 w-3.5" />
                  {uploadingItemId === it.id ? 'Uploading…' : (it.photo_url ? 'Replace photo' : 'Attach photo')}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    disabled={busy || uploadingItemId === it.id}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) uploadPhoto(it.id, f)
                    }}
                  />
                </label>
                {it.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.photo_url} alt={`Evidence for ${it.label}`} className="h-12 w-12 object-cover rounded-md border border-slate-200 dark:border-slate-700" />
                )}
              </div>
            </li>
          ))}
        </ul>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">General notes</span>
          <textarea
            value={generalNotes}
            onChange={e => setGeneralNotes(e.target.value)}
            disabled={busy}
            rows={2}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
        </label>

        {!completion.complete && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            {completion.pending.length > 0
              ? `${completion.pending.length} item${completion.pending.length === 1 ? '' : 's'} not yet marked.`
              : `Each Fail must include notes (${completion.fails_without_notes.length} missing).`}
          </div>
        )}

        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-2">
          <p className="text-[11px] text-slate-600 dark:text-slate-300">
            By signing, you certify this walkdown was performed today and the
            results above are accurate.
          </p>
          <input
            type="text"
            value={signedName}
            onChange={e => setSignedName(e.target.value)}
            placeholder="Type your name to sign"
            disabled={busy}
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
        </div>

        <button
          type="button"
          onClick={saveSigned}
          disabled={busy || !completion.complete}
          className="w-full rounded-lg bg-brand-navy text-white text-sm font-semibold py-2.5 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Sign & save walkdown'}
        </button>
      </section>

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
        <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">No prior walkdowns.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.map(h => {
              const passes = h.items.filter(i => i.status === 'pass').length
              const fails  = h.items.filter(i => i.status === 'fail').length
              return (
                <li key={h.id} className="py-3">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {h.walkdown_date} · {h.completed_by_name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {passes} pass · {fails} fail · {h.items.length - passes - fails} N/A
                    {h.notes && <> · {h.notes}</>}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
