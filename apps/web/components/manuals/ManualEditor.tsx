'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Bold, Heading2, Heading3, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered, Loader2, Save, Video } from 'lucide-react'
import { renderManualMd } from '@/lib/manuals/markdown'
import { patchManual, uploadManualImage, type ManualDetail } from '@/lib/manuals/client'

// Two-pane editor for module manuals. Live preview on the right.
// Toolbar inserts markdown (no rich-text contenteditable — keeps the
// authoring surface predictable + matches what readers see).

interface Props {
  initial: ManualDetail
}

export default function ManualEditor({ initial }: Props) {
  const [title, setTitle]   = useState(initial.title)
  const [summary, setSummary] = useState(initial.summary ?? '')
  const [body, setBody]     = useState(initial.body_md)
  const [changeNote, setChangeNote] = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const [ok, setOk]         = useState<string | null>(null)
  const [published, setPublished] = useState<boolean>(!!initial.published_at)

  const fileRef = useRef<HTMLInputElement>(null)
  const taRef   = useRef<HTMLTextAreaElement>(null)

  const previewHtml = useMemo(() => renderManualMd(body), [body])

  function wrapSelection(prefix: string, suffix: string = prefix) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const next  = body.slice(0, start) + prefix + body.slice(start, end) + suffix + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      ta.setSelectionRange(start + prefix.length, end + prefix.length)
    })
  }

  function insertAtCursor(text: string) {
    const ta = taRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end   = ta.selectionEnd
    const next  = body.slice(0, start) + text + body.slice(end)
    setBody(next)
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + text.length
      ta.setSelectionRange(pos, pos)
    })
  }

  function insertHeading(level: 2 | 3) {
    insertAtCursor(`\n\n${'#'.repeat(level)} Heading\n\n`)
  }

  async function uploadImage(file: File) {
    setBusy(true); setErr(null)
    try {
      const { url } = await uploadManualImage(file, initial.module_id)
      insertAtCursor(`\n\n![${file.name}](${url})\n\n`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function save() {
    setBusy(true); setErr(null); setOk(null)
    try {
      await patchManual(initial.module_id, {
        title,
        summary: summary.trim() || null,
        body_md: body,
        change_note: changeNote.trim() || undefined,
        publish:   published && !initial.published_at ? true : undefined,
        unpublish: !published && !!initial.published_at ? true : undefined,
      })
      setChangeNote('')
      setOk('Saved.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block flex-1 min-w-[16rem]">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Title</span>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </label>
        <label className="block flex-1 min-w-[16rem]">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Summary (one-line index blurb)</span>
          <input
            value={summary}
            onChange={e => setSummary(e.target.value)}
            maxLength={300}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={published}
            onChange={e => setPublished(e.target.checked)}
          />
          <span>Published</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 px-2 py-1">
        <ToolbarButton title="Bold (**)"   onClick={() => wrapSelection('**')}><Bold className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Italic (*)"  onClick={() => wrapSelection('*')}><Italic className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Heading 2"   onClick={() => insertHeading(2)}><Heading2 className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Heading 3"   onClick={() => insertHeading(3)}><Heading3 className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Bullet list" onClick={() => insertAtCursor('\n- item\n- item\n')}><List className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Numbered list" onClick={() => insertAtCursor('\n1. item\n2. item\n')}><ListOrdered className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Link" onClick={() => insertAtCursor('[label](https://)')}><LinkIcon className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Upload image" onClick={() => fileRef.current?.click()}><ImageIcon className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Embed video (Loom / YouTube / Vimeo / Wistia)" onClick={() => insertAtCursor('\n\n:::video youtube:VIDEO_ID :::\n\n')}><Video className="h-3.5 w-3.5" /></ToolbarButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={e => { const f = e.target.files?.[0]; if (f) void uploadImage(f) }}
          className="hidden"
        />
        <span className="ml-auto text-[11px] text-slate-500 dark:text-slate-400">
          {body.length.toLocaleString()} chars · v{initial.version}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <textarea
          ref={taRef}
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={26}
          spellCheck
          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono leading-relaxed"
        />
        <div
          className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-3 text-sm prose-manual overflow-y-auto max-h-[40rem] bg-white dark:bg-slate-900"
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[16rem]">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Change note (shown in changelog)</span>
          <input
            value={changeNote}
            onChange={e => setChangeNote(e.target.value)}
            placeholder="e.g. added group-lock walkthrough + screenshots"
            maxLength={500}
            className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => void save()}
          className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
        <Link
          href={`/manuals/${initial.module_id}/changelog`}
          className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
        >
          View changelog →
        </Link>
      </div>

      {err && <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded px-3 py-2">{err}</p>}
      {ok  && <p className="text-sm text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 rounded px-3 py-2">{ok}</p>}
    </div>
  )
}

function ToolbarButton({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
    >
      {children}
    </button>
  )
}
