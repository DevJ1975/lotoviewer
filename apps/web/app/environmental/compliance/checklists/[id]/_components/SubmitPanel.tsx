'use client'

import { useRef, useState } from 'react'
import { Loader2, PenLine } from 'lucide-react'
import SignaturePad, { type SignaturePadRef } from '@/components/SignaturePad'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import type { RunItemView } from '@/lib/environmental/client'

// The last step: confirm the answers are accurate and sign. Submitting is blocked
// while required questions are open, and the panel lists them so each is a tap
// away, rather than failing at the end with a message.

interface Props {
  missing: RunItemView[]
  name: string
  onNameChange: (name: string) => void
  busy: boolean
  errors: string[]
  onSubmit: (signatureDrawing: string | null) => void
  onJumpTo: (itemId: string) => void
}

export function SubmitPanel({ missing, name, onNameChange, busy, errors, onSubmit, onJumpTo }: Props) {
  const pad = useRef<SignaturePadRef>(null)
  const [attested, setAttested] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const nameOk = name.trim().length >= 2
  const ready = missing.length === 0 && attested && nameOk && !busy

  return (
    <section aria-labelledby="submit-heading" className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <h2 id="submit-heading" className="text-sm font-semibold text-slate-900 dark:text-slate-100">Review and sign</h2>

      {missing.length > 0 && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <p className="font-semibold">{missing.length} required {missing.length === 1 ? 'question is' : 'questions are'} still open:</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map(m => (
              <li key={m.id}><button type="button" className="text-left underline" onClick={() => onJumpTo(m.id)}>{m.prompt}</button></li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} className="mt-1 h-4 w-4" />
        <span>I confirm these answers are accurate and I did the inspection myself.</span>
      </label>

      <Field label="Your name" hint="Typed as your signature. It is stored with the time you submit.">
        <input value={name} onChange={e => onNameChange(e.target.value)} maxLength={120} autoComplete="name" className={inputCls} />
      </Field>

      <details className="rounded-md border border-slate-200 p-2 dark:border-slate-800">
        <summary className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-400"><PenLine className="h-3.5 w-3.5" /> Also sign with your finger or mouse (optional)</summary>
        <div className="mt-2 space-y-2">
          <SignaturePad ref={pad} onChange={isEmpty => setDrawing(!isEmpty)} />
          <button type="button" className={secondaryButtonCls} onClick={() => pad.current?.clear()}>Clear</button>
        </div>
      </details>

      <ErrorList errors={errors} />

      <button
        type="button" disabled={!ready} className={primaryButtonCls}
        onClick={() => onSubmit(drawing && pad.current && !pad.current.isEmpty() ? pad.current.toDataURL() : null)}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Submit checklist
      </button>
      {!ready && !busy && (
        <p className="text-xs text-slate-500">
          {missing.length > 0 ? 'Answer the required questions to submit.' : !attested ? 'Confirm the statement above to submit.' : 'Type your name to submit.'}
        </p>
      )}
    </section>
  )
}
