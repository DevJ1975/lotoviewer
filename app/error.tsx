'use client'

// Route-level error boundary. Wraps every page below app/ (but NOT the root
// layout — if layout.tsx ever throws we'd need global-error.tsx for that).
// A render error anywhere in a page tree would otherwise produce a blank
// white screen in production; this renders a recoverable fallback and lets
// the user retry without losing their place in the PWA shell.
import { useEffect } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'

interface Props {
  error:          Error & { digest?: string }
  unstable_retry: () => void
}

export default function Error({ error, unstable_retry }: Props) {
  useEffect(() => {
    // Surfacing digest + message in the console lets us grep server logs
    // for the matching entry — the digest is the stable cross-process key.
    console.error('[error-boundary]', {
      message: error.message,
      digest:  error.digest,
      stack:   error.stack,
    })
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="text-center max-w-md w-full rounded-2xl bg-white ring-1 ring-slate-200 p-8 space-y-4">
        <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center mx-auto">
          <AlertTriangle className="h-7 w-7 text-rose-600" />
        </div>
        <div className="space-y-1">
          <h1 className="text-lg font-bold text-slate-900">Something went wrong</h1>
          <p className="text-sm text-slate-500">
            The page ran into an unexpected error. Your data is safe.
          </p>
        </div>
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors min-h-[44px]"
        >
          <RefreshCcw className="h-4 w-4" />
          Try again
        </button>
        {error.digest && (
          <p className="text-[11px] text-slate-400 font-mono">ref: {error.digest}</p>
        )}
      </div>
    </div>
  )
}
