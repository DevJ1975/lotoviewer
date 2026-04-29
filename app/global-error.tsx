'use client'

// Root-level error boundary. Catches crashes in app/layout.tsx itself
// (anything app/error.tsx can't reach because it lives BELOW layout).
// Must render its own <html> + <body> because at this point the root
// layout has failed.
//
// Reports to Sentry, then renders a minimal apology screen with a
// reload button. No reliance on Tailwind / app shell — this is the
// fallback when nothing else works.

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { source: 'global-error', digest: error.digest ?? 'unknown' },
    })
  }, [error])

  return (
    <html lang="en">
      <body style={{
        margin: 0,
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#0f172a',
        color: '#f1f5f9',
        padding: '24px',
      }}>
        <div style={{ maxWidth: '480px', textAlign: 'center' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.6, marginBottom: '8px' }}>
            Soteria FIELD
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: 800, margin: '0 0 12px' }}>
            Something went seriously wrong.
          </h1>
          <p style={{ fontSize: '14px', lineHeight: 1.5, opacity: 0.8, margin: '0 0 24px' }}>
            The app couldn&rsquo;t recover. We&rsquo;ve already been notified.
            Try reloading the page; if it keeps happening, email{' '}
            <a href="mailto:jamil@trainovations.com" style={{ color: '#FFD900' }}>support</a>.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '12px 20px',
              borderRadius: '10px',
              border: 'none',
              background: '#1B3A6B',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ fontSize: '11px', fontFamily: 'ui-monospace, Menlo, monospace', opacity: 0.5, marginTop: '24px' }}>
              ref: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
