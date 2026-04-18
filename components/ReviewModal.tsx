'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import SignaturePad, { type SignaturePadRef } from './SignaturePad'

interface Props {
  department: string
  onSubmit: (payload: {
    reviewer_name: string
    reviewer_email: string | null
    notes: string | null
    approved: boolean
  }) => Promise<{ error: unknown }>
  onClose: () => void
}

export default function ReviewModal({ department, onSubmit, onClose }: Props) {
  const [name, setName]         = useState('')
  const [email, setEmail]       = useState('')
  const [notes, setNotes]       = useState('')
  const [approved, setApproved] = useState(true)
  const [sigEmpty, setSigEmpty] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const sigRef = useRef<SignaturePadRef>(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || sigEmpty) return
    setSubmitting(true)
    setError(null)
    const { error: err } = await onSubmit({
      reviewer_name:  name.trim(),
      reviewer_email: email.trim() || null,
      notes:          notes.trim() || null,
      approved,
    })
    if (err) {
      setError((err as Error)?.message ?? 'Submission failed. Please try again.')
    } else {
      setDone(true)
      setTimeout(onClose, 1800)
    }
    setSubmitting(false)
  }, [name, email, notes, approved, sigEmpty, onSubmit, onClose])

  const canSubmit = name.trim().length > 0 && !sigEmpty && !submitting

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {done ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center text-2xl">✓</div>
            <p className="text-lg font-semibold text-slate-800">Review Submitted</p>
            <p className="text-sm text-slate-500">Signed off by {name}</p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Department Sign-Off</h2>
                <p className="text-xs text-slate-400 mt-0.5">{department}</p>
              </div>
              <button
                onClick={onClose}
                className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-4">
              {/* Approval toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setApproved(true)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    approved
                      ? 'bg-emerald-500 border-emerald-500 text-white'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  ✓ Approved
                </button>
                <button
                  onClick={() => setApproved(false)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                    !approved
                      ? 'bg-rose-500 border-rose-500 text-white'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300'
                  }`}
                >
                  ✗ Needs Action
                </button>
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="reviewer-name">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  id="reviewer-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="reviewer-email">
                  Email <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  id="reviewer-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-600" htmlFor="reviewer-notes">
                  Notes <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="reviewer-notes"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Any observations or follow-up items…"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
                />
              </div>

              {/* Signature */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-600">
                    Signature <span className="text-rose-500">*</span>
                  </label>
                  <button
                    onClick={() => sigRef.current?.clear()}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Clear
                  </button>
                </div>
                <SignaturePad ref={sigRef} onChange={isEmpty => setSigEmpty(isEmpty)} />
                {sigEmpty && (
                  <p className="text-[11px] text-slate-400">Draw your signature above to continue</p>
                )}
              </div>

              {error && (
                <p className="text-sm text-rose-500 font-medium">{error}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 flex items-center gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
              >
                {submitting ? 'Submitting…' : 'Submit Review'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
