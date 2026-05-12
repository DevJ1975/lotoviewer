'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, ArrowDown, ArrowUp, CheckCircle2, Circle, ClipboardCheck,
  FileVideo, Image as ImageIcon, Loader2, Plus, Save, Trash2, Upload,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import { superadminJson } from '@/lib/superadminFetch'
import type { StrikeQuestionType } from '@soteria/core/strike'
import type {
  QuizAnswerRow,
  QuizQuestionRow,
  QuizResponse,
  QuizVersionRow,
} from '@/app/api/superadmin/strike/[moduleId]/quiz/route'

// /superadmin/strike/[moduleId]/quiz — content authoring for the
// knowledge check that runs after a STRIKE video. Client-side gate via
// useAuth; API enforces the real superadmin check.
//
// Edits propagate through the four /quiz/* APIs. The UI is intentionally
// flat — no drag-and-drop yet, just up/down buttons — because each
// module typically has fewer than ten questions and a flat list is
// easier to translate and to keyboard-navigate.

const QUESTION_TYPE_LABELS: Record<StrikeQuestionType, string> = {
  multiple_choice: 'Multiple choice (one correct)',
  true_false: 'True / false',
  select_all: 'Select all that apply',
  acknowledgement: 'Acknowledgement only',
}

const QUESTION_TYPE_HINTS: Record<StrikeQuestionType, string> = {
  multiple_choice: 'Provide 2-5 answer choices. Mark exactly one as correct.',
  true_false: 'Add a True and a False answer. Mark whichever is correct.',
  select_all: 'Provide answer choices. Mark every correct option; the learner must pick exactly the correct set.',
  acknowledgement: 'No answer choices. The learner ticks a single "I acknowledge" box.',
}

export default function StrikeQuizEditorPage() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const { profile, loading: authLoading } = useAuth()
  const isSuperadmin = profile?.is_superadmin === true

  const [data, setData] = useState<QuizResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [busyQuestionId, setBusyQuestionId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async (preserveVersion: boolean = false) => {
    if (!moduleId) return
    setLoading(true)
    setError(null)
    const result = await superadminJson<QuizResponse>(`/api/superadmin/strike/${moduleId}/quiz`, { method: 'GET' })
    setLoading(false)
    if (!result.ok || !result.body) {
      setError(result.error ?? 'Could not load quiz')
      return
    }
    setData(result.body)
    setSelectedVersionId(prev => {
      if (preserveVersion && prev && result.body!.versions.some(v => v.id === prev)) return prev
      return result.body!.versions[0]?.id ?? null
    })
  }, [moduleId])

  useEffect(() => {
    if (authLoading || !isSuperadmin) { setLoading(false); return }
    void load(false)
  }, [authLoading, isSuperadmin, load])

  const currentVersion = useMemo<QuizVersionRow | null>(() => {
    if (!data || !selectedVersionId) return null
    return data.versions.find(v => v.id === selectedVersionId) ?? null
  }, [data, selectedVersionId])

  const questionsForVersion = useMemo<QuizQuestionRow[]>(() => {
    if (!data || !selectedVersionId) return []
    return data.questions
      .filter(q => q.module_version_id === selectedVersionId)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
  }, [data, selectedVersionId])

  async function addQuestion(versionId: string) {
    if (creating) return
    setCreating(true)
    setError(null)
    const result = await superadminJson<{ question: QuizQuestionRow }>(
      `/api/superadmin/strike/${moduleId}/quiz/questions`,
      {
        method: 'POST',
        body: JSON.stringify({
          module_version_id: versionId,
          question_type: 'multiple_choice',
          prompt: 'New question',
        }),
      },
    )
    setCreating(false)
    if (!result.ok) {
      setError(result.error ?? 'Could not create question')
      return
    }
    await load(true)
  }

  async function updateQuestion(question: QuizQuestionRow, patch: Partial<QuizQuestionRow>) {
    setBusyQuestionId(question.id)
    const result = await superadminJson<{ question: QuizQuestionRow }>(
      `/api/superadmin/strike/${moduleId}/quiz/questions/${question.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
    setBusyQuestionId(null)
    if (!result.ok) {
      setError(result.error ?? 'Could not save question')
      return
    }
    await load(true)
  }

  async function deleteQuestion(questionId: string) {
    if (!confirm('Delete this question? Answers will be removed too.')) return
    setBusyQuestionId(questionId)
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/quiz/questions/${questionId}`,
      { method: 'DELETE' },
    )
    setBusyQuestionId(null)
    if (!result.ok) {
      setError(result.error ?? 'Could not delete question')
      return
    }
    await load(true)
  }

  async function reorderQuestion(questionId: string, direction: -1 | 1) {
    if (!data || !selectedVersionId) return
    const list = questionsForVersion
    const index = list.findIndex(q => q.id === questionId)
    if (index === -1) return
    const swap = index + direction
    if (swap < 0 || swap >= list.length) return
    const ordered = list.map(q => q.id)
    const [moved] = ordered.splice(index, 1)
    ordered.splice(swap, 0, moved)
    setBusyQuestionId(questionId)
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/quiz/questions`,
      {
        method: 'PUT',
        body: JSON.stringify({ module_version_id: selectedVersionId, ordered_ids: ordered }),
      },
    )
    setBusyQuestionId(null)
    if (!result.ok) {
      setError(result.error ?? 'Could not reorder')
      return
    }
    await load(true)
  }

  async function addAnswer(questionId: string) {
    setBusyQuestionId(questionId)
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/quiz/answers`,
      {
        method: 'POST',
        body: JSON.stringify({ question_id: questionId, answer_text: 'New answer' }),
      },
    )
    setBusyQuestionId(null)
    if (!result.ok) {
      setError(result.error ?? 'Could not add answer')
      return
    }
    await load(true)
  }

  async function updateAnswer(questionId: string, answer: QuizAnswerRow, patch: Partial<QuizAnswerRow>) {
    setBusyQuestionId(questionId)
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/quiz/answers/${answer.id}`,
      { method: 'PATCH', body: JSON.stringify(patch) },
    )
    setBusyQuestionId(null)
    if (!result.ok) {
      setError(result.error ?? 'Could not save answer')
      return
    }
    await load(true)
  }

  async function deleteAnswer(questionId: string, answerId: string) {
    if (!confirm('Delete this answer choice?')) return
    setBusyQuestionId(questionId)
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/quiz/answers/${answerId}`,
      { method: 'DELETE' },
    )
    setBusyQuestionId(null)
    if (!result.ok) {
      setError(result.error ?? 'Could not delete answer')
      return
    }
    await load(true)
  }

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!isSuperadmin) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          Superadmin only.
        </p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-8">
        <Link href="/superadmin/strike" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" /> STRIKE Studio
        </Link>
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error ?? 'Module not found.'}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <Link href="/superadmin/strike" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" /> STRIKE Studio
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-brand-yellow">Quiz Maker</p>
            <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              <ClipboardCheck className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              {data.module.title}
            </h1>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              <span className="font-mono">{data.module.slug}</span> · {data.module.library_scope === 'global' ? 'Global library' : 'Tenant scope'}
            </p>
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Version</span>
            <select
              value={selectedVersionId ?? ''}
              onChange={e => setSelectedVersionId(e.target.value || null)}
              disabled={data.versions.length === 0}
              className="mt-1 w-56 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              {data.versions.length === 0 && <option value="">No versions yet</option>}
              {data.versions.map(v => (
                <option key={v.id} value={v.id}>
                  v{v.version_number} · {v.status} · pass {v.passing_score}%
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {!currentVersion ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          This module has no versions yet. Create one from STRIKE Studio before editing the quiz.
        </div>
      ) : (
        <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <VideoSection
            moduleId={data.module.id}
            version={currentVersion}
            scopeRoot={data.module.library_scope === 'global' ? 'global' : data.module.tenant_id ?? ''}
            onChanged={() => void load(true)}
          />
          <ThumbnailSection
            moduleId={data.module.id}
            version={currentVersion}
            scopeRoot={data.module.library_scope === 'global' ? 'global' : data.module.tenant_id ?? ''}
            onChanged={() => void load(true)}
          />
        </div>
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {questionsForVersion.length} question{questionsForVersion.length === 1 ? '' : 's'}
            </h2>
            <button
              type="button"
              onClick={() => void addQuestion(currentVersion.id)}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add question
            </button>
          </div>

          {questionsForVersion.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
              No questions yet. The learner page will accept a single &ldquo;I reviewed this&rdquo; acknowledgement until you add at least one question.
            </div>
          ) : (
            <ol className="space-y-4">
              {questionsForVersion.map((question, index) => (
                <li key={question.id}>
                  <QuestionCard
                    question={question}
                    index={index}
                    total={questionsForVersion.length}
                    busy={busyQuestionId === question.id}
                    onUpdate={patch => void updateQuestion(question, patch)}
                    onDelete={() => void deleteQuestion(question.id)}
                    onMoveUp={() => void reorderQuestion(question.id, -1)}
                    onMoveDown={() => void reorderQuestion(question.id, +1)}
                    onAddAnswer={() => void addAnswer(question.id)}
                    onUpdateAnswer={(answer, patch) => void updateAnswer(question.id, answer, patch)}
                    onDeleteAnswer={answerId => void deleteAnswer(question.id, answerId)}
                  />
                </li>
              ))}
            </ol>
          )}
        </section>
        </>
      )}
    </div>
  )
}

const VIDEO_MIME_TO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}
const MAX_VIDEO_BYTES = 200 * 1024 * 1024

function VideoSection({
  moduleId, version, scopeRoot, onChanged,
}: {
  moduleId: string
  version: QuizVersionRow
  scopeRoot: string
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [progressLabel, setProgressLabel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSignedUrl(null)
    if (!version.video_path) return
    void (async () => {
      const { data } = await supabase.storage
        .from('strike-media')
        .createSignedUrl(version.video_path!, 60 * 30)
      if (!cancelled) setSignedUrl(data?.signedUrl ?? null)
    })()
    return () => { cancelled = true }
  }, [version.video_path])

  async function pickFile() {
    inputRef.current?.click()
  }

  async function readDurationSeconds(file: File): Promise<number | null> {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file)
      const probe = document.createElement('video')
      probe.preload = 'metadata'
      const cleanup = () => {
        URL.revokeObjectURL(url)
        probe.removeAttribute('src')
      }
      probe.onloadedmetadata = () => {
        const seconds = Number.isFinite(probe.duration) ? Math.max(1, Math.round(probe.duration)) : null
        cleanup()
        resolve(seconds)
      }
      probe.onerror = () => { cleanup(); resolve(null) }
      probe.src = url
    })
  }

  async function handleSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadError(null)

    const ext = VIDEO_MIME_TO_EXT[file.type]
    if (!ext) {
      setUploadError(`Unsupported video type ${file.type || '(unknown)'}. Use MP4, WebM, or MOV.`)
      return
    }
    if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
      setUploadError(`Video must be 1B - ${Math.round(MAX_VIDEO_BYTES / 1_000_000)}MB.`)
      return
    }
    if (!scopeRoot) {
      setUploadError('Cannot resolve storage scope for this version.')
      return
    }

    setBusy(true)
    setProgressLabel('Reading duration')
    const durationSeconds = await readDurationSeconds(file)

    const path = `${scopeRoot}/${moduleId}/${version.id}.${ext}`
    setProgressLabel('Uploading')
    const { error: uploadErr } = await supabase.storage
      .from('strike-media')
      .upload(path, file, {
        contentType: file.type,
        cacheControl: '604800',
        upsert: true,
      })
    if (uploadErr) {
      setBusy(false)
      setProgressLabel(null)
      setUploadError(`Upload failed: ${uploadErr.message}`)
      return
    }

    setProgressLabel('Saving')
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/versions/${version.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          video_path: path,
          duration_seconds: durationSeconds,
        }),
      },
    )
    setBusy(false)
    setProgressLabel(null)
    if (!result.ok) {
      setUploadError(result.error ?? 'Saved file but failed to update version row')
      return
    }
    onChanged()
  }

  async function clearVideo() {
    if (!version.video_path) return
    if (!confirm('Detach this video from the version? The file in storage will be kept.')) return
    setBusy(true)
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/versions/${version.id}`,
      { method: 'PATCH', body: JSON.stringify({ video_path: null, duration_seconds: null }) },
    )
    setBusy(false)
    if (!result.ok) {
      setUploadError(result.error ?? 'Could not detach video')
      return
    }
    onChanged()
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <FileVideo className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
            Video for v{version.version_number}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Stored in Supabase so it can play offline.
            {version.duration_seconds ? ` Duration ${version.duration_seconds}s.` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="hidden"
            onChange={handleSelected}
          />
          <button
            type="button"
            onClick={() => void pickFile()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {version.video_path ? 'Replace video' : 'Upload video'}
          </button>
          {version.video_path && (
            <button
              type="button"
              onClick={() => void clearVideo()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Detach
            </button>
          )}
        </div>
      </div>

      {progressLabel && (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{progressLabel}…</p>
      )}
      {uploadError && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {uploadError}
        </p>
      )}

      <div className="mt-3">
        {signedUrl ? (
          <video controls preload="metadata" className="aspect-video w-full rounded-lg bg-black" src={signedUrl} />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No video attached yet.
          </div>
        )}
      </div>
    </section>
  )
}

const THUMBNAIL_MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}
const MAX_THUMBNAIL_BYTES = 4 * 1024 * 1024
const THUMBNAIL_RECOMMENDED = '1280 x 720 (16:9), under 4 MB'

function ThumbnailSection({
  moduleId, version, scopeRoot, onChanged,
}: {
  moduleId: string
  version: QuizVersionRow
  scopeRoot: string
  onChanged: () => void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setSignedUrl(null)
    if (!version.thumbnail_path) return
    void (async () => {
      const { data } = await supabase.storage
        .from('strike-media')
        .createSignedUrl(version.thumbnail_path!, 60 * 30)
      if (!cancelled) setSignedUrl(data?.signedUrl ?? null)
    })()
    return () => { cancelled = true }
  }, [version.thumbnail_path])

  async function handleSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadError(null)
    const ext = THUMBNAIL_MIME_TO_EXT[file.type]
    if (!ext) {
      setUploadError(`Unsupported image type ${file.type || '(unknown)'}. Use JPG, PNG, WebP, or AVIF.`)
      return
    }
    if (file.size <= 0 || file.size > MAX_THUMBNAIL_BYTES) {
      setUploadError(`Thumbnail must be 1B - ${Math.round(MAX_THUMBNAIL_BYTES / 1_000_000)}MB.`)
      return
    }
    if (!scopeRoot) {
      setUploadError('Cannot resolve storage scope for this version.')
      return
    }

    setBusy(true)
    const path = `${scopeRoot}/${moduleId}/${version.id}-thumb.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('strike-media')
      .upload(path, file, {
        contentType: file.type,
        cacheControl: '604800',
        upsert: true,
      })
    if (uploadErr) {
      setBusy(false)
      setUploadError(`Upload failed: ${uploadErr.message}`)
      return
    }
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/versions/${version.id}`,
      { method: 'PATCH', body: JSON.stringify({ thumbnail_path: path }) },
    )
    setBusy(false)
    if (!result.ok) {
      setUploadError(result.error ?? 'Saved file but failed to update version row')
      return
    }
    onChanged()
  }

  async function clearThumbnail() {
    if (!version.thumbnail_path) return
    if (!confirm('Remove this thumbnail? The image file in storage will be kept.')) return
    setBusy(true)
    const result = await superadminJson(
      `/api/superadmin/strike/${moduleId}/versions/${version.id}`,
      { method: 'PATCH', body: JSON.stringify({ thumbnail_path: null }) },
    )
    setBusy(false)
    if (!result.ok) {
      setUploadError(result.error ?? 'Could not remove thumbnail')
      return
    }
    onChanged()
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            <ImageIcon className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
            Library thumbnail
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{THUMBNAIL_RECOMMENDED}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            className="hidden"
            onChange={handleSelected}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {version.thumbnail_path ? 'Replace' : 'Upload'}
          </button>
          {version.thumbnail_path && (
            <button
              type="button"
              onClick={() => void clearThumbnail()}
              disabled={busy}
              aria-label="Remove thumbnail"
              className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {uploadError && (
        <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {uploadError}
        </p>
      )}

      <div className="mt-3">
        {signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signedUrl}
            alt="Library thumbnail preview"
            className="aspect-video w-full rounded-lg object-cover"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            No thumbnail yet — the library will show a default tile.
          </div>
        )}
      </div>
    </section>
  )
}

function QuestionCard({
  question, index, total, busy,
  onUpdate, onDelete, onMoveUp, onMoveDown,
  onAddAnswer, onUpdateAnswer, onDeleteAnswer,
}: {
  question: QuizQuestionRow
  index: number
  total: number
  busy: boolean
  onUpdate: (patch: Partial<QuizQuestionRow>) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onAddAnswer: () => void
  onUpdateAnswer: (answer: QuizAnswerRow, patch: Partial<QuizAnswerRow>) => void
  onDeleteAnswer: (answerId: string) => void
}) {
  const [prompt, setPrompt] = useState(question.prompt)
  const [explanation, setExplanation] = useState(question.explanation ?? '')
  const [points, setPoints] = useState(String(question.points))

  // Re-sync local edits when the canonical row changes (e.g. after reorder).
  useEffect(() => { setPrompt(question.prompt) }, [question.prompt])
  useEffect(() => { setExplanation(question.explanation ?? '') }, [question.explanation])
  useEffect(() => { setPoints(String(question.points)) }, [question.points])

  const showAnswers = question.question_type !== 'acknowledgement'
  const sortedAnswers = question.answers.slice().sort((a, b) => a.sort_order - b.sort_order)

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            Q{index + 1}
          </span>
          <select
            value={question.question_type}
            onChange={e => onUpdate({ question_type: e.target.value as StrikeQuestionType })}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-950"
          >
            {(Object.keys(QUESTION_TYPE_LABELS) as StrikeQuestionType[]).map(type => (
              <option key={type} value={type}>{QUESTION_TYPE_LABELS[type]}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={question.required}
              onChange={e => onUpdate({ required: e.target.checked })}
            />
            Required
          </label>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0 || busy}
            aria-label="Move up"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1 || busy}
            aria-label="Move down"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-slate-800"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            aria-label="Delete question"
            className="rounded-md p-1 text-rose-500 hover:bg-rose-50 disabled:opacity-30 dark:hover:bg-rose-950/30"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
      </header>

      <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">{QUESTION_TYPE_HINTS[question.question_type]}</p>

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Prompt</span>
          <textarea
            rows={2}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onBlur={() => { if (prompt !== question.prompt) onUpdate({ prompt }) }}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Points</span>
            <input
              type="number"
              min={0}
              value={points}
              onChange={e => setPoints(e.target.value)}
              onBlur={() => {
                const n = Number(points)
                if (Number.isFinite(n) && Math.round(n) !== question.points) onUpdate({ points: Math.max(0, Math.round(n)) })
              }}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Explanation (shown after submit)</span>
            <input
              type="text"
              value={explanation}
              onChange={e => setExplanation(e.target.value)}
              onBlur={() => {
                const next = explanation.trim() || null
                if (next !== (question.explanation ?? null)) onUpdate({ explanation: next })
              }}
              placeholder="Optional"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        </div>

        {showAnswers && (
          <div className="rounded-lg border border-slate-100 p-3 dark:border-slate-800">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Answers</p>
              <button
                type="button"
                onClick={onAddAnswer}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Plus className="h-3 w-3" /> Add answer
              </button>
            </div>
            {sortedAnswers.length === 0 ? (
              <p className="mt-2 text-xs italic text-slate-500 dark:text-slate-400">Add at least two choices and mark the correct one(s).</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {sortedAnswers.map(answer => (
                  <AnswerRow
                    key={answer.id}
                    answer={answer}
                    onUpdate={patch => onUpdateAnswer(answer, patch)}
                    onDelete={() => onDeleteAnswer(answer.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function AnswerRow({
  answer, onUpdate, onDelete,
}: {
  answer: QuizAnswerRow
  onUpdate: (patch: Partial<QuizAnswerRow>) => void
  onDelete: () => void
}) {
  const [text, setText] = useState(answer.answer_text)
  useEffect(() => { setText(answer.answer_text) }, [answer.answer_text])

  return (
    <li className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onUpdate({ is_correct: !answer.is_correct })}
        aria-label={answer.is_correct ? 'Mark as incorrect' : 'Mark as correct'}
        className={answer.is_correct ? 'text-emerald-600 hover:text-emerald-700' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}
      >
        {answer.is_correct ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
      </button>
      <input
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => { if (text.trim() && text !== answer.answer_text) onUpdate({ answer_text: text.trim() }) }}
        className="flex-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
      />
      {text !== answer.answer_text && (
        <button
          type="button"
          onClick={() => onUpdate({ answer_text: text.trim() })}
          aria-label="Save answer"
          className="text-brand-navy hover:text-brand-navy/80"
        >
          <Save className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete answer"
        className="text-rose-500 hover:text-rose-600"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  )
}
