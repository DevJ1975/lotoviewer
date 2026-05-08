'use client'

import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { createChannel } from '@/lib/chat/client'
import type { MentionMember } from '@/components/MentionInput'
import { Avatar } from '@/components/ui/Avatar'

interface Props {
  members: MentionMember[]
  onClose: () => void
  onCreated: (channelId: string) => void
}

export default function NewChannelDialog({ members, onClose, onCreated }: Props) {
  const { tenant, role } = useTenant()
  const isAdmin = role === 'admin' || role === 'owner'

  const [name, setName]     = useState('')
  const [desc, setDesc]     = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)

  function togglePick(uid: string) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else               next.add(uid)
      return next
    })
  }

  async function submit() {
    if (!tenant?.id) return
    setBusy(true); setError(null)
    try {
      const ch = await createChannel(tenant.id, {
        name:        name.trim(),
        description: desc.trim() || undefined,
        member_user_ids: Array.from(picked),
      })
      onCreated(ch.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="New channel" onClose={onClose}>
      {!isAdmin ? (
        <p className="text-sm text-rose-700 dark:text-rose-300">
          Only tenant admins can create channels. Ask your administrator,
          or send a Direct Message instead.
        </p>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={80}
              placeholder="general"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              maxLength={200}
              placeholder="Optional — what's this channel for?"
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
            />
          </label>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Members</span>
            <div className="mt-1 max-h-56 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
              {members.length === 0 ? (
                <p className="p-3 text-sm text-slate-500 dark:text-slate-400">No teammates yet.</p>
              ) : members.map(m => (
                <label key={m.user_id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={picked.has(m.user_id)}
                    onChange={() => togglePick(m.user_id)}
                  />
                  <Avatar src={m.avatar_url ?? null} name={m.full_name} email={m.email} size="xs" />
                  <span className="flex-1 min-w-0 truncate">{m.full_name || m.email}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">You&apos;re added automatically as channel admin.</p>
          </div>
          {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-1.5 text-sm">Cancel</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !name.trim()}
              className="rounded-lg bg-brand-navy text-white px-3 py-1.5 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50 inline-flex items-center gap-1"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Create
            </button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

export function NewDMDialog({ members, onClose, onCreated, currentUserId }: {
  members: MentionMember[]
  currentUserId: string | null
  onClose: () => void
  onCreated: (channelId: string) => void
}) {
  const { tenant } = useTenant()
  const [busy, setBusy]   = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function pick(uid: string) {
    if (!tenant?.id) return
    setBusy(uid); setError(null)
    try {
      const { findOrCreateDM } = await import('@/lib/chat/client')
      const ch = await findOrCreateDM(tenant.id, uid)
      onCreated(ch.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const others = members.filter(m => m.user_id !== currentUserId)
  return (
    <Dialog title="New direct message" onClose={onClose}>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        Pick a teammate to start a private conversation.
      </p>
      <div className="max-h-72 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
        {others.length === 0 ? (
          <p className="p-3 text-sm text-slate-500 dark:text-slate-400">No teammates yet.</p>
        ) : others.map(m => (
          <button
            key={m.user_id}
            type="button"
            disabled={busy === m.user_id}
            onClick={() => void pick(m.user_id)}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
          >
            <Avatar src={m.avatar_url ?? null} name={m.full_name} email={m.email} size="xs" />
            <span className="flex-1 min-w-0 truncate text-left">{m.full_name || m.email}</span>
            {busy === m.user_id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
    </Dialog>
  )
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="p-4">{children}</div>
      </div>
    </div>
  )
}
