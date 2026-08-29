import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { toSendableHistory } from '@/lib/ai/conversationWindow'

// Regression cover for a live bug: /api/support/chat and /api/assistant/chat
// both persisted the user's new turn and then read history back with
// `.order('created_at', { ascending: true }).limit(20)`. LIMIT applies after
// ORDER BY, so that returns the OLDEST 20 rows. Past 20 stored messages the
// window froze at the opening of the conversation — the model never saw the
// question being asked — and because stored turns alternate, the window also
// ENDED on an assistant turn, which is an assistant prefill and is rejected
// outright by the Claude 4.6 family and later.

interface Turn { role: 'user' | 'assistant'; content: string }

/**
 * A conversation as stored at the moment the route reads it back: strictly
 * alternating and ending on the user turn the route persisted moments earlier.
 * Both routes insert before they read, so the stored history is always an odd
 * number of messages. Returned newest-first, as a descending query gives it.
 */
function storedNewestFirst(completedExchanges: number): Turn[] {
  const messageCount = completedExchanges * 2 + 1
  const chronological: Turn[] = Array.from({ length: messageCount }, (_, i) => ({
    role:    i % 2 === 0 ? 'user' : 'assistant',
    content: `m${i}`,
  }))
  return chronological.reverse()
}

describe('toSendableHistory', () => {
  it('returns an empty window for an empty page', () => {
    expect(toSendableHistory([])).toEqual([])
  })

  it('returns an empty window when the page holds no user turn', () => {
    const page: Turn[] = [{ role: 'assistant', content: 'a' }]
    expect(toSendableHistory(page)).toEqual([])
  })

  it('restores chronological order from a newest-first page', () => {
    const page: Turn[] = [
      { role: 'user',      content: 'third'  },
      { role: 'assistant', content: 'second' },
      { role: 'user',      content: 'first'  },
    ]
    expect(toSendableHistory(page).map(t => t.content)).toEqual([
      'first', 'second', 'third',
    ])
  })

  it('drops a leading assistant turn the tail-slice started on', () => {
    // A tail slice that begins mid-pair: chronologically this is
    // assistant('orphan') / user('ask') / assistant('reply') / user('newest').
    const page: Turn[] = [
      { role: 'user',      content: 'newest' },
      { role: 'assistant', content: 'reply'  },
      { role: 'user',      content: 'ask'    },
      { role: 'assistant', content: 'orphan' },
    ]
    const window = toSendableHistory(page)
    expect(window[0].role).toBe('user')
    expect(window.map(t => t.content)).toEqual(['ask', 'reply', 'newest'])
  })

  it('does not trim when the window already opens on a user turn', () => {
    const page: Turn[] = [
      { role: 'assistant', content: 'reply' },
      { role: 'user',      content: 'ask'   },
    ]
    expect(toSendableHistory(page)).toHaveLength(2)
  })

  it('does not mutate the caller’s array', () => {
    const page: Turn[] = [
      { role: 'user',      content: 'b' },
      { role: 'assistant', content: 'a' },
    ]
    const snapshot = [...page]
    toSendableHistory(page)
    expect(page).toEqual(snapshot)
  })

  // The two invariants the Messages API enforces, across conversation lengths
  // that straddle the 20-row page — the case the old ascending read broke.
  // A 20-row tail of an odd-length history opens on an assistant turn, so
  // these also exercise the trim.
  it.each([0, 1, 9, 10, 11, 20, 50])(
    'yields a sendable window after %i completed exchanges',
    (completedExchanges) => {
      const page = storedNewestFirst(completedExchanges).slice(0, 20)
      const window = toSendableHistory(page)

      expect(window.length).toBeGreaterThan(0)
      expect(window[0].role).toBe('user')
      // Never ends on an assistant turn — that is the prefill the API rejects.
      expect(window[window.length - 1].role).toBe('user')
      // The turn the user just asked is always the one we end on.
      expect(window[window.length - 1].content).toBe(`m${completedExchanges * 2}`)
    },
  )

  it('keeps the window within the page size', () => {
    const page = storedNewestFirst(250).slice(0, 20)
    expect(toSendableHistory(page).length).toBeLessThanOrEqual(20)
  })
})

// Source-text assertions, in the style of __tests__/migrations/*.test.ts.
// The chat routes have no query-builder stub in the unit suite (see the note
// atop __tests__/api/ai/assistant-chat.test.ts), so these prove the routes
// still READ newest-first and route through the helper — not that Postgres
// returns what we expect. The behavioural proof is a >20-message conversation
// against a preview deploy.
const APPS_WEB = resolve(__dirname, '../../..')

describe.each([
  ['support',   'app/api/support/chat/route.ts'],
  ['assistant', 'app/api/assistant/chat/route.ts'],
])('%s chat route history query', (_name, relPath) => {
  const source = readFileSync(resolve(APPS_WEB, relPath), 'utf8')

  it('reads history newest-first', () => {
    expect(source).toMatch(/\.order\(\s*'created_at',\s*\{\s*ascending:\s*false\s*\}\s*\)/)
  })

  it('never reads history oldest-first', () => {
    expect(source).not.toMatch(/\.order\(\s*'created_at',\s*\{\s*ascending:\s*true\s*\}\s*\)/)
  })

  it('routes the page through toSendableHistory', () => {
    expect(source).toContain('toSendableHistory')
  })
})
