'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { CheckCircle2, Copy, GraduationCap, Loader2, QrCode, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import {
  summarizePermitTraining,
  validateOverrideReason,
  type GatedPermitType,
  type PermitCrewTraining,
  type PermitTrainingStatusRow,
  type PermitTrainingSummary,
} from '@soteria/core/permitTrainingGate'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { strikeFetch } from '@/lib/strike/clientApi'

interface PermitTrainingPanelProps {
  tenantId: string
  permitType: GatedPermitType
  /** May be a pre-generated id for permits gated on insert (WAH, LOTO group). */
  permitId: string
  /** Roster members not (yet) in permit_workers: the issuer, or WAH worker/CP. */
  extraMemberIds?: string[]
  /** Bump to reload after the crew changes. */
  refreshKey?: number
  onSummary?: (summary: PermitTrainingSummary) => void
}

const POLL_WHILE_TRAINING_MS = 8000

// Mirrors the database gate (permit_training_status) so the supervisor sees
// exactly what will block issue — and fixes it on the spot with Train now.
export function PermitTrainingPanel({ tenantId, permitType, permitId, extraMemberIds = [], refreshKey = 0, onSummary }: PermitTrainingPanelProps) {
  const { role } = useTenant()
  const { profile } = useAuth()
  const canOverride = role === 'owner' || role === 'admin' || !!profile?.is_superadmin
  const [summary, setSummary] = useState<PermitTrainingSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [training, setTraining] = useState<{ member: PermitCrewTraining; moduleId: string; moduleTitle: string } | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const extraKey = extraMemberIds.join(',')

  const load = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc('permit_training_status', {
      p_tenant_id: tenantId,
      p_permit_type: permitType,
      p_permit_id: permitId,
      p_extra_member_ids: extraKey ? extraKey.split(',') : [],
    })
    if (rpcError) {
      setError(rpcError.message)
      return
    }
    setError(null)
    const next = summarizePermitTraining((data ?? []) as PermitTrainingStatusRow[])
    setSummary(next)
    onSummary?.(next)
  }, [tenantId, permitType, permitId, extraKey, onSummary])

  useEffect(() => { void load() }, [load, refreshKey])

  useEffect(() => {
    if (!training) return
    const timer = setInterval(() => { void load() }, POLL_WHILE_TRAINING_MS)
    return () => clearInterval(timer)
  }, [training, load])

  if (error) return <p className="text-sm text-rose-600">Could not check training: {error}</p>
  if (!summary) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking training…</p>
  if (!summary.gated) {
    return (
      <p className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <GraduationCap className="h-4 w-4" aria-hidden />
        No STRIKE training is required for this permit type. Admins can require modules on STRIKE → Triggers.
      </p>
    )
  }

  return (
    <section aria-labelledby="permit-training-title" className={`rounded-xl border-2 p-4 ${summary.ready ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20' : 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/20'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="permit-training-title" className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-slate-800 dark:text-slate-100">
          <GraduationCap className="h-4 w-4" aria-hidden /> Required training
        </h3>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${summary.ready ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-950'}`}>
            {summary.ready ? 'Crew ready' : `${summary.missingMemberIds.length} not trained — permit blocked`}
          </span>
          <button type="button" onClick={() => void load()} aria-label="Recheck training" className="rounded p-1.5 text-slate-500 hover:bg-white/60">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-slate-200/70 dark:divide-slate-800">
        {summary.crew.map(member => (
          <li key={member.memberId} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              {member.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="Trained" /> : <XCircle className="h-4 w-4 text-amber-600" aria-label="Not trained" />}
              {member.displayName}
            </span>
            <span className="flex flex-wrap justify-end gap-1.5">
              {member.modules.map(m => m.status === 'missing' ? (
                <button key={m.moduleId} type="button" onClick={() => setTraining({ member, moduleId: m.moduleId, moduleTitle: m.title })}
                  className="motion-press inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white">
                  <QrCode className="h-3.5 w-3.5" aria-hidden /> Train now · {m.title}
                </button>
              ) : (
                <span key={m.moduleId} className={`rounded-md px-2 py-1 text-xs ${m.status === 'overridden' ? 'bg-rose-100 font-semibold text-rose-800 dark:bg-rose-950/50 dark:text-rose-200' : 'bg-white/70 text-slate-600 dark:bg-slate-900 dark:text-slate-300'}`}>
                  {m.title} · {m.status === 'overridden' ? 'overridden' : m.expiresAt ? `current to ${new Date(m.expiresAt).toLocaleDateString()}` : 'current'}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>

      {!summary.ready && canOverride && (
        <button type="button" onClick={() => setOverrideOpen(true)}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 underline-offset-2 hover:underline dark:text-rose-300">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Emergency override (audited, EHS notified)
        </button>
      )}

      {training && (
        <TrainNowDialog
          tenantId={tenantId}
          memberId={training.member.memberId}
          memberName={training.member.displayName}
          moduleId={training.moduleId}
          moduleTitle={training.moduleTitle}
          onClose={() => { setTraining(null); void load() }}
        />
      )}
      {overrideOpen && (
        <OverrideDialog
          tenantId={tenantId}
          permitType={permitType}
          permitId={permitId}
          blocked={summary.crew.filter(c => !c.ready)}
          onClose={done => { setOverrideOpen(false); if (done) void load() }}
        />
      )}
    </section>
  )
}

function TrainNowDialog({ tenantId, memberId, memberName, moduleId, moduleTitle, onClose }: {
  tenantId: string; memberId: string; memberName: string; moduleId: string; moduleTitle: string; onClose: () => void
}) {
  const [link, setLink] = useState<{ url: string; qr: string; expiresAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    strikeFetch<{ url: string; expires_at: string }>('/api/strike/kiosk/token', tenantId, { body: { member_id: memberId, module_id: moduleId } })
      .then(async res => setLink({ url: res.url, expiresAt: res.expires_at, qr: await QRCode.toDataURL(res.url, { margin: 1, width: 240 }) }))
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [tenantId, memberId, moduleId])

  return (
    <Modal title={`Train now: ${memberName}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Have {memberName} scan this with their phone to take <strong>{moduleTitle}</strong> now, no login needed.
        This panel updates when they pass.
      </p>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {!link && !error && <Loader2 className="mx-auto mt-6 h-6 w-6 animate-spin text-slate-400" aria-label="Creating link" />}
      {link && (
        <div className="mt-4 flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
          <img src={link.qr} alt={`QR code to start ${moduleTitle} for ${memberName}`} className="h-60 w-60 rounded-lg border border-slate-200 bg-white p-2" />
          <div className="flex w-full gap-2">
            <a href={link.url} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-brand-navy px-3 py-2 text-center text-sm font-semibold text-white">Open on this device</a>
            <button type="button" onClick={async () => { await navigator.clipboard.writeText(link.url); setCopied(true) }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600">
              <Copy className="h-4 w-4" aria-hidden /> {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
          <p className="text-xs text-slate-500">Link expires {new Date(link.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p>
        </div>
      )}
    </Modal>
  )
}

function OverrideDialog({ tenantId, permitType, permitId, blocked, onClose }: {
  tenantId: string; permitType: GatedPermitType; permitId: string; blocked: PermitCrewTraining[]; onClose: (done: boolean) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(blocked.map(b => b.memberId)))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reasonProblem = validateOverrideReason(reason)

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await strikeFetch('/api/permits/training-override', tenantId, {
        body: { permit_type: permitType, permit_id: permitId, member_ids: [...selected], reason },
      })
      onClose(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  return (
    <Modal title="Emergency training override" onClose={() => onClose(false)}>
      <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
        This lets workers who have not passed required training work under this permit. It is permanent,
        recorded in the audit log, and emailed to every owner and admin. Use it only when waiting is less safe.
      </p>
      <fieldset className="mt-3 space-y-1.5">
        <legend className="text-xs font-semibold text-slate-600 dark:text-slate-300">Workers</legend>
        {blocked.map(b => (
          <label key={b.memberId} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={selected.has(b.memberId)} className="h-4 w-4 accent-rose-600"
              onChange={e => setSelected(prev => { const next = new Set(prev); if (e.target.checked) next.add(b.memberId); else next.delete(b.memberId); return next })} />
            {b.displayName}
          </label>
        ))}
      </fieldset>
      <label className="mt-3 block text-xs font-semibold text-slate-600 dark:text-slate-300">
        Reason
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder="What is the emergency, and why can't the work wait for training?"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal dark:border-slate-600" />
      </label>
      {reason && reasonProblem && <p className="mt-1 text-xs text-slate-500">{reasonProblem}</p>}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => onClose(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600">Cancel</button>
        <button type="button" onClick={submit} disabled={saving || !!reasonProblem || selected.size === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Record override
        </button>
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="stencil-title text-lg text-slate-900 dark:text-slate-100">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:text-slate-700"><XCircle className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
