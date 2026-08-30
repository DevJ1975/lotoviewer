'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle, Check, CornerDownRight, Crown, Loader2,
  Plus, Sparkles, Trash2, Wrench, X,
} from 'lucide-react'
import {
  nextWhyPrompt,
  detectSymptomLanguage,
  buildRootCauseActionDraft,
  type FiveWhysRow,
} from '@soteria/core/rcaSchemas'

// Redesigned 5 Whys editor. The old version was a flat list of textareas
// whose every prompt read the literal "Why did that happen?" — so the
// chain never actually chained. This board fixes that and the deeper
// complaints behind "not a good tool":
//
//   - Contextual prompts: each "why" echoes the answer it interrogates
//     (nextWhyPrompt) and renders as an indented, connected tree.
//   - Branching + MULTIPLE roots: a why can fork (parent_id), and any
//     number of nodes can be marked root.
//   - Anti-blame guardrail: detectSymptomLanguage flags "human error" /
//     "retrain" answers inline as you type — advisory, never blocking.
//   - AI assist (human-approved): "Suggest next why" pre-fills an answer;
//     "Draft root cause & actions" proposes a systemic root + CAPAs. The
//     human edits and accepts; nothing is auto-committed.
//   - One click from a root cause to a tracked corrective action.

export interface ActionDraft {
  description: string
  action_type: 'corrective' | 'preventive' | 'interim'
  hierarchy_of_controls: 'elimination' | 'substitution' | 'engineering' | 'administrative' | 'ppe' | null
  source_rca_node_id?: string | null
  ai_origin?: boolean
}

interface Props {
  rows:     FiveWhysRow[]
  busy:     boolean
  isAdmin:  boolean
  /** Append a node. Returns the created row (needed to chain root→action). */
  onAdd:    (node: Record<string, unknown>) => Promise<FiveWhysRow | null>
  onDelete: (id: string) => void
  /** Patch a node in place (toggle is_root, edit answer, mark ai_edited). */
  onPatch:  (id: string, patch: Record<string, unknown>) => Promise<boolean>
  /** Create a corrective action (CAPA) from a root cause. */
  onCreateAction: (draft: ActionDraft) => Promise<boolean>
  /** Ask the AI route for help. Returns the parsed suggestion or null. */
  onAssist: (mode: 'next_why' | 'draft_root_and_actions', parentNodeId?: string | null) => Promise<unknown>
  /** Retired-method view: render the existing chain read-only (no add /
   *  edit / delete / AI). Existing 5 Whys investigations stay viewable. */
  readOnly?: boolean
}

interface NextWhySuggestion { question: string; answer: string; rationale: string }
interface DraftSuggestion {
  root_cause: string
  actions: ActionDraft[]
}

export default function FiveWhysBoard({
  rows, busy, isAdmin, onAdd, onDelete, onPatch, onCreateAction, onAssist, readOnly = false,
}: Props) {
  // Which node currently has its inline "ask why" form open (null = none;
  // '' = the top-level "what happened" form when the chain is empty).
  const [openParent, setOpenParent] = useState<string | null | ''>(null)
  const [draftAnswer, setDraftAnswer] = useState('')
  const [draftAiOrigin, setDraftAiOrigin] = useState(false)
  // The exact text the AI proposed, so we can tell on submit whether the
  // human edited it (drives ai_edited provenance).
  const [aiSuggestedText, setAiSuggestedText] = useState<string | null>(null)
  const [draftRoot, setDraftRoot] = useState(false)
  const [assistBusy, setAssistBusy] = useState(false)
  const [assistError, setAssistError] = useState<string | null>(null)
  const [aiRationale, setAiRationale] = useState<string | null>(null)

  // Global AI draft panel (root cause + actions).
  const [draftPanel, setDraftPanel] = useState<DraftSuggestion | null>(null)
  const [draftPanelBusy, setDraftPanelBusy] = useState(false)

  const ordered = useMemo(() => orderTree(rows), [rows])
  const depths  = useMemo(() => computeDepths(rows), [rows])
  const byId    = useMemo(() => new Map(rows.map(r => [r.id, r])), [rows])
  const rootCount = rows.filter(r => r.is_root).length

  function resetForm() {
    setOpenParent(null); setDraftAnswer(''); setDraftAiOrigin(false)
    setAiSuggestedText(null); setDraftRoot(false); setAiRationale(null); setAssistError(null)
  }

  function openForm(parentId: string | '') {
    setOpenParent(parentId)
    setDraftAnswer(''); setDraftAiOrigin(false); setAiSuggestedText(null)
    setDraftRoot(false); setAiRationale(null); setAssistError(null)
  }

  async function submitForm() {
    const answer = draftAnswer.trim()
    if (!answer) return
    const parentId = openParent === '' ? null : openParent
    const nextOrdinal = rows.reduce((m, r) => Math.max(m, r.ordinal), 0) + 1
    const ok = await onAdd({
      ordinal:   nextOrdinal,
      question:  parentId ? nextWhyPrompt(byId.get(parentId)?.answer) : 'What happened?',
      answer,
      parent_id: parentId,
      is_root:   draftRoot,
      ai_origin: draftAiOrigin,
      // Human-changed an AI suggestion before saving? Record it.
      ai_edited: draftAiOrigin && aiSuggestedText !== null && answer !== aiSuggestedText.trim(),
    })
    if (ok) resetForm()
  }

  async function suggestNextWhy(parentId: string | null) {
    setAssistBusy(true); setAssistError(null); setAiRationale(null)
    try {
      const s = (await onAssist('next_why', parentId)) as NextWhySuggestion | null
      if (s && typeof s.answer === 'string') {
        setDraftAnswer(s.answer)
        setAiSuggestedText(s.answer)
        setDraftAiOrigin(true)
        setAiRationale(s.rationale ?? null)
      } else {
        setAssistError('The assistant did not return a usable suggestion.')
      }
    } catch (e) {
      setAssistError(e instanceof Error ? e.message : 'AI assist failed.')
    } finally {
      setAssistBusy(false)
    }
  }

  async function runDraftPanel() {
    setDraftPanelBusy(true); setAssistError(null)
    try {
      const s = (await onAssist('draft_root_and_actions')) as DraftSuggestion | null
      if (s && typeof s.root_cause === 'string') setDraftPanel(s)
      else setAssistError('The assistant did not return a usable draft.')
    } catch (e) {
      setAssistError(e instanceof Error ? e.message : 'AI draft failed.')
    } finally {
      setDraftPanelBusy(false)
    }
  }

  // Accept the AI-drafted root cause: add it as a new root node, then
  // (optionally) the human creates actions from the panel.
  async function acceptDraftRoot(text: string): Promise<FiveWhysRow | null> {
    const deepest = ordered.length > 0 ? ordered[ordered.length - 1]! : null
    const nextOrdinal = rows.reduce((m, r) => Math.max(m, r.ordinal), 0) + 1
    return onAdd({
      ordinal:   nextOrdinal,
      question:  deepest ? nextWhyPrompt(deepest.answer) : 'Root cause',
      answer:    text,
      parent_id: deepest?.id ?? null,
      is_root:   true,
      ai_origin: true,
    })
  }

  const liveFlag = detectSymptomLanguage(draftAnswer)

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">5 Whys</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Each “why” digs into the answer above it. Mark every systemic root you find — there is
            usually more than one.
          </p>
        </div>
        {isAdmin && rows.length > 0 && !readOnly && (
          <button
            type="button"
            onClick={() => void runDraftPanel()}
            disabled={busy || draftPanelBusy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-3 py-1.5 text-xs font-semibold text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50"
          >
            {draftPanelBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Draft root cause &amp; actions
          </button>
        )}
      </header>

      {assistError && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
          {assistError}
        </div>
      )}

      {/* ── AI draft panel ─────────────────────────────────────────── */}
      {draftPanel && (
        <AiDraftPanel
          draft={draftPanel}
          busy={busy}
          rootCount={rootCount}
          onClose={() => setDraftPanel(null)}
          onAcceptRoot={acceptDraftRoot}
          onCreateAction={onCreateAction}
        />
      )}

      {/* ── Empty state ────────────────────────────────────────────── */}
      {rows.length === 0 && openParent !== '' && !readOnly && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-4 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Start with the problem: what happened?
          </p>
          <button
            type="button"
            onClick={() => openForm('')}
            className="mt-2 inline-flex items-center gap-1 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90"
          >
            <Plus className="h-3.5 w-3.5" /> State the problem
          </button>
        </div>
      )}

      {/* ── Threaded chain ─────────────────────────────────────────── */}
      <ul className="space-y-2">
        {ordered.map(node => {
          const depth = Math.min(depths.get(node.id) ?? 0, 6)
          const flag = detectSymptomLanguage(node.answer)
          return (
            <li key={node.id} style={{ marginLeft: depth * 18 }}>
              <div className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                {depth > 0 && <CornerDownRight className="h-4 w-4 mt-0.5 shrink-0 text-slate-300 dark:text-slate-600" />}
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                  {node.ordinal}
                </span>
                <div className="flex-1 min-w-0 space-y-1">
                  {node.question && (
                    <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{node.question}</p>
                  )}
                  <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{node.answer}</p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {node.is_root && <RootBadge />}
                    {node.ai_origin && <AiBadge edited={!!node.ai_edited} />}
                  </div>
                  {flag.flagged && (
                    <p className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                      {flag.reason}
                    </p>
                  )}
                  {/* per-node controls */}
                  {!readOnly && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => openForm(node.id)}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                    >
                      <Plus className="h-3 w-3" /> Ask why
                    </button>
                    <button
                      type="button"
                      onClick={() => void onPatch(node.id, { is_root: !node.is_root })}
                      disabled={busy}
                      className={
                        'inline-flex items-center gap-1 rounded-md border px-2 py-1 disabled:opacity-50 ' +
                        (node.is_root
                          ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
                          : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800')
                      }
                    >
                      <Crown className="h-3 w-3" /> {node.is_root ? 'Unmark root' : 'Mark root'}
                    </button>
                    {node.is_root && (
                      <button
                        type="button"
                        onClick={() => void onCreateAction({
                          ...buildRootCauseActionDraft({ rootCauseText: node.answer }),
                          source_rca_node_id: node.id,
                        })}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 disabled:opacity-50"
                      >
                        <Wrench className="h-3 w-3" /> Create action
                      </button>
                    )}
                  </div>
                  )}

                  {/* inline add-child form */}
                  {!readOnly && openParent === node.id && (
                    <AddForm
                      prompt={nextWhyPrompt(node.answer)}
                      value={draftAnswer}
                      onChange={setDraftAnswer}
                      onSubmit={submitForm}
                      onCancel={resetForm}
                      isRoot={draftRoot}
                      onToggleRoot={setDraftRoot}
                      busy={busy}
                      isAdmin={isAdmin}
                      assistBusy={assistBusy}
                      onAssist={() => void suggestNextWhy(node.id)}
                      aiOrigin={draftAiOrigin}
                      rationale={aiRationale}
                      liveFlag={liveFlag}
                    />
                  )}
                </div>
                {!readOnly && <DeleteButton onClick={() => onDelete(node.id)} disabled={busy} />}
              </div>
            </li>
          )
        })}
      </ul>

      {/* top-level "what happened" form (empty chain) */}
      {!readOnly && openParent === '' && (
        <AddForm
          prompt="What happened?"
          value={draftAnswer}
          onChange={setDraftAnswer}
          onSubmit={submitForm}
          onCancel={resetForm}
          isRoot={draftRoot}
          onToggleRoot={setDraftRoot}
          busy={busy}
          isAdmin={isAdmin}
          assistBusy={false}
          onAssist={null}
          aiOrigin={false}
          rationale={null}
          liveFlag={liveFlag}
        />
      )}
    </section>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Inline add / branch form
// ──────────────────────────────────────────────────────────────────────────

function AddForm({
  prompt, value, onChange, onSubmit, onCancel, isRoot, onToggleRoot,
  busy, isAdmin, assistBusy, onAssist, rationale, liveFlag, aiOrigin,
}: {
  prompt: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  isRoot: boolean
  onToggleRoot: (v: boolean) => void
  busy: boolean
  isAdmin: boolean
  assistBusy: boolean
  onAssist: (() => void) | null
  rationale: string | null
  liveFlag: { flagged: boolean; reason?: string }
  aiOrigin: boolean
}) {
  return (
    <div className="mt-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{prompt}</p>
        {isAdmin && onAssist && (
          <button
            type="button"
            onClick={onAssist}
            disabled={assistBusy || busy}
            className="inline-flex items-center gap-1 rounded-md border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-900/40 disabled:opacity-50"
          >
            {assistBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Suggest next why
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Type the answer…"
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
      />
      {aiOrigin && (
        <p className="text-[10px] text-violet-600 dark:text-violet-300">AI-suggested — edit freely before adding.</p>
      )}
      {rationale && (
        <p className="text-[11px] italic text-slate-500 dark:text-slate-400">{rationale}</p>
      )}
      {liveFlag.flagged && (
        <p className="flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          {liveFlag.reason}
        </p>
      )}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={isRoot} onChange={e => onToggleRoot(e.target.checked)} />
          Mark as a root cause
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={busy || !value.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// AI draft panel — root cause + suggested actions, each human-accepted
// ──────────────────────────────────────────────────────────────────────────

function AiDraftPanel({
  draft, busy, rootCount, onClose, onAcceptRoot, onCreateAction,
}: {
  draft: DraftSuggestion
  busy: boolean
  rootCount: number
  onClose: () => void
  onAcceptRoot: (text: string) => Promise<FiveWhysRow | null>
  onCreateAction: (draft: ActionDraft) => Promise<boolean>
}) {
  const [rootNodeId, setRootNodeId] = useState<string | null>(null)
  const [rootAdded, setRootAdded] = useState(false)
  const [working, setWorking] = useState(false)
  const [doneActions, setDoneActions] = useState<Set<number>>(new Set())

  async function acceptRoot() {
    setWorking(true)
    try {
      const row = await onAcceptRoot(draft.root_cause)
      if (row) { setRootNodeId(row.id); setRootAdded(true) }
    } finally { setWorking(false) }
  }

  async function createAction(a: ActionDraft, i: number) {
    setWorking(true)
    try {
      // The AI returns description + action_type; the human (or a default
      // of null) owns the control level deliberately.
      const ok = await onCreateAction({
        description:           a.description,
        action_type:          a.action_type,
        hierarchy_of_controls: a.hierarchy_of_controls ?? null,
        ai_origin:            true,
        source_rca_node_id:   rootNodeId,
      })
      if (ok) setDoneActions(prev => new Set(prev).add(i))
    } finally { setWorking(false) }
  }

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/40 dark:bg-violet-950/20 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold flex items-center gap-1.5 text-violet-900 dark:text-violet-100">
          <Sparkles className="h-4 w-4" /> AI draft — review before accepting
        </h4>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Proposed root cause</p>
        <p className="text-sm text-slate-800 dark:text-slate-200">{draft.root_cause}</p>
        <button
          type="button"
          onClick={() => void acceptRoot()}
          disabled={busy || working || rootAdded}
          className="mt-1 inline-flex items-center gap-1 rounded-md border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-100 disabled:opacity-50"
        >
          {rootAdded ? <Check className="h-3 w-3" /> : <Crown className="h-3 w-3" />}
          {rootAdded ? 'Added as root' : 'Add as root cause'}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Suggested corrective actions</p>
        <ul className="space-y-2">
          {draft.actions.map((a, i) => (
            <li key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/40 p-2">
              <p className="text-sm text-slate-800 dark:text-slate-200">{a.description}</p>
              <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {a.action_type}{a.hierarchy_of_controls ? ` · ${a.hierarchy_of_controls}` : ''}
              </p>
              <button
                type="button"
                onClick={() => void createAction(a, i)}
                disabled={busy || working || doneActions.has(i)}
                className="mt-1 inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
              >
                {doneActions.has(i) ? <Check className="h-3 w-3" /> : <Wrench className="h-3 w-3" />}
                {doneActions.has(i) ? 'Created' : 'Create action'}
              </button>
            </li>
          ))}
        </ul>
        {!rootAdded && rootCount === 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Tip: add the root cause first so created actions link back to it.
          </p>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Small widgets
// ──────────────────────────────────────────────────────────────────────────

function RootBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
      <Crown className="h-3 w-3" /> ROOT
    </span>
  )
}

function AiBadge({ edited }: { edited: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/40 px-1.5 py-0.5 text-[10px] font-bold text-violet-800 dark:text-violet-200">
      <Sparkles className="h-3 w-3" /> {edited ? 'AI · edited' : 'AI'}
    </span>
  )
}

function DeleteButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Delete"
      className="shrink-0 rounded-md p-1 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Tree helpers
// ──────────────────────────────────────────────────────────────────────────

// Depth-first order so children read directly under their parent. Legacy
// rows (parent_id null) all sit at the top level, ordered by ordinal —
// i.e. the old linear chain renders unchanged.
function orderTree(rows: FiveWhysRow[]): FiveWhysRow[] {
  const byParent = new Map<string | null, FiveWhysRow[]>()
  for (const r of rows) {
    const key = r.parent_id ?? null
    const list = byParent.get(key) ?? []
    list.push(r)
    byParent.set(key, list)
  }
  for (const list of byParent.values()) list.sort((a, b) => a.ordinal - b.ordinal)

  const out: FiveWhysRow[] = []
  const seen = new Set<string>()
  const visit = (parentKey: string | null) => {
    for (const r of byParent.get(parentKey) ?? []) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      out.push(r)
      visit(r.id)
    }
  }
  visit(null)
  // Append any orphans whose parent row is missing — defensive.
  for (const r of rows) if (!seen.has(r.id)) { seen.add(r.id); out.push(r) }
  return out
}

function computeDepths(rows: FiveWhysRow[]): Map<string, number> {
  const byId = new Map(rows.map(r => [r.id, r]))
  const memo = new Map<string, number>()
  for (const r of rows) {
    let d = 0
    let cur: FiveWhysRow | undefined = r
    const guard = new Set<string>()
    while (cur?.parent_id && byId.has(cur.parent_id) && !guard.has(cur.id)) {
      guard.add(cur.id)
      cur = byId.get(cur.parent_id)
      d++
      if (d > 20) break
    }
    memo.set(r.id, d)
  }
  return memo
}
