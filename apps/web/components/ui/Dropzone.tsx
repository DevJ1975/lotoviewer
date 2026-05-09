'use client'

import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { FileText, FileUp, X } from 'lucide-react'

// Shared file-upload dropzone. Used by:
//   - /superadmin/policies (regulation + company-policy ingest)
//   - /chemicals/new (initial SDS upload)
//   - /chemicals/[id] (SDS revision upload)
//
// Behaviour:
//   - Click anywhere on the box → opens the native file picker
//   - Drag a file over the box → indigo highlight
//   - Drop a file → validate (MIME / size / non-empty) and call onFileSelected
//   - X button on the selected-file chip clears the selection (and resets
//     the underlying input so picking the SAME file again still fires
//     onChange — without the reset, the browser deduplicates the event)
//
// Accessibility:
//   - The native <input> is sr-only (not display:none) so screen readers
//     and keyboard tab order still reach it. The visible box is its
//     <label>, so keyboard users get the file picker via Tab + Enter.
//
// Why not a third-party dep (react-dropzone): we need ~80 LOC and
// react-dropzone is ~12kb gz with peer-dep churn. The drag-depth
// counter, ext-fallback validator, and same-file reset are the only
// non-trivial bits and they're easier to get right inline.

const DEFAULT_MIMES = new Set([
  'text/markdown',
  'text/x-markdown',
  'text/plain',
  'application/pdf',
])
const DEFAULT_EXTS = new Set(['md', 'markdown', 'txt', 'pdf'])
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

interface DropzoneProps {
  /** Called when a valid file is selected. Pass null to clear. */
  onFileSelected: (file: File | null) => void
  /** Currently-selected file. Drives the "selected" UI. */
  file: File | null
  /** Called with a human-readable reason when the user picks an
   *  invalid file. Caller decides where to display it. */
  onValidationError?: (reason: string) => void
  /** MIME allowlist. Defaults to MD/TXT/PDF. */
  acceptedMimes?: Set<string>
  /** Extension allowlist (lowercase, no dot). Used as a fallback when
   *  file.type is empty (Windows ZIPs MIME off, Linux clipboards do too). */
  acceptedExts?: Set<string>
  /** `accept` attribute for the native picker. Should mirror acceptedMimes
   *  / acceptedExts. Defaults to MD/TXT/PDF. */
  acceptAttr?: string
  /** Max byte cap. Defaults to 25 MB to match the policy/SDS pipeline. */
  maxBytes?: number
  /** Helper text below the headline. */
  helpText?: ReactNode
  /** Pass when multiple Dropzones live on the same page so the native
   *  input gets a unique id (the label htmlFor wires them together). */
  inputId?: string
  /** Disable interaction (e.g. while an upload is in flight). */
  disabled?: boolean
}

export interface ValidationResult {
  ok: true
}

export interface ValidationError {
  ok: false
  reason: string
}

/**
 * Pure validator. Exported so callers + tests can reuse the same
 * client-side rules the dropzone enforces. Mirrors the server-side
 * caps in lib/ai/policyExtract.ts and the SDS upload route.
 */
export function validateDroppedFile(
  file: File,
  opts: {
    acceptedMimes?: Set<string>
    acceptedExts?:  Set<string>
    maxBytes?:      number
  } = {},
): ValidationResult | ValidationError {
  const mimes = opts.acceptedMimes ?? DEFAULT_MIMES
  const exts  = opts.acceptedExts  ?? DEFAULT_EXTS
  const cap   = opts.maxBytes      ?? DEFAULT_MAX_BYTES
  const accepted = (file.type && mimes.has(file.type))
    || exts.has((file.name.split('.').pop() ?? '').toLowerCase())
  if (!accepted) {
    return { ok: false, reason: `Unsupported file type. Got ${file.type || file.name}.` }
  }
  if (file.size === 0) {
    return { ok: false, reason: 'File is empty.' }
  }
  if (file.size > cap) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    const capMb = (cap / 1024 / 1024).toFixed(0)
    return { ok: false, reason: `File is ${mb} MB — over the ${capMb} MB cap.` }
  }
  return { ok: true }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function Dropzone(props: DropzoneProps) {
  const {
    onFileSelected,
    file,
    onValidationError,
    acceptedMimes,
    acceptedExts,
    acceptAttr  = '.md,.markdown,.txt,.pdf,text/markdown,text/plain,application/pdf',
    maxBytes,
    helpText    = 'Markdown, plain text, or PDF (≤25MB).',
    inputId     = 'dropzone-file',
    disabled    = false,
  } = props

  const [dragActive, setDragActive] = useState(false)
  // dragDepth counts dragenter/dragleave events. Without it, every
  // dragleave on a child element flickers the highlight off — even
  // though the cursor is still over the zone.
  const dragDepthRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  function accept(picked: File | null) {
    if (!picked) { onFileSelected(null); return }
    const v = validateDroppedFile(picked, { acceptedMimes, acceptedExts, maxBytes })
    if (!v.ok) {
      onValidationError?.(v.reason)
      onFileSelected(null)
      return
    }
    onFileSelected(picked)
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault(); e.stopPropagation()
    dragDepthRef.current = 0
    setDragActive(false)
    if (disabled) return
    const dt = e.dataTransfer
    if (!dt || dt.files.length === 0) return
    if (dt.files.length > 1) {
      onValidationError?.('Drop one file at a time.')
      return
    }
    accept(dt.files[0])
  }
  function onDragEnter(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault(); e.stopPropagation()
    if (disabled) return
    dragDepthRef.current += 1
    setDragActive(true)
  }
  function onDragLeave(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault(); e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragActive(false)
  }
  function onDragOver(e: DragEvent<HTMLLabelElement>) {
    // Required — without preventDefault here, the browser refuses
    // the subsequent drop event entirely.
    e.preventDefault(); e.stopPropagation()
  }

  return (
    <label
      htmlFor={inputId}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={[
        'flex flex-col items-center justify-center gap-2 px-4 py-8 rounded-md border-2 border-dashed transition-colors',
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
        dragActive
          ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-900/20'
          : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30',
      ].join(' ')}
    >
      {file ? (
        <div className="flex items-center gap-3 w-full max-w-md">
          <FileText className="h-5 w-5 text-slate-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{file.name}</div>
            <div className="text-[11px] text-slate-500">{formatBytes(file.size)} · {file.type || 'unknown type'}</div>
          </div>
          <button
            type="button"
            onClick={e => {
              e.preventDefault()
              accept(null)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
            disabled={disabled}
            aria-label="Remove file"
            className="p-1 rounded text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/30 disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <FileUp className={`h-6 w-6 ${dragActive ? 'text-indigo-500' : 'text-slate-400'}`} />
          <div className="text-center">
            <p className="text-sm text-slate-700 dark:text-slate-200">
              <span className="font-medium text-indigo-600 dark:text-indigo-400">Click to browse</span>
              {' '}or drag a file here
            </p>
            <p className="mt-1 text-[11px] text-slate-500">{helpText}</p>
          </div>
        </>
      )}
      <input
        ref={fileInputRef}
        id={inputId}
        type="file"
        accept={acceptAttr}
        disabled={disabled}
        onChange={e => {
          accept(e.target.files?.[0] ?? null)
          // Reset so picking the SAME file again still fires a fresh
          // change event. Critical for the immediate-upload pattern
          // (file=null callers) where re-uploading a re-saved revision
          // would otherwise be silently dropped by the browser's input
          // dedup. The displayed selected-file UI reads from the `file`
          // prop, not from the input element, so clearing here is safe
          // for the state-holding callers too.
          e.target.value = ''
        }}
        className="sr-only"
      />
    </label>
  )
}
