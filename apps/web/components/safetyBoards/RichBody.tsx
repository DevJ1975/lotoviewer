'use client'

import Link from 'next/link'
import { findCrossRefs, hrefForCrossRef } from '@/lib/safetyBoards/crossRef'

// Renders thread / reply body text with two inline enrichments:
//   - @-mentions  → existing brand-tinted chips
//   - #cross-refs → linked chips, e.g. #INC-42 → /incidents/42
//
// Plain whitespace + line breaks preserved. The renderer walks the
// string once and emits a single React node per token to keep the
// keys stable across re-renders.

const MENTION_RE = /@([a-zA-Z0-9._-]{2,64})/g

interface Token {
  kind:  'text' | 'mention' | 'crossref'
  start: number
  end:   number
  text:  string
  href?: string
}

function tokenize(body: string): Token[] {
  const tokens: Token[] = []
  // Find both kinds first, sort, then weave with intervening text.
  const found: Array<Omit<Token, 'kind'> & { kind: 'mention' | 'crossref' }> = []

  // Mentions.
  for (const m of body.matchAll(MENTION_RE)) {
    if (m.index == null) continue
    found.push({
      kind: 'mention',
      start: m.index,
      end:   m.index + m[0].length,
      text:  m[0],
    })
  }
  // Cross-refs.
  for (const r of findCrossRefs(body)) {
    found.push({
      kind: 'crossref',
      start: r.start,
      end:   r.end,
      text:  body.slice(r.start, r.end),
      href:  hrefForCrossRef(r) ?? undefined,
    })
  }

  found.sort((a, b) => a.start - b.start)

  let cursor = 0
  for (const f of found) {
    if (f.start < cursor) continue   // overlapping match — skip
    if (f.start > cursor) {
      tokens.push({ kind: 'text', start: cursor, end: f.start, text: body.slice(cursor, f.start) })
    }
    tokens.push(f)
    cursor = f.end
  }
  if (cursor < body.length) {
    tokens.push({ kind: 'text', start: cursor, end: body.length, text: body.slice(cursor) })
  }
  return tokens
}

export default function RichBody({ body, className }: { body: string; className?: string }) {
  const tokens = tokenize(body)
  return (
    <p className={'whitespace-pre-wrap break-words ' + (className ?? '')}>
      {tokens.map((t, i) => {
        if (t.kind === 'text') return <span key={i}>{t.text}</span>
        if (t.kind === 'mention') {
          return (
            <span
              key={i}
              className="inline-block rounded bg-brand-navy/10 dark:bg-brand-yellow/15 px-1 text-brand-navy dark:text-brand-yellow font-medium"
            >
              {t.text}
            </span>
          )
        }
        // crossref
        if (t.href) {
          return (
            <Link
              key={i}
              href={t.href}
              className="inline-block rounded bg-emerald-100 dark:bg-emerald-900/30 px-1 text-emerald-800 dark:text-emerald-200 font-medium hover:underline"
            >
              {t.text}
            </Link>
          )
        }
        return (
          <span
            key={i}
            className="inline-block rounded bg-slate-100 dark:bg-slate-800 px-1 text-slate-600 dark:text-slate-300 font-medium"
            title="No detail page for this reference type"
          >
            {t.text}
          </span>
        )
      })}
    </p>
  )
}
