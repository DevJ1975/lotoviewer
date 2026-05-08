'use client'

import { useState } from 'react'
import { SmilePlus } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { addBoardReaction, removeBoardReaction, type SafetyReaction } from '@/lib/safetyBoards/client'

const QUICK_PICKS = ['👍', '✅', '🎉', '👀', '🚧', '⚠️', '❤️', '🙏']

interface Props {
  targetType: 'thread' | 'reply'
  targetId:   string
  reactions:  SafetyReaction[]
  onChange:   (next: SafetyReaction[]) => void
}

function toggleLocal(reactions: SafetyReaction[], emoji: string, userId: string): SafetyReaction[] {
  const idx = reactions.findIndex(r => r.emoji === emoji)
  if (idx === -1) return [...reactions, { emoji, user_ids: [userId], count: 1 }]
  const r = reactions[idx]
  const has = r.user_ids.includes(userId)
  const nextUsers = has ? r.user_ids.filter(u => u !== userId) : [...r.user_ids, userId]
  if (nextUsers.length === 0) return reactions.filter((_, i) => i !== idx)
  const copy = reactions.slice()
  copy[idx] = { emoji, user_ids: nextUsers, count: nextUsers.length }
  return copy
}

export default function BoardReactions({ targetType, targetId, reactions, onChange }: Props) {
  const { userId } = useAuth()
  const { tenant } = useTenant()
  const [open, setOpen] = useState(false)

  async function toggle(emoji: string) {
    if (!tenant?.id || !userId) return
    const has = reactions.find(r => r.emoji === emoji)?.user_ids.includes(userId)
    onChange(toggleLocal(reactions, emoji, userId))
    try {
      if (has) await removeBoardReaction(tenant.id, targetType, targetId, emoji)
      else     await addBoardReaction(tenant.id, targetType, targetId, emoji)
    } catch {
      onChange(toggleLocal(reactions, emoji, userId))
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map(r => {
        const isMine = !!userId && r.user_ids.includes(userId)
        return (
          <button
            type="button"
            key={r.emoji}
            onClick={() => void toggle(r.emoji)}
            className={
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 transition-colors ' +
              (isMine
                ? 'bg-brand-navy/10 dark:bg-brand-yellow/15 ring-brand-navy/30 text-brand-navy dark:text-brand-yellow'
                : 'bg-slate-100 dark:bg-slate-800 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700')
            }
            title={r.user_ids.length === 1 ? '1 reaction' : `${r.count} reactions`}
          >
            <span aria-hidden>{r.emoji}</span>
            <span>{r.count}</span>
          </button>
        )
      })}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          title="Add reaction"
        >
          <SmilePlus className="h-3.5 w-3.5" />
        </button>
        {open && (
          <div className="absolute z-30 left-0 mt-1 flex gap-1 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-lg p-1">
            {QUICK_PICKS.map(emoji => (
              <button
                type="button"
                key={emoji}
                onMouseDown={e => { e.preventDefault(); setOpen(false); void toggle(emoji) }}
                className="rounded p-1 text-base hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
