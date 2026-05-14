'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink, Loader2, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { complianceFetch } from '../../_lib/api'
import {
  CATEGORY_LABEL,
  FREQUENCY_LABEL,
  LEGAL_STATUSES,
  REVIEW_FREQUENCIES,
  type LegalStatus,
  type ObligationCategory,
  type ObligationFrequency,
  type ReviewFrequency,
} from '@soteria/core/compliance'

interface RegistryRow {
  id:                 string
  citation:           string
  title:              string
  jurisdiction:       string
  authority:          string | null
  source_url:         string | null
  summary:            string | null
  applicability_note: string | null
  status:             LegalStatus
  effective_date:     string | null
  last_reviewed_at:   string | null
  next_review_due:    string | null
  review_frequency:   ReviewFrequency | null
  tags:               string[]
  ai_generated:       boolean
}

interface AttachedObligation {
  id:                 string
  title:              string
  category:           ObligationCategory
  frequency:          ObligationFrequency
  next_due_date:      string
  responsible_party:  string | null
}

interface AiProposal {
  summary: string
  applicability_questions: string[]
  suggested_review_frequency: ReviewFrequency
  tags: string[]
  confidence: 'low' | 'medium' | 'high'
}

interface AiObligationSuggestion {
  title:             string
  description:       string
  category:          ObligationCategory
  frequency:         ObligationFrequency
  frequency_days:    number | null
  responsible_party: string
  evidence_required: boolean
  rationale:         string
}

export default function RegistryDetailPage() {
  const params  = useParams<{ id: string }>()
  const router  = useRouter()
  const { tenant } = useTenant()
  const id = params?.id ?? ''

  const [entry, setEntry] = useState<RegistryRow | null>(null)
  const [obligations, setObligations] = useState<AttachedObligation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // AI proposal state.
  const [proposal, setProposal] = useState<AiProposal | null>(null)
  const [proposing, setProposing] = useState(false)
  const [suggestions, setSuggestions] = useState<AiObligationSuggestion[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [materializing, setMaterializing] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setLoading(true); setError(null)
    try {
      const body = await complianceFetch<{ entry: RegistryRow; obligations: AttachedObligation[] }>(
        tenant.id, `/api/compliance/registry/${id}`,
      )
      setEntry(body.entry)
      setObligations(body.obligations)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, id])

  useEffect(() => { void load() }, [load])

  async function runSummarize() {
    if (!tenant?.id) return
    setProposing(true); setError(null)
    try {
      const body = await complianceFetch<{ proposal: AiProposal }>(
        tenant.id, `/api/compliance/registry/${id}/ai-summarize`, { method: 'POST', body: '{}' },
      )
      setProposal(body.proposal)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProposing(false)
    }
  }

  async function acceptProposal() {
    if (!tenant?.id || !proposal) return
    try {
      await complianceFetch(tenant.id, `/api/compliance/registry/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({
          summary:          proposal.summary,
          review_frequency: proposal.suggested_review_frequency,
          tags:             proposal.tags,
        }),
      })
      setProposal(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function runSuggest() {
    if (!tenant?.id) return
    setSuggesting(true); setError(null); setPicked(new Set())
    try {
      const body = await complianceFetch<{ suggestions: AiObligationSuggestion[] }>(
        tenant.id, `/api/compliance/ai-suggest-obligations`, {
          method: 'POST', body: JSON.stringify({ legal_register_id: id }),
        },
      )
      setSuggestions(body.suggestions)
      setPicked(new Set(body.suggestions.map((_, i) => i)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSuggesting(false)
    }
  }

  async function materializePicked() {
    if (!tenant?.id || !suggestions) return
    setMaterializing(true); setError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      // Naive default due date: today + 30 days. Admin can edit on
      // the obligation detail page.
      const defaultDue = addDaysISO(today, 30)
      const items = Array.from(picked).sort((a, b) => a - b).map(i => suggestions[i])
      for (const s of items) {
        await complianceFetch(tenant.id, '/api/compliance/obligations', {
          method: 'POST',
          body:   JSON.stringify({
            legal_register_id:  id,
            title:              s.title,
            description:        `${s.description}\n\n${s.rationale ? 'Rationale: ' + s.rationale : ''}`.trim(),
            category:           s.category,
            frequency:          s.frequency,
            frequency_days:     s.frequency_days,
            next_due_date:      defaultDue,
            lead_days:          14,
            responsible_party:  s.responsible_party,
            evidence_required:  s.evidence_required,
            not_applicable:     false,
          }),
        })
      }
      setSuggestions(null); setPicked(new Set())
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMaterializing(false)
    }
  }

  async function deleteEntry() {
    if (!tenant?.id) return
    if (!confirm('Delete this citation? Attached obligations will keep their data but lose the linked citation.')) return
    try {
      await complianceFetch(tenant.id, `/api/compliance/registry/${id}`, { method: 'DELETE' })
      router.push('/compliance/registry')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (loading && !entry) {
    return <main className="max-w-3xl mx-auto px-4 py-16 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></main>
  }
  if (!entry) {
    return <main className="max-w-3xl mx-auto px-4 py-16 text-sm text-slate-500">{error ?? 'Not found.'}</main>
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/compliance/registry" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
        <ArrowLeft className="h-3 w-3" /> Legal registry
      </Link>

      <header className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-mono font-semibold text-slate-700 dark:text-slate-200">{entry.citation}</div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{entry.title}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {entry.jurisdiction}{entry.authority ? ` · ${entry.authority}` : ''}
            {entry.source_url && (
              <>{' '}
                <a href={entry.source_url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
                  source <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </p>
        </div>
        <button
          onClick={deleteEntry}
          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </header>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">Summary</h2>
          <button
            onClick={runSummarize}
            disabled={proposing}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-purple-200 text-purple-700 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-950/30 disabled:opacity-50"
          >
            {proposing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            {entry.summary ? 'Regenerate with AI' : 'Summarize with AI'}
          </button>
        </div>
        {entry.summary ? (
          <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">{entry.summary}</p>
        ) : (
          <p className="text-sm text-slate-400 italic">No summary yet.</p>
        )}
        {entry.applicability_note && (
          <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
            <div className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-1">Applicability note</div>
            <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{entry.applicability_note}</p>
          </div>
        )}
        {entry.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {entry.tags.map(t => (
              <span key={t} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t}</span>
            ))}
          </div>
        )}
      </section>

      {proposal && (
        <section className="bg-purple-50 dark:bg-purple-950/30 rounded-2xl border border-purple-200 dark:border-purple-800 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[11px] font-bold tracking-widest uppercase text-purple-700 dark:text-purple-300 inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> AI proposal · confidence: {proposal.confidence}
            </h2>
            <div className="flex items-center gap-1">
              <button onClick={() => setProposal(null)} className="text-xs px-2 py-1 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/40">Discard</button>
              <button onClick={acceptProposal} className="text-xs font-semibold px-2.5 py-1 rounded-md bg-purple-600 text-white hover:bg-purple-700">Accept &amp; save</button>
            </div>
          </div>
          <p className="text-sm text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">{proposal.summary}</p>
          {proposal.applicability_questions.length > 0 && (
            <div>
              <div className="text-[11px] font-bold tracking-widest uppercase text-purple-700 dark:text-purple-300 mb-1">Applicability questions</div>
              <ul className="text-sm text-slate-800 dark:text-slate-100 list-disc list-inside space-y-0.5">
                {proposal.applicability_questions.map((q, i) => <li key={i}>{q}</li>)}
              </ul>
            </div>
          )}
          <div className="text-xs text-slate-600 dark:text-slate-300">
            Suggested review frequency: <span className="font-semibold">{proposal.suggested_review_frequency}</span>
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">
            Linked obligations ({obligations.length})
          </h2>
          <button
            onClick={runSuggest}
            disabled={suggesting}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md border border-purple-200 text-purple-700 hover:bg-purple-50 dark:border-purple-800 dark:text-purple-300 dark:hover:bg-purple-950/30 disabled:opacity-50"
          >
            {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Suggest with AI
          </button>
        </div>

        {obligations.length === 0 ? (
          <p className="text-sm text-slate-400 italic">No obligations linked yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {obligations.map(o => (
              <li key={o.id} className="py-2">
                <Link href={`/compliance/obligations/${o.id}`} className="block hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-2 px-2 py-1 rounded">
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.title}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {CATEGORY_LABEL[o.category]} · {FREQUENCY_LABEL[o.frequency]} · next {o.next_due_date}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {suggestions && (
        <section className="bg-purple-50 dark:bg-purple-950/30 rounded-2xl border border-purple-200 dark:border-purple-800 p-5 space-y-3">
          <h2 className="text-[11px] font-bold tracking-widest uppercase text-purple-700 dark:text-purple-300 inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" /> AI-suggested obligations
          </h2>
          {suggestions.length === 0 ? (
            <p className="text-sm text-slate-700 dark:text-slate-200">No scheduled obligations are required by this citation, per the model.</p>
          ) : (
            <>
              <ul className="space-y-2">
                {suggestions.map((s, i) => (
                  <li key={i} className="bg-white dark:bg-slate-900 rounded-lg border border-purple-100 dark:border-purple-900 p-3">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={picked.has(i)}
                        onChange={() => {
                          const next = new Set(picked)
                          if (next.has(i)) next.delete(i); else next.add(i)
                          setPicked(next)
                        }}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{s.title}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {CATEGORY_LABEL[s.category]} · {FREQUENCY_LABEL[s.frequency]} · {s.responsible_party}
                        </div>
                        <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{s.description}</p>
                        <p className="mt-1 text-[11px] italic text-slate-500 dark:text-slate-400">{s.rationale}</p>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-end gap-2">
                <button onClick={() => { setSuggestions(null); setPicked(new Set()) }} className="text-xs px-2 py-1 rounded-md hover:bg-purple-100 dark:hover:bg-purple-900/40">Discard all</button>
                <button
                  onClick={materializePicked}
                  disabled={materializing || picked.size === 0}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                >
                  {materializing && <Loader2 className="h-3 w-3 animate-spin" />}
                  Create {picked.size} obligation{picked.size === 1 ? '' : 's'}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      <EditMetadata entry={entry} tenantId={tenant?.id ?? ''} onSaved={load} />

      {error && (
        <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 px-3 py-2 text-sm">{error}</div>
      )}
    </main>
  )
}

function EditMetadata({ entry, tenantId, onSaved }: { entry: RegistryRow; tenantId: string; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState<LegalStatus>(entry.status)
  const [reviewFreq, setReviewFreq] = useState<ReviewFrequency | ''>(entry.review_frequency ?? '')
  const [nextReview, setNextReview] = useState<string>(entry.next_review_due ?? '')
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  // Show "Saved" for 4s after a successful save. setTimeout keeps the
  // render pure (no Date.now() reads during render).
  useEffect(() => {
    if (!savedTick) return
    const t = setTimeout(() => setSavedTick(false), 4000)
    return () => clearTimeout(t)
  }, [savedTick])

  async function save() {
    if (!tenantId) return
    setSaving(true)
    try {
      await complianceFetch(tenantId, `/api/compliance/registry/${entry.id}`, {
        method: 'PATCH',
        body:   JSON.stringify({
          status,
          review_frequency: reviewFreq || null,
          next_review_due:  nextReview || null,
        }),
      })
      setSavedTick(true)
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 p-5 space-y-3">
      <h2 className="text-[11px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">Metadata</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Status</span>
          <select value={status} onChange={e => setStatus(e.target.value as LegalStatus)} className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            {LEGAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Review cadence</span>
          <select value={reviewFreq} onChange={e => setReviewFreq(e.target.value as ReviewFrequency | '')} className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <option value="">—</option>
            {REVIEW_FREQUENCIES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Next review due</span>
          <input type="date" value={nextReview} onChange={e => setNextReview(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2">
        {savedTick && <span className="text-xs text-emerald-600">Saved</span>}
        <button onClick={save} disabled={saving} className="text-xs font-semibold px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save metadata'}
        </button>
      </div>
    </section>
  )
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
