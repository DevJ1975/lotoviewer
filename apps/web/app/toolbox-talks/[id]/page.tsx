'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, Users, CheckCircle2, Pencil, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import SignaturePad, { type SignaturePadRef } from '@/components/SignaturePad'
import { renderTalkMd } from '@/lib/markdown'

// /toolbox-talks/[id] — talk detail + sign-in sheet
//
// Shows the AI-generated body, key points, and the supervisor cue
// card. Below the talk: the sign-in roster (existing signatures) and
// the sign-in form. Two sign-in modes:
//   - Self: the logged-in user signs themselves. Once. The button
//     hides if they've already signed.
//   - Coworker: a non-Soteria worker types their name + signs. The
//     supervisor's session opens this drawer once and hands the
//     tablet around the room.

interface Signature {
  id:             string
  signer_user_id: string | null
  signer_name:    string
  employee_id:    string | null
  signed_at:      string
}

interface TalkDetail {
  id:             string
  tenant_id:      string
  topic_id:       string
  talk_date:      string
  title:          string
  body_markdown:  string
  key_points:     string[]
  delivery_notes: string | null
  generated_by:   string | null
  generated_at:   string
  ai_model:       string | null
}

interface DetailResponse {
  talk:           TalkDetail
  signatures:     Signature[]
  already_signed: boolean
}

export default function ToolboxTalkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { tenant } = useTenant()
  const { profile, email, userId } = useAuth()

  const [data,    setData]    = useState<DetailResponse | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const [signOpen,  setSignOpen]  = useState(false)
  const [coworker,  setCoworker]  = useState(false)
  const [signName,  setSignName]  = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitErr,  setSubmitErr]  = useState<string | null>(null)
  const sigRef = useRef<SignaturePadRef>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res  = await fetch(`/api/toolbox-talks/${id}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body as DetailResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  // Default the self-sign name to the auth profile's full_name on
  // open, so the worker doesn't have to retype what we already know.
  // Cleared and re-prompted in coworker mode.
  function openSelfSign() {
    setCoworker(false)
    setSignName(profile?.full_name ?? email ?? '')
    setEmployeeId('')
    setSubmitErr(null)
    setSignOpen(true)
  }
  function openCoworkerSign() {
    setCoworker(true)
    setSignName('')
    setEmployeeId('')
    setSubmitErr(null)
    setSignOpen(true)
  }
  function closeSign() {
    setSignOpen(false)
    sigRef.current?.clear()
  }

  async function submit() {
    if (!tenant?.id) return
    setSubmitErr(null)

    const trimmed = signName.trim()
    if (trimmed.length < 2) {
      setSubmitErr('Name is required (at least 2 characters).')
      return
    }
    if (sigRef.current?.isEmpty()) {
      setSubmitErr('Please sign in the box above.')
      return
    }
    const signature = sigRef.current?.toDataURL() ?? ''
    if (!signature) {
      setSubmitErr('Could not read signature. Try again.')
      return
    }

    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res = await fetch(`/api/toolbox-talks/${id}/sign`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          signer_name:    trimmed,
          employee_id:    employeeId.trim() || null,
          signature_data: signature,
          is_self:        !coworker,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      // Reload to refresh the roster and the already_signed flag.
      closeSign()
      await load()
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!data && !error) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <Link
          href="/toolbox-talks"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to talks
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {data && (
        <>
          <header>
            <div className="text-xs font-semibold uppercase tracking-wider text-brand-navy dark:text-blue-300">
              {formatDate(data.talk.talk_date)} · Toolbox Talk
            </div>
            <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
              {data.talk.title}
            </h1>
          </header>

          {data.talk.key_points.length > 0 && (
            <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                Key points
              </h2>
              <ul className="space-y-1.5">
                {data.talk.key_points.map((p, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-200">
                    <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section
            className="prose prose-slate dark:prose-invert max-w-none text-slate-800 dark:text-slate-200"
            dangerouslySetInnerHTML={{ __html: renderTalkMd(data.talk.body_markdown) }}
          />

          {data.talk.delivery_notes && (
            <section className="rounded-xl border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-950/30 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 mb-1">
                For the supervisor
              </h2>
              <p className="text-sm text-amber-900 dark:text-amber-100">
                {data.talk.delivery_notes}
              </p>
            </section>
          )}

          {/* ── Sign-in section ───────────────────────────────────────── */}
          <section className="rounded-xl border border-slate-200 dark:border-slate-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-2">
                <Users className="h-4 w-4" />
                Sign-in roster ({data.signatures.length})
              </h2>
              <div className="flex flex-wrap gap-2">
                {!data.already_signed && (
                  <button
                    type="button"
                    onClick={openSelfSign}
                    className="inline-flex items-center gap-1 rounded-md bg-brand-navy text-white px-3 py-1.5 text-sm font-semibold hover:bg-brand-navy/90"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Sign in
                  </button>
                )}
                <button
                  type="button"
                  onClick={openCoworkerSign}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Add coworker
                </button>
              </div>
            </div>

            {data.already_signed && (
              <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                You signed this talk on {formatRosterTime(
                  data.signatures.find(s => s.signer_user_id === userId)?.signed_at ?? ''
                )}.
              </div>
            )}

            {data.signatures.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No one has signed in yet. Be the first.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.signatures.map(s => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {s.signer_name}
                      </span>
                      {s.employee_id && (
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                          #{s.employee_id}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {formatRosterTime(s.signed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── Sign-in modal ─────────────────────────────────────────── */}
          {signOpen && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog">
              <div className="w-full max-w-md rounded-xl bg-white dark:bg-slate-950 p-5 shadow-xl">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {coworker ? 'Add coworker signature' : 'Sign in'}
                  </h3>
                  <button
                    type="button"
                    onClick={closeSign}
                    className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={signName}
                  onChange={e => setSignName(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Full name"
                  maxLength={120}
                />

                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mt-3 mb-1">
                  Employee ID <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={employeeId}
                  onChange={e => setEmployeeId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
                  placeholder="Badge or employee number"
                  maxLength={60}
                />

                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mt-3 mb-1">
                  Signature
                </label>
                <SignaturePad ref={sigRef} />
                <button
                  type="button"
                  onClick={() => sigRef.current?.clear()}
                  className="mt-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  Clear
                </button>

                {submitErr && (
                  <div className="mt-3 rounded-md bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
                    {submitErr}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeSign}
                    className="rounded-md px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="inline-flex items-center gap-1 rounded-md bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60"
                  >
                    {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Save signature
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function formatDate(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })
}

function formatRosterTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  // `new Date('garbage').getTime()` is NaN — guard so the green-pill
  // race condition (already_signed=true but no row matches userId)
  // doesn't render literal "Invalid Date" to the worker.
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}
