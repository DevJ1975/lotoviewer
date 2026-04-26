'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, LifeBuoy, Loader2, CheckCircle2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { SEVERITY_LABELS, type BugSeverity } from '@/lib/bugReport'

// Bug report form. Open to any signed-in user — every field worker is
// also a potential bug reporter. The form auto-captures page URL and
// user agent; the API route fills in the reporter identity from the
// auth session so you can't spoof who's reporting.

export default function SupportPage() {
  const { profile, email, loading: authLoading } = useAuth()
  const [title, setTitle]             = useState('')
  const [severity, setSeverity]       = useState<BugSeverity>('medium')
  const [description, setDescription] = useState('')
  const [steps, setSteps]             = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [submitted, setSubmitted]     = useState(false)

  // Auto-captured context. Read once on mount so it reflects the page
  // the user came from rather than /support.
  const [pageUrl,   setPageUrl]   = useState<string>('')
  const [userAgent, setUserAgent] = useState<string>('')
  useEffect(() => {
    if (typeof window === 'undefined') return
    setPageUrl(document.referrer || window.location.href)
    setUserAgent(navigator.userAgent)
  }, [])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!profile) {
    return (
      <div className="max-w-md mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700">Sign in to report a bug.</p>
        <Link href="/login" className="inline-block px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors">
          Sign in
        </Link>
      </div>
    )
  }

  async function submit() {
    setError(null)
    if (!title.trim() || description.trim().length < 10) {
      setError('Add a title and at least a sentence describing the issue.')
      return
    }
    setSubmitting(true)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Sign in expired — please log in again.')
      const res = await fetch('/api/support/bug-report', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title:       title.trim(),
          description: description.trim(),
          steps:       steps.trim() || undefined,
          severity,
          page_url:    pageUrl   || undefined,
          user_agent:  userAgent || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
      setSubmitted(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the report.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <LifeBuoy className="h-5 w-5 text-slate-500" />
            Support
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Report a bug or send feedback. Submissions email{' '}
            <span className="font-mono">jamil@trainovations.com</span>.
          </p>
        </div>
      </header>

      {submitted ? (
        <section className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center space-y-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 mx-auto" />
          <div>
            <p className="text-base font-bold text-emerald-900">Report sent.</p>
            <p className="text-xs text-emerald-900/80 mt-1">
              Thanks — we'll follow up at <span className="font-mono">{email}</span> if we need anything else.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setTitle(''); setDescription(''); setSteps(''); setSeverity('medium'); setSubmitted(false)
            }}
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Submit another report
          </button>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <Field label="Title" hint="Short summary of the problem">
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
              placeholder="e.g. Equipment list never loads on iPad"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          <Field label="Severity">
            <select
              value={severity}
              onChange={e => setSeverity(e.target.value as BugSeverity)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              {(['critical', 'high', 'medium', 'low'] as const).map(s => (
                <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
              ))}
            </select>
          </Field>

          <Field label="Description" hint="What happened? What did you expect to happen?">
            <textarea
              rows={5}
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={10_000}
              placeholder="Describe the issue in your own words…"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          <Field label="Steps to reproduce" hint="Optional — what you did just before the issue">
            <textarea
              rows={3}
              value={steps}
              onChange={e => setSteps(e.target.value)}
              maxLength={5_000}
              placeholder={'1. Open LOTO\n2. Tap a row\n3. ...'}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          {/* Auto-captured context — surfaced read-only so the user
              knows what we're sending. We send the page they came
              FROM (document.referrer) since that's the buggy screen,
              not /support. */}
          <details className="text-[11px] text-slate-500">
            <summary className="cursor-pointer font-semibold">What gets sent automatically</summary>
            <ul className="mt-1 space-y-0.5 pl-4">
              <li>• Your name + email: <span className="font-mono">{email}</span></li>
              {pageUrl   && <li>• Page URL: <span className="font-mono break-all">{pageUrl}</span></li>}
              {userAgent && <li>• User agent: <span className="font-mono break-all">{userAgent}</span></li>}
            </ul>
          </details>

          {error && (
            <p className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">
              {error}{' '}
              <span className="text-rose-900/80">
                You can email <span className="font-mono">jamil@trainovations.com</span> directly if it keeps failing.
              </span>
            </p>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              {submitting ? 'Sending…' : 'Send report'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-600">
        {label}
        {hint && <span className="text-slate-400 font-normal ml-1.5">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
