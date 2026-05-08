'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Script from 'next/script'
import {
  AlertTriangle, CheckCircle2, Image as ImageIcon, Loader2,
  Mic, ShieldCheck, X,
} from 'lucide-react'
import {
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABEL,
  type IncidentType,
} from '@soteria/core/incident'
import { supabase } from '@/lib/supabase'
import { pickLocale, t as catalog, type Locale } from '@/lib/anonReport/i18n'

// /report/[token] — Public anonymous incident-reporting form.
//
// Phase 2 upgrade adds: severity quick-tap, photo + voice
// attachments, optional receipt PIN, locale switching, optional
// Turnstile captcha when the token requires it.

interface VerifyResponse {
  label:                 string
  tenant_name:           string | null
  default_locale:        Locale | null
  retaliation_statement: string | null
  require_captcha:       boolean
  turnstile_site_key:    string | null
}

interface Submitted {
  report_number: string
  receipt_pin:   string | null
}

interface UploadTarget { path: string; token: string }

interface PendingFile {
  file:  File
  kind:  'image' | 'audio'
  preview?: string
}

const ATTACH_BUCKET = 'loto-photos'
const MAX_PHOTOS    = 3
const MAX_BYTES     = 10 * 1024 * 1024

function isoLocalNow() {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

declare global {
  interface Window {
    // Cloudflare Turnstile global injected by the script tag.
    turnstile?: {
      render: (el: HTMLElement, opts: {
        sitekey:   string
        callback:  (token: string) => void
        'error-callback'?: () => void
      }) => string
      reset:  (id?: string) => void
    }
  }
}

export default function AnonymousReportPage() {
  const { token } = useParams<{ token: string }>()
  const search    = useSearchParams()

  const [verify,    setVerify]    = useState<VerifyResponse | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [locale, setLocale] = useState<Locale>('en')
  const T = useMemo(() => catalog(locale), [locale])

  const [severityQuick, setSeverityQuick] = useState<'green' | 'amber' | 'red' | ''>('')
  const [showDetails,   setShowDetails]   = useState(false)

  const [incidentType, setIncidentType] = useState<IncidentType | ''>('')
  const [occurredAt,   setOccurredAt]   = useState(isoLocalNow())
  const [description,  setDescription]  = useState('')
  const [immediate,    setImmediate]    = useState('')

  const [pending, setPending] = useState<PendingFile[]>([])
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])

  const [requestPin, setRequestPin] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileEl = useRef<HTMLDivElement>(null)

  const [submitting,  setSubmitting]  = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitted,   setSubmitted]   = useState<Submitted | null>(null)

  // Resolve token → label / locale / captcha config.
  useEffect(() => {
    let cancelled = false
    if (!token) return
    void (async () => {
      try {
        const res = await fetch(`/api/anonymous-report/verify/${token}`)
        const body = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setLoadError(body.error ?? `HTTP ${res.status}`)
          return
        }
        const v = body as VerifyResponse
        setVerify(v)
        const browserLang = typeof navigator !== 'undefined' ? navigator.language : null
        setLocale(pickLocale([
          search.get('locale'),
          v.default_locale,
          browserLang,
        ]))
      } catch (e) {
        if (cancelled) return
        setLoadError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [token, search])

  // Render Turnstile widget if the token requires captcha and the
  // script has loaded. We re-render on locale change because the
  // widget's i18n is keyed off mount time.
  useEffect(() => {
    if (!verify?.require_captcha || !verify.turnstile_site_key) return
    function tryRender() {
      if (!turnstileEl.current || !window.turnstile) return false
      window.turnstile.render(turnstileEl.current, {
        sitekey: verify!.turnstile_site_key!,
        callback: (tk) => setTurnstileToken(tk),
        'error-callback': () => setTurnstileToken(null),
      })
      return true
    }
    if (!tryRender()) {
      const id = setInterval(() => { if (tryRender()) clearInterval(id) }, 200)
      return () => clearInterval(id)
    }
  }, [verify])

  function addPhotos(files: FileList | null) {
    if (!files) return
    const existing = pending.filter(p => p.kind === 'image').length
    const slots = MAX_PHOTOS - existing
    const toAdd: PendingFile[] = []
    for (let i = 0; i < files.length && i < slots; i++) {
      const f = files[i]
      if (f.size > MAX_BYTES) continue
      if (!/^image\//.test(f.type)) continue
      toAdd.push({ file: f, kind: 'image', preview: URL.createObjectURL(f) })
    }
    setPending(p => [...p, ...toAdd])
  }

  async function startRecording() {
    if (recording) return
    if (pending.some(p => p.kind === 'audio')) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mr = new MediaRecorder(stream)
      chunksRef.current = []
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' })
        const f = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type })
        setPending(p => [...p, { file: f, kind: 'audio' }])
        stream.getTracks().forEach(track => track.stop())
      }
      recorderRef.current = mr
      mr.start()
      setRecording(true)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Microphone unavailable')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setRecording(false)
  }

  function removePending(idx: number) {
    setPending(p => {
      const next = [...p]
      const [gone] = next.splice(idx, 1)
      if (gone.preview) URL.revokeObjectURL(gone.preview)
      return next
    })
  }

  async function uploadAttachments(uploads: UploadTarget[], incidentId: string) {
    const recorded: Array<{ path: string; mime: string; byte_size: number }> = []
    for (let i = 0; i < pending.length && i < uploads.length; i++) {
      const target = uploads[i]
      const f = pending[i].file
      const { error } = await supabase.storage
        .from(ATTACH_BUCKET)
        .uploadToSignedUrl(target.path, target.token, f, { contentType: f.type })
      if (!error) {
        recorded.push({ path: target.path, mime: f.type, byte_size: f.size })
      }
    }
    if (recorded.length === 0) return
    await fetch('/api/anonymous-report/attach', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ incident_id: incidentId, attachments: recorded }),
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Allow severity-only fast path: pick a quick severity, hit submit,
    // and we synthesize a minimal "near-miss" report under the hood.
    const quickOnly = severityQuick && !showDetails
    if (!quickOnly) {
      if (!incidentType) { setSubmitError(T.errorPickType); return }
      if (!description.trim() && !severityQuick) {
        setSubmitError(T.errorPickDescription); return
      }
    }
    if (verify?.require_captcha && !turnstileToken) {
      setSubmitError(T.errorCaptcha); return
    }

    setSubmitting(true); setSubmitError(null)
    try {
      const res = await fetch('/api/anonymous-report', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          token,
          incident_type:           quickOnly ? 'near-miss' : incidentType,
          occurred_at:             new Date(occurredAt).toISOString(),
          description:             description.trim()
                                     || (quickOnly ? `[severity:${severityQuick}] (no narrative provided)` : ''),
          immediate_action_taken:  immediate.trim() || null,
          severity_quick:          severityQuick || undefined,
          request_pin:             requestPin,
          request_uploads:         pending.length,
          turnstile_token:         turnstileToken,
        }),
      })
      const body = await res.json() as {
        error?: string; report_number?: string; incident_id?: string
        receipt_pin?: string | null; uploads?: UploadTarget[]
      }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      if (body.uploads && body.incident_id && pending.length > 0) {
        try { await uploadAttachments(body.uploads, body.incident_id) }
        catch { /* attachments are best-effort; the report itself is filed */ }
      }

      setSubmitted({
        report_number: body.report_number!,
        receipt_pin:   body.receipt_pin ?? null,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setSubmitError(msg.includes('Too many') ? T.errorRateLimit
                   : msg.includes('Security') ? T.errorCaptcha
                   : msg || T.errorGeneric)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10 px-4">
      <div className="max-w-xl mx-auto">
        <header className="text-center mb-6">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
            {T.brand}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
            {T.pageTitle}
          </h1>
          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            {T.shieldNote}
          </p>
          <LocaleSwitcher locale={locale} setLocale={setLocale} />
        </header>

        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm p-6">
          {loadError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-sm text-rose-800 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{loadError === 'This link is invalid or no longer active.' ? T.errorTokenInvalid : loadError}</span>
            </div>
          )}

          {!loadError && !verify && (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
            </div>
          )}

          {verify && submitted && <SubmittedView T={T} verify={verify} submitted={submitted} />}

          {verify && !submitted && (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-sm">
                <p className="text-slate-700 dark:text-slate-200">
                  {T.reportingFrom}: <strong>{verify.label}</strong>
                  {verify.tenant_name && <> · {verify.tenant_name}</>}
                </p>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {verify.retaliation_statement ?? T.retaliationDefault}
                </p>
              </div>

              {/* Severity quick-tap. Always visible. */}
              <SeverityQuickTap
                T={T}
                value={severityQuick}
                onChange={setSeverityQuick}
              />

              {/* Detail disclosure. Once a severity is picked, the
                  reporter can submit immediately or expand to add
                  detail. If no severity is picked, detail is open by
                  default so the typed flow still works. */}
              {(severityQuick && !showDetails) ? (
                <button
                  type="button"
                  onClick={() => setShowDetails(true)}
                  className="text-sm font-semibold text-brand-navy underline-offset-2 hover:underline"
                >
                  + {T.fieldWhat}
                </button>
              ) : (
                <DetailFields
                  T={T}
                  incidentType={incidentType} setIncidentType={setIncidentType}
                  occurredAt={occurredAt}     setOccurredAt={setOccurredAt}
                  description={description}   setDescription={setDescription}
                  immediate={immediate}       setImmediate={setImmediate}
                />
              )}

              <Attachments
                T={T}
                pending={pending}
                onAddPhotos={addPhotos}
                onRemove={removePending}
                onStartRecording={startRecording}
                onStopRecording={stopRecording}
                recording={recording}
              />

              <ReceiptOptIn T={T} value={requestPin} onChange={setRequestPin} />

              {verify.require_captcha && verify.turnstile_site_key && (
                <>
                  <Script
                    src="https://challenges.cloudflare.com/turnstile/v0/api.js"
                    strategy="afterInteractive"
                  />
                  <div ref={turnstileEl} className="flex justify-center" />
                </>
              )}

              {submitError && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-900 p-3 text-sm text-rose-800 dark:text-rose-200">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
              >
                {submitting ? T.submitting : T.submit}
              </button>

              <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                {T.privacyFooter}
              </p>

              <p className="text-[11px] text-center">
                <Link href="/report/status" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 underline-offset-2 hover:underline">
                  {T.statusLookupCta}
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

function LocaleSwitcher({ locale, setLocale }: { locale: Locale; setLocale: (l: Locale) => void }) {
  return (
    <div className="mt-2 inline-flex gap-1 text-[11px]">
      {(['en', 'es'] as const).map(l => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={
            'rounded px-1.5 py-0.5 ' +
            (l === locale
              ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200')
          }
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

function SeverityQuickTap({
  T, value, onChange,
}: {
  T: ReturnType<typeof catalog>
  value: 'green' | 'amber' | 'red' | ''
  onChange: (v: 'green' | 'amber' | 'red') => void
}) {
  const opts: Array<{ key: 'green' | 'amber' | 'red'; label: string; tint: string; ring: string }> = [
    { key: 'green', label: T.severityGreen, tint: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',  ring: 'ring-emerald-500' },
    { key: 'amber', label: T.severityAmber, tint: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',          ring: 'ring-amber-500'   },
    { key: 'red',   label: T.severityRed,   tint: 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',              ring: 'ring-rose-500'    },
  ]
  return (
    <fieldset>
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {T.severityHeading}
        <span className="ml-2 text-[11px] font-normal text-slate-400">{T.severityHint}</span>
      </legend>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {opts.map(o => (
          <button
            type="button"
            key={o.key}
            onClick={() => onChange(o.key)}
            className={
              `rounded-lg px-3 py-3 text-sm font-semibold transition-shadow ${o.tint} ` +
              (value === o.key ? `ring-2 ${o.ring}` : 'ring-1 ring-transparent')
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function DetailFields({
  T, incidentType, setIncidentType, occurredAt, setOccurredAt,
  description, setDescription, immediate, setImmediate,
}: {
  T: ReturnType<typeof catalog>
  incidentType: IncidentType | ''
  setIncidentType: (t: IncidentType | '') => void
  occurredAt: string; setOccurredAt: (s: string) => void
  description: string; setDescription: (s: string) => void
  immediate: string;   setImmediate: (s: string) => void
}) {
  return (
    <>
      <Field label={T.fieldEventKind} required>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {INCIDENT_TYPES.map(tp => (
            <label
              key={tp}
              className={
                'flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ' +
                (incidentType === tp
                  ? 'border-brand-navy bg-brand-navy/5 dark:bg-brand-navy/20'
                  : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600')
              }
            >
              <input
                type="radio"
                name="incident_type"
                value={tp}
                checked={incidentType === tp}
                onChange={() => setIncidentType(tp)}
                className="mt-1"
              />
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                {INCIDENT_TYPE_LABEL[tp]}
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label={T.fieldWhen} required>
        <input
          type="datetime-local"
          value={occurredAt}
          onChange={e => setOccurredAt(e.target.value)}
          max={isoLocalNow()}
          required
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={T.fieldWhat} required>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={5}
          placeholder={T.fieldWhatPlaceholder}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={T.fieldImmediate} hint={T.hintOptional}>
        <textarea
          value={immediate}
          onChange={e => setImmediate(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
        />
      </Field>
    </>
  )
}

function Attachments({
  T, pending, onAddPhotos, onRemove, onStartRecording, onStopRecording, recording,
}: {
  T: ReturnType<typeof catalog>
  pending: PendingFile[]
  onAddPhotos: (f: FileList | null) => void
  onRemove: (idx: number) => void
  onStartRecording: () => void
  onStopRecording: () => void
  recording: boolean
}) {
  const photoCount = pending.filter(p => p.kind === 'image').length
  const hasAudio   = pending.some(p => p.kind === 'audio')
  return (
    <div>
      <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {T.attachmentsHeading}
        <span className="ml-2 text-[11px] font-normal text-slate-400">{T.attachmentsHint}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <label
          className={
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium cursor-pointer ' +
            (photoCount >= MAX_PHOTOS
              ? 'border-slate-200 text-slate-400 cursor-not-allowed'
              : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')
          }
        >
          <ImageIcon className="h-3.5 w-3.5" />
          {T.addPhoto}
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={photoCount >= MAX_PHOTOS}
            onChange={e => onAddPhotos(e.target.files)}
            className="hidden"
          />
        </label>

        {!hasAudio && !recording && (
          <button
            type="button"
            onClick={onStartRecording}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Mic className="h-3.5 w-3.5" />
            {T.addVoice}
          </button>
        )}
        {recording && (
          <button
            type="button"
            onClick={onStopRecording}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-200"
          >
            <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
            {T.recording} — {T.stopRecording}
          </button>
        )}
      </div>

      {pending.length > 0 && (
        <ul className="mt-3 space-y-2">
          {pending.map((p, i) => (
            <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-2 py-1.5 text-xs">
              {p.kind === 'image' && p.preview && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={p.preview} alt="" className="h-10 w-10 rounded object-cover" />
              )}
              {p.kind === 'audio' && (
                <span className="inline-flex h-10 w-10 items-center justify-center rounded bg-slate-100 dark:bg-slate-800">
                  <Mic className="h-4 w-4 text-slate-500" />
                </span>
              )}
              <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{p.file.name}</span>
              <span className="text-slate-400">{(p.file.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="rounded p-1 text-slate-400 hover:text-rose-500"
                aria-label="Remove"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReceiptOptIn({
  T, value, onChange,
}: {
  T: ReturnType<typeof catalog>
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="text-sm">
        <p className="font-medium text-slate-800 dark:text-slate-200">{T.receiptOptIn}</p>
        <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{T.receiptHint}</p>
      </div>
    </label>
  )
}

function SubmittedView({
  T, verify, submitted,
}: {
  T: ReturnType<typeof catalog>
  verify: VerifyResponse
  submitted: Submitted
}) {
  return (
    <div className="flex flex-col items-center text-center py-6">
      <CheckCircle2 className="h-10 w-10 text-emerald-500" />
      <h2 className="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">{T.thankYou}</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        {T.thankYouRecorded} <span className="font-mono">{submitted.report_number}</span>
        {verify.tenant_name && <> {T.thankYouAt} <strong>{verify.tenant_name}</strong></>}.
      </p>
      {submitted.receipt_pin && (
        <div className="mt-4 rounded-lg bg-brand-yellow/30 border border-brand-yellow p-3 text-sm">
          <p className="text-[11px] uppercase font-bold tracking-wide text-slate-700">{T.receiptShown}</p>
          <p className="mt-1 font-mono text-2xl tracking-wider text-slate-900">{submitted.receipt_pin}</p>
          <p className="mt-1 text-[11px] text-slate-600">{T.receiptHint}</p>
        </div>
      )}
      <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">{T.thankYouTeam}</p>
    </div>
  )
}

function Field({
  label, hint, required, children,
}: {
  label: string; hint?: string; required?: boolean; children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}{required && <span className="text-rose-500"> *</span>}
        {hint && <span className="ml-2 text-[11px] font-normal text-slate-400">{hint}</span>}
      </span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
