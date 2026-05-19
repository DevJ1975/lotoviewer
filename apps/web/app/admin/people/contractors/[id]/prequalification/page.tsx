'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, Copy, Loader2, Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  classifyPrequal,
  PREQUAL_STATUS_LABEL,
  type PrequalRow,
} from '@soteria/core/vendorPrequal'

// /admin/people/contractors/[id]/prequalification — manage the prequal cycle
// for a single contractor company. Admins can:
//   1. Start a new prequal (issues a portal_token automatically).
//   2. Copy the contractor portal URL.
//   3. Approve / reject submitted prequals with an expiry date.

const STATUS_PILL = {
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  expiring: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  expired:  'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
  pending:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
} as const

interface PrequalDetail extends PrequalRow {
  id:                       string
  contractor_company_id:    string
  q1_safety_management:     string | null
  q2_emr:                   string | null
  q3_dart:                  string | null
  q4_trir:                  string | null
  q5_iso_certs:             string | null
  q6_drug_alcohol_program:  boolean
  q7_insurance_limits:      string | null
  q8_references:            string | null
  submitted_at:             string | null
  reviewed_at:              string | null
  portal_token:             string | null
  review_notes:             string | null
  created_at:               string
}

interface ContractorRow {
  id:   string
  name: string
}

export default function ContractorPrequalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: contractorId } = use(params)
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [contractor, setContractor] = useState<ContractorRow | null>(null)
  const [rows, setRows]   = useState<PrequalDetail[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const [cRes, pRes] = await Promise.all([
      supabase
        .from('loto_contractor_companies')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .eq('id', contractorId)
        .maybeSingle(),
      supabase
        .from('vendor_prequalifications')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('contractor_company_id', contractorId)
        .order('created_at', { ascending: false }),
    ])
    if (cRes.error) { setError(formatSupabaseError(cRes.error, 'load contractor')); return }
    if (pRes.error) { setError(formatSupabaseError(pRes.error, 'load prequals')); return }
    setContractor(cRes.data as ContractorRow | null)
    setRows((pRes.data ?? []) as PrequalDetail[])
  }, [tenantId, contractorId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  async function invite() {
    if (!tenantId) return
    setCreating(true)
    setError(null)
    const { error: err } = await supabase
      .from('vendor_prequalifications')
      .insert({
        tenant_id:             tenantId,
        contractor_company_id: contractorId,
        status:                'invited',
      })
    setCreating(false)
    if (err) { setError(formatSupabaseError(err, 'invite contractor')); return }
    await load()
  }

  async function decide(prequalId: string, decision: 'approved' | 'rejected', approvalExpiresAt: string | null, notes: string) {
    if (!profile) return
    setError(null)
    const { error: err } = await supabase
      .from('vendor_prequalifications')
      .update({
        status:                decision,
        reviewed_at:           new Date().toISOString(),
        reviewed_by_user_id:   profile.id,
        approval_expires_at:   decision === 'approved' ? approvalExpiresAt : null,
        review_notes:          notes.trim() || null,
      })
      .eq('id', prequalId)
    if (err) { setError(formatSupabaseError(err, `mark ${decision}`)); return }
    await load()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/people/contractors" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to contractors
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="h-6 w-6 text-brand-navy" />
          {contractor?.name ?? 'Contractor'} — prequalifications
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Issue a tokenized link to the contractor, review their submission, and approve with an
          expiry date. Approvals are valid until <span className="font-mono">approval_expires_at</span>.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <button
        type="button"
        onClick={invite}
        disabled={creating}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
      >
        <Plus className="h-4 w-4" /> {creating ? 'Issuing…' : 'New prequalification cycle'}
      </button>

      {rows === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No prequalifications yet.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map(r => (
            <PrequalCard key={r.id} row={r} onDecide={decide} />
          ))}
        </ul>
      )}
    </div>
  )
}

function PrequalCard({ row, onDecide }: {
  row: PrequalDetail
  onDecide: (id: string, decision: 'approved' | 'rejected', approvalExpiresAt: string | null, notes: string) => Promise<void>
}) {
  const [copied, setCopied] = useState(false)
  const now = useMemo(() => new Date(), [])
  const classified = classifyPrequal(row, now)
  const [expiry, setExpiry] = useState(() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [notes, setNotes] = useState(row.review_notes ?? '')

  const portalUrl = row.portal_token && typeof window !== 'undefined'
    ? `${window.location.origin}/contractor-prequal/${row.portal_token}`
    : null

  async function copy() {
    if (!portalUrl) return
    try {
      await navigator.clipboard.writeText(portalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* silent — user can long-press */ }
  }

  return (
    <li className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Cycle created {new Date(row.created_at).toLocaleDateString()}</p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {row.submitted_at ? `Submitted ${new Date(row.submitted_at).toLocaleString()}` : 'Awaiting contractor submission'}
            {row.approval_expires_at && row.status === 'approved' && (
              <> · expires {row.approval_expires_at}</>
            )}
          </p>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_PILL[classified]}`}>
          {PREQUAL_STATUS_LABEL[classified]}
        </span>
      </div>

      {portalUrl && !row.submitted_at && (
        <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 px-3 py-2 text-xs">
          <p className="font-bold text-slate-600 dark:text-slate-300 mb-1">Contractor portal link</p>
          <p className="font-mono break-all text-slate-700 dark:text-slate-300">{portalUrl}</p>
          <button type="button" onClick={copy} className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-navy hover:underline">
            <Copy className="h-3 w-3" /> {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}

      {row.submitted_at && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <Answer label="Safety management" value={row.q1_safety_management} />
          <Answer label="EMR"                value={row.q2_emr} />
          <Answer label="DART"               value={row.q3_dart} />
          <Answer label="TRIR"               value={row.q4_trir} />
          <Answer label="ISO certifications" value={row.q5_iso_certs} />
          <Answer label="Drug & alcohol program" value={row.q6_drug_alcohol_program ? 'Yes' : 'No'} />
          <Answer label="Insurance limits"   value={row.q7_insurance_limits} />
          <Answer label="References"         value={row.q8_references} />
        </div>
      )}

      {row.submitted_at && !row.reviewed_at && (
        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Approval expiry</label>
            <input type="date" value={expiry} onChange={e => setExpiry(e.target.value)} className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-xs" />
          </div>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Review notes (visible to the contractor)"
            rows={2}
            className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onDecide(row.id, 'rejected', null, notes)}
              className="px-3 py-1.5 rounded-md text-xs font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => onDecide(row.id, 'approved', expiry || null, notes)}
              disabled={!expiry}
              className="px-3 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              Approve
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function Answer({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1.5 bg-slate-50 dark:bg-slate-950/40">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
      <p className="text-xs text-slate-900 dark:text-slate-100 whitespace-pre-wrap">{value ?? '—'}</p>
    </div>
  )
}
