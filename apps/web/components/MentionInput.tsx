'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'

// Textarea with @-autocomplete from a list of tenant members.
// Reused by:
//   - action-item comment thread (Phase 2)
//   - chat message composer (Phase 3)
//   - safety-board thread/reply composer (Phase 4)
//
// Pure UI: the parent supplies the candidate list (already tenant-
// scoped) and gets back the raw body string. Server-side resolution
// (lib/notifications/mentions.ts) is the source of truth for which
// tokens become real mentions.
//
// Autocomplete strategy:
//   - Trigger when the cursor is at, or just after, an `@` token.
//   - Match candidate's full_name slug or email local-part.
//   - Up to 8 suggestions, ranked by prefix match then substring.
//   - Arrow-up/down to navigate, Enter or Tab to accept, Esc to dismiss.

export interface MentionMember {
  user_id:    string
  member_id?:  string | null
  handle?:     string | null
  email:      string | null
  full_name:  string | null
  avatar_url?: string | null
  position_title?: string | null
  department?: string | null
  shift_label?: string | null
  readiness_status?: string | null
}

interface Props {
  value:        string
  onChange:     (next: string) => void
  members:      MentionMember[]
  placeholder?: string
  rows?:        number
  disabled?:    boolean
  className?:   string
}

interface Suggestion {
  member: MentionMember
  handle: string                   // canonical token to insert
  label:  string                   // display name
  sub:    string                   // secondary line
}

function slug(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

function localPart(email: string | null | undefined): string {
  if (!email) return ''
  const at = email.indexOf('@')
  return (at < 0 ? email : email.slice(0, at)).toLowerCase()
}

function buildSuggestions(members: MentionMember[]): Suggestion[] {
  return members.map(m => {
    const handle = m.handle || slug(m.full_name) || localPart(m.email) || m.user_id.slice(0, 8)
    const label  = m.full_name || m.email || m.user_id
    const subParts = [
      m.position_title,
      m.department,
      m.shift_label,
      m.email && m.full_name ? m.email : null,
    ].filter(Boolean)
    const sub = subParts.join(' · ')
    return { member: m, handle, label, sub }
  })
}

// Find the @-trigger immediately preceding the cursor. Returns null
// when there's no active trigger (cursor not after @, whitespace
// in the partial token, etc.).
function findTrigger(value: string, cursor: number): { start: number; partial: string } | null {
  // Walk backward from the cursor until we hit '@', whitespace, or
  // start-of-string.
  let i = cursor - 1
  while (i >= 0) {
    const ch = value[i]
    if (ch === '@') {
      // Make sure the @ is at start-of-string or follows whitespace —
      // otherwise it's part of an email like "alice@example.com" and
      // we shouldn't trigger.
      const prev = i === 0 ? ' ' : value[i - 1]
      if (!/\s/.test(prev)) return null
      return { start: i, partial: value.slice(i + 1, cursor).toLowerCase() }
    }
    if (/\s/.test(ch)) return null
    if (cursor - i > 32) return null    // runaway — give up
    i--
  }
  return null
}

function rank(partial: string, s: Suggestion): number {
  if (!partial) return 0
  const h = s.handle
  const l = s.label.toLowerCase()
  if (h.startsWith(partial)) return 100
  if (l.startsWith(partial)) return 90
  if (h.includes(partial))   return 50
  if (l.includes(partial))   return 40
  return -1
}

export default function MentionInput({
  value, onChange, members, placeholder, rows = 2, disabled, className,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const all = useMemo(() => buildSuggestions(members), [members])

  const [open, setOpen]         = useState(false)
  const [partial, setPartial]   = useState('')
  const [trigger, setTrigger]   = useState<{ start: number } | null>(null)
  const [active, setActive]     = useState(0)

  // Recompute suggestions when partial / members change.
  const suggestions = useMemo(() => {
    if (!open) return [] as Suggestion[]
    const ranked = all
      .map(s => ({ s, r: rank(partial, s) }))
      .filter(x => x.r >= 0)
      .sort((a, b) => b.r - a.r)
      .slice(0, 8)
      .map(x => x.s)
    return ranked
  }, [all, partial, open])

  useEffect(() => { if (suggestions.length === 0) setActive(0); else if (active >= suggestions.length) setActive(0) }, [suggestions, active])

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    onChange(next)
    const cursor = e.target.selectionStart ?? next.length
    const t = findTrigger(next, cursor)
    if (t) {
      setOpen(true)
      setTrigger({ start: t.start })
      setPartial(t.partial)
    } else {
      setOpen(false)
      setTrigger(null)
      setPartial('')
    }
  }

  function accept(s: Suggestion) {
    if (!trigger) return
    const before = value.slice(0, trigger.start)
    const cursor = ref.current?.selectionStart ?? value.length
    const after  = value.slice(cursor)
    const insert = `@${s.handle} `
    const next   = before + insert + after
    onChange(next)
    setOpen(false)
    setTrigger(null)
    setPartial('')
    // Move the caret to just after the inserted handle.
    requestAnimationFrame(() => {
      const ta = ref.current
      if (!ta) return
      const newPos = before.length + insert.length
      ta.focus()
      ta.setSelectionRange(newPos, newPos)
    })
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, suggestions.length - 1)); return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setActive(a => Math.max(a - 1, 0));                       return }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      accept(suggestions[active])
      return
    }
    if (e.key === 'Escape') { setOpen(false); return }
  }

  return (
    <div className={'relative ' + (className ?? '')}>
      <textarea
        ref={ref}
        value={value}
        onChange={handleInput}
        onKeyDown={handleKey}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 mt-1 z-30 max-h-64 overflow-auto rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-lg">
          {suggestions.map((s, idx) => (
            <button
              type="button"
              key={s.member.user_id}
              onMouseDown={e => { e.preventDefault(); accept(s) }}
              onMouseEnter={() => setActive(idx)}
              className={
                'w-full flex items-center gap-2 px-3 py-2 text-left text-sm ' +
                (idx === active
                  ? 'bg-slate-100 dark:bg-slate-800'
                  : 'hover:bg-slate-50 dark:hover:bg-slate-800/50')
              }
            >
              <Avatar
                src={s.member.avatar_url}
                name={s.member.full_name}
                email={s.member.email}
                size="xs"
              />
              <span className="flex-1 min-w-0">
                <span className="font-medium text-slate-700 dark:text-slate-200 truncate block">{s.label}</span>
                {s.sub && <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">@{s.handle} · {s.sub}</span>}
                {!s.sub && <span className="text-xs text-slate-500 dark:text-slate-400 truncate block">@{s.handle}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
