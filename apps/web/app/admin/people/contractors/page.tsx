'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Building2, CheckCircle2, Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  classifyInsurance,
  type ContractorCompany,
} from '@soteria/core/contractorCompliance'

// /admin/people/contractors — §1910.147(f)(2) contractor company register.
// Admin-only. Lists / adds / edits contractor companies, tracks
// insurance expiry, and records the host-procedures acknowledgement.

const STATUS_PILL = {
  current:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
  expiring: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  expired:  'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
  missing:  'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
} as const

export default function ContractorsPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [companies, setCompanies] = useState<ContractorCompany[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const { data, error: err } = await supabase
      .from('loto_contractor_companies')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
    if (err) {
      setError(formatSupabaseError(err, 'load contractors'))
      return
    }
    setCompanies((data ?? []) as ContractorCompany[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) load() }, [authLoading, profile, load])

  const now = useMemo(() => new Date(), [companies])  // eslint-disable-line react-hooks/exhaustive-deps

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  async function acknowledge(c: ContractorCompany) {
    if (!profile) return
    const { error: err } = await supabase
      .from('loto_contractor_companies')
      .update({
        host_procedures_acknowledged_at: new Date().toISOString(),
        host_acknowledged_by_user_id:    profile.id,
      })
      .eq('id', c.id)
    if (err) { setError(formatSupabaseError(err, 'acknowledge host procedures')); return }
    await load()
  }

  async function remove(c: ContractorCompany) {
    if (!confirm(`Deactivate contractor ${c.name}?`)) return
    const { error: err } = await supabase
      .from('loto_contractor_companies')
      .update({ active: false })
      .eq('id', c.id)
    if (err) { setError(formatSupabaseError(err, 'deactivate contractor')); return }
    await load()
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link href="/loto" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
            <ArrowLeft className="h-3 w-3" /> Back to LOTO
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-brand-navy" />
            Contractor companies
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            §1910.147(f)(2) — outside contractors must acknowledge the host&apos;s
            energy-control procedures. Track insurance expiry alongside the
            acknowledgement timestamp.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add contractor
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      {companies === null ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No contractor companies yet.</p>
        </div>
      ) : (
        <ul className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {companies.filter(c => c.active).map(c => {
            const ins = classifyInsurance(c.insurance_expires_at, now)
            const acknowledged = !!c.host_procedures_acknowledged_at
            return (
              <li key={c.id} className="px-4 py-3 flex items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{c.name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {c.contact_email && <>📧 {c.contact_email} </>}
                    {c.contact_phone && <>· 📞 {c.contact_phone}</>}
                  </p>
                  <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px]">
                    <span className={`px-2 py-0.5 rounded-md font-bold uppercase tracking-wider ${STATUS_PILL[ins.status]}`}>
                      Insurance: {ins.status}
                    </span>
                    {c.insurance_expires_at && (
                      <span className="text-slate-500 dark:text-slate-400">
                        expires {c.insurance_expires_at}
                      </span>
                    )}
                    {acknowledged ? (
                      <span className="text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Host procedures acknowledged {new Date(c.host_procedures_acknowledged_at!).toLocaleDateString()}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => acknowledge(c)}
                        className="text-[11px] px-2 py-0.5 rounded-md bg-brand-navy text-white font-semibold hover:bg-brand-navy/90 transition-colors"
                      >
                        Record acknowledgement
                      </button>
                    )}
                  </div>
                  {c.notes && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{c.notes}</p>}
                  <Link
                    href={`/admin/people/contractors/${c.id}/prequalification`}
                    className="mt-2 inline-block text-[11px] font-semibold text-brand-navy hover:underline"
                  >
                    Manage prequalification →
                  </Link>
                </div>
                <button
                  type="button"
                  onClick={() => remove(c)}
                  aria-label={`Deactivate ${c.name}`}
                  className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {addOpen && (
        <AddDialog
          tenantId={tenantId!}
          onClose={() => setAddOpen(false)}
          onAdded={async () => { setAddOpen(false); await load() }}
        />
      )}
    </div>
  )
}

function AddDialog({ tenantId, onClose, onAdded }: {
  tenantId: string
  onClose: () => void
  onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [insExp, setInsExp] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setErr(null)
    if (!name.trim()) { setErr('Company name is required.'); return }
    setSubmitting(true)
    const { error } = await supabase
      .from('loto_contractor_companies')
      .insert({
        tenant_id:            tenantId,
        name:                 name.trim(),
        contact_email:        email.trim() || null,
        contact_phone:        phone.trim() || null,
        insurance_expires_at: insExp || null,
      })
    setSubmitting(false)
    if (error) { setErr(formatSupabaseError(error, 'add contractor')); return }
    onAdded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add contractor</h2>
          <button type="button" onClick={onClose} disabled={submitting} className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-lg leading-none px-1">×</button>
        </header>
        <div className="space-y-3">
          <Field label="Company name">
            <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={submitting} className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
          </Field>
          <Field label="Contact email">
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} disabled={submitting} className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
          </Field>
          <Field label="Contact phone">
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} disabled={submitting} className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
          </Field>
          <Field label="Insurance expires" hint="Optional">
            <input type="date" value={insExp} onChange={e => setInsExp(e.target.value)} disabled={submitting} className="w-full rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20" />
          </Field>
        </div>
        {err && <p className="text-xs text-rose-600 dark:text-rose-400">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting} className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40">
            {submitting ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
        {hint && <span className="text-slate-400 dark:text-slate-500 font-normal ml-1.5">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
