'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, Trash2, X, Check } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { Avatar } from '@/components/ui/Avatar'
import MentionInput, { type MentionMember } from '@/components/MentionInput'
import ChatAttachmentView from '@/components/chat/ChatAttachment'
import MessageReactions from '@/components/chat/MessageReactions'
import type { ChatMessage, ChatReactionAggregate } from '@/lib/chat/client'

const MENTION_RE = /@([a-zA-Z0-9._-]{2,64})/g

function renderBody(body: string): React.ReactNode {
  const out: React.ReactNode[] = []
  let last = 0
  body.replace(MENTION_RE, (match, _h, offset: number) => {
    if (offset > last) out.push(body.slice(last, offset))
    out.push(
      <span
        key={`m-${offset}`}
        className="inline-block rounded bg-brand-navy/10 dark:bg-brand-yellow/15 px-1 text-brand-navy dark:text-brand-yellow font-medium"
      >
        {match}
      </span>,
    )
    last = offset + match.length
    return match
  })
  if (last < body.length) out.push(body.slice(last))
  return out
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  return isToday
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

interface Props {
  messages:   ChatMessage[]
  members:    MentionMember[]
  onEdit:     (msgId: string, body: string) => Promise<void>
  onDelete:   (msgId: string) => Promise<void>
  onReactionsChange: (msgId: string, next: ChatReactionAggregate[]) => void
}

export default function MessageList({ messages, members, onEdit, onDelete, onReactionsChange }: Props) {
  const { userId } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const [editId, setEditId]       = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  // Auto-scroll to the latest message when the list grows. Skips when
  // the user has scrolled up to read history (heuristic: bottom within
  // 80px counts as "still at bottom").
  const lastLenRef = useRef(messages.length)
  useEffect(() => {
    if (messages.length === lastLenRef.current) return
    const el = containerRef.current
    if (!el) { lastLenRef.current = messages.length; return }
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distFromBottom < 80) {
      el.scrollTop = el.scrollHeight
    }
    lastLenRef.current = messages.length
  }, [messages.length])

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 bg-slate-50 dark:bg-slate-950">
      {messages.length === 0 && (
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 py-12">
          No messages yet. Start the conversation.
        </p>
      )}
      {messages.map(m => {
        const display  = m.author_full_name || m.author_email || 'Unknown user'
        const isAuthor = m.author_user_id === userId
        const editing  = editId === m.id
        return (
          <div key={m.id} className="flex gap-2 group">
            <Avatar src={m.author_avatar_url} name={m.author_full_name} email={m.author_email} size="sm" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{display}</span>
                <span>· {formatTimestamp(m.created_at)}</span>
                {m.edited_at && <span className="italic">(edited)</span>}
                {isAuthor && !editing && (
                  <span className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => { setEditId(m.id); setEditDraft(m.body) }}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      title="Edit"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { void onDelete(m.id) }}
                      className="text-rose-400 hover:text-rose-600"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                )}
              </div>
              {editing ? (
                <div className="mt-1 space-y-1">
                  <MentionInput
                    value={editDraft}
                    onChange={setEditDraft}
                    members={members}
                    rows={2}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!editDraft.trim()) return
                        await onEdit(m.id, editDraft.trim())
                        setEditId(null); setEditDraft('')
                      }}
                      className="inline-flex items-center gap-1 rounded bg-brand-navy text-white px-2 py-1 text-[11px] font-semibold hover:bg-brand-navy/90"
                    >
                      <Check className="h-3 w-3" /> Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setEditId(null); setEditDraft('') }}
                      className="inline-flex items-center gap-1 rounded ring-1 ring-slate-200 dark:ring-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300"
                    >
                      <X className="h-3 w-3" /> Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {m.body && (
                    <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
                      {renderBody(m.body)}
                    </p>
                  )}
                  {m.attachments.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {m.attachments.map(a => (
                        <ChatAttachmentView key={a.id} attachment={a} />
                      ))}
                    </div>
                  )}
                  <MessageReactions
                    messageId={m.id}
                    reactions={m.reactions}
                    onChange={next => onReactionsChange(m.id, next)}
                  />
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
