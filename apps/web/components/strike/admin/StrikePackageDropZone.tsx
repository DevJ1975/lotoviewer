'use client'

import { useRef, useState, type DragEvent } from 'react'
import { AlertCircle, CheckCircle2, FileUp, Loader2, PackageOpen, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { superadminJson } from '@/lib/superadminFetch'
import { formatBytes } from '@/components/ui/Dropzone'
import type { StrikePackagePlan } from '@/lib/strike/package'
import { collectDroppedEntries, loadPackage, uploadPackageMedia, type LoadedPackage, type UploadProgress } from '@/lib/strike/packageClient'
import type { ImportDecision, ImportOutcome, VersionAction } from '@/lib/strike/packageImport'
import type { StrikeImportPlanResponse } from '@/app/api/superadmin/strike/import/plan/route'

// Drop a STRIKE package (the seed folder, or a zip of it) to put it in the
// global library as drafts. Media uploads go straight from the browser to
// strike-media; the API routes only ever see the module documents.
//
// Stages: idle → reading (unzip + validate locally) → review (server says
// what a commit would do) → uploading → importing → done.

type Stage =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'review'; loaded: LoadedPackage; plan: StrikePackagePlan; decision: ImportDecision }
  | { kind: 'uploading'; plan: StrikePackagePlan; progress: UploadProgress }
  | { kind: 'importing'; plan: StrikePackagePlan }
  | { kind: 'done'; plan: StrikePackagePlan; outcome: ImportOutcome }

interface Props {
  onImported: () => void
}

export function StrikePackageDropZone({ onImported }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<string[]>([])
  const [dragActive, setDragActive] = useState(false)
  const dragDepthRef = useRef(0)
  const busy = stage.kind === 'reading' || stage.kind === 'uploading' || stage.kind === 'importing'

  function reset() {
    setStage({ kind: 'idle' })
    setError(null)
    setIssues([])
  }

  async function receive(items: DataTransferItemList | null, files: FileList | null) {
    if (busy) return
    setError(null)
    setIssues([])
    setStage({ kind: 'reading' })
    try {
      const entries = await collectDroppedEntries(items, files)
      if (entries.length === 0) throw new Error('Nothing readable was dropped.')
      const loaded = await loadPackage(entries)
      if (!loaded.read.ok) {
        setIssues(loaded.read.issues)
        setStage({ kind: 'idle' })
        return
      }
      const planned = await superadminJson<StrikeImportPlanResponse>('/api/superadmin/strike/import/plan', {
        method: 'POST',
        body: JSON.stringify(loaded.input),
      })
      if (!planned.ok || !planned.body) {
        const serverIssues = (planned.body as { issues?: string[] } | null)?.issues
        if (serverIssues?.length) setIssues(serverIssues)
        else setError(planned.error ?? 'Could not plan the import')
        setStage({ kind: 'idle' })
        return
      }
      setStage({ kind: 'review', loaded, plan: loaded.read.plan, decision: planned.body.decision })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not read the package')
      setStage({ kind: 'idle' })
    }
  }

  async function commit() {
    if (stage.kind !== 'review') return
    const { loaded, plan } = stage
    setError(null)
    try {
      setStage({ kind: 'uploading', plan, progress: { done: 0, total: plan.uploads.length, current: '' } })
      await uploadPackageMedia(supabase, plan.uploads, loaded.blobs, progress => setStage({ kind: 'uploading', plan, progress }))
      setStage({ kind: 'importing', plan })
      const imported = await superadminJson<ImportOutcome>('/api/superadmin/strike/import', {
        method: 'POST',
        body: JSON.stringify(loaded.input),
      })
      if (!imported.ok || !imported.body) throw new Error(imported.error ?? 'Import failed')
      setStage({ kind: 'done', plan, outcome: imported.body })
      onImported()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Import failed')
      setStage({ kind: 'review', loaded, plan, decision: stage.decision })
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    void receive(e.dataTransfer.items, e.dataTransfer.files)
  }
  function onDragEnter(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragDepthRef.current += 1
    setDragActive(true)
  }
  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <PackageOpen className="h-4 w-4 text-brand-navy dark:text-brand-yellow" aria-hidden />
            Import a STRIKE package
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Drop the seed folder or its zip: module.json (plus module.es.json), images, narration, captions and the rendered MP4.
            It lands in the global library as a draft; approve the media in the Media Studio, then publish.
          </p>
        </div>
        {stage.kind !== 'idle' && !busy && (
          <button type="button" onClick={reset} aria-label="Start over"
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {(stage.kind === 'idle' || stage.kind === 'reading') && (
        <div
          onDrop={onDrop}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={e => e.preventDefault()}
          className={[
            'flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-md border-2 border-dashed transition-colors',
            dragActive
              ? 'border-brand-yellow bg-amber-50/60 dark:bg-amber-900/10'
              : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30',
          ].join(' ')}
        >
          {stage.kind === 'reading' ? (
            <>
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden />
              <p className="text-sm text-slate-600 dark:text-slate-300">Reading the package…</p>
            </>
          ) : (
            <>
              <FileUp className={`h-6 w-6 ${dragActive ? 'text-brand-navy dark:text-brand-yellow' : 'text-slate-400'}`} aria-hidden />
              <p className="text-sm text-slate-700 dark:text-slate-200">Drag the package folder or zip here</p>
              <div className="flex gap-3 text-xs">
                <label className="cursor-pointer font-medium text-brand-navy dark:text-brand-yellow hover:underline">
                  Choose a zip
                  <input type="file" accept=".zip,application/zip" className="sr-only"
                    onChange={e => { void receive(null, e.target.files); e.target.value = '' }} />
                </label>
                <label className="cursor-pointer font-medium text-brand-navy dark:text-brand-yellow hover:underline">
                  Choose a folder
                  <input type="file" className="sr-only" {...({ webkitdirectory: '' } as Record<string, string>)}
                    onChange={e => { void receive(null, e.target.files); e.target.value = '' }} />
                </label>
              </div>
            </>
          )}
        </div>
      )}

      {issues.length > 0 && (
        <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800">
          <p className="text-sm font-semibold text-rose-800 dark:text-rose-200 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" aria-hidden /> The package needs fixing before it can be imported
          </p>
          <ul className="mt-2 space-y-1 text-xs text-rose-800 dark:text-rose-200 font-mono">
            {issues.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}

      {error && (
        <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" aria-hidden />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      )}

      {stage.kind === 'review' && (
        <ReviewCard plan={stage.plan} decision={stage.decision} onCommit={() => void commit()} onCancel={reset} />
      )}

      {stage.kind === 'uploading' && (
        <Progress label={`Uploading media ${stage.progress.done}/${stage.progress.total}`} detail={stage.progress.current}
          fraction={stage.progress.total === 0 ? 1 : stage.progress.done / stage.progress.total} />
      )}

      {stage.kind === 'importing' && (
        <Progress label="Writing the draft to the library" detail={stage.plan.slug} fraction={1} />
      )}

      {stage.kind === 'done' && (
        <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {stage.plan.title} is in the library as a draft
          </p>
          <ul className="mt-2 text-xs text-emerald-800 dark:text-emerald-200 space-y-1">
            {stage.outcome.versions.map(v => (
              <li key={v.versionId}>
                v{v.versionNumber} · {v.locale.toUpperCase()} · {v.action === 'create' ? 'new version' : 'draft updated'}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
            Next: approve every image and narration in the Media Studio, then publish.
          </p>
        </div>
      )}
    </section>
  )
}

function ReviewCard({ plan, decision, onCommit, onCancel }: {
  plan: StrikePackagePlan
  decision: ImportDecision
  onCommit: () => void
  onCancel: () => void
}) {
  const totalBytes = plan.uploads.reduce((sum, u) => sum + u.size, 0)
  const refused = decision.versions.filter(v => v.action === 'refused')
  const blocked = refused.length > 0 || decision.conflicts.length > 0
  const scenes = plan.versions[0]?.content.blocks.filter(b => b.kind === 'motion_scene').length ?? 0
  const interactions = plan.versions[0]?.content.blocks.filter(b => !['motion_scene', 'callout'].includes(b.kind)).length ?? 0

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-slate-200 dark:border-slate-700 p-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{plan.title}</h3>
          <span className="font-mono text-xs text-slate-500">{plan.slug}</span>
          <span className="text-xs text-slate-500">{decision.moduleAction === 'create' ? 'new module' : 'existing module'}</span>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {plan.category ?? 'No category'} · {plan.estimatedMinutes} min · {scenes} scenes · {interactions} interactions
          · {plan.versions[0]?.questions.length ?? 0} questions
        </p>
        <ul className="mt-2 space-y-1 text-xs">
          {decision.versions.map(action => <li key={action.locale}><VersionLine action={action} plan={plan} /></li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
          {plan.uploads.length} files to upload ({formatBytes(totalBytes)})
          {plan.ignored.length > 0 && ` · ${plan.ignored.length} not needed (${plan.ignored.slice(0, 4).join(', ')}${plan.ignored.length > 4 ? '…' : ''})`}
        </p>
      </div>
      {decision.conflicts.length > 0 && (
        <p className="text-xs text-rose-700 dark:text-rose-300">
          {decision.conflicts.length} file{decision.conflicts.length === 1 ? ' is' : 's are'} already used by a published version or another
          module ({decision.conflicts.slice(0, 3).join(', ')}{decision.conflicts.length > 3 ? '…' : ''}). Uploading would change what
          learners see there. Give the package a new media_prefix, for example …/v2.
        </p>
      )}
      {refused.length > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          Nothing will be imported until every language above can be written.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800">
          Cancel
        </button>
        <button type="button" onClick={onCommit} disabled={blocked}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50">
          Upload and import as draft
        </button>
      </div>
    </div>
  )
}

function VersionLine({ action, plan }: { action: VersionAction; plan: StrikePackagePlan }) {
  const version = plan.versions.find(v => v.locale === action.locale)
  const video = version?.downloadPath ? 'with MP4' : 'no MP4'
  switch (action.action) {
    case 'create':
      return <span className="text-slate-700 dark:text-slate-200">{action.locale.toUpperCase()}: new draft v{action.versionNumber} ({video})</span>
    case 'update':
      return <span className="text-slate-700 dark:text-slate-200">{action.locale.toUpperCase()}: replaces draft v{action.versionNumber} ({video})</span>
    case 'refused':
      return <span className="text-rose-700 dark:text-rose-300">{action.locale.toUpperCase()}: {action.reason}</span>
  }
}

function Progress({ label, detail, fraction }: { label: string; detail: string; fraction: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" aria-hidden />
        {label}
        {detail && <span className="font-mono text-xs text-slate-500 truncate">{detail}</span>}
      </div>
      <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
        <div className="h-full bg-brand-navy dark:bg-brand-yellow transition-[width]" style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
    </div>
  )
}
