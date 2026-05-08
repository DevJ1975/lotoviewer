'use client'

import { Hash, MessageSquare, Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import type { ChatChannelSummary } from '@/lib/chat/client'

interface Props {
  channels:    ChatChannelSummary[]
  activeId:    string | null
  onSelect:    (id: string) => void
  onNewChannel: () => void
  onNewDM:     () => void
}

export default function ChannelSidebar({ channels, activeId, onSelect, onNewChannel, onNewDM }: Props) {
  const groups = channels.filter(c => c.kind === 'channel')
  const dms    = channels.filter(c => c.kind === 'dm')

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col">
      <header className="p-3 border-b border-slate-200 dark:border-slate-800">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Chat</h2>
      </header>
      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        <Section
          title="Channels"
          actionLabel="New channel"
          onAction={onNewChannel}
        >
          {groups.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-400 italic">No channels yet.</p>
          ) : groups.map(c => (
            <ChannelRow key={c.id} channel={c} active={c.id === activeId} onSelect={() => onSelect(c.id)} />
          ))}
        </Section>
        <Section
          title="Direct messages"
          actionLabel="New DM"
          onAction={onNewDM}
        >
          {dms.length === 0 ? (
            <p className="px-2 py-1 text-xs text-slate-400 italic">No DMs yet.</p>
          ) : dms.map(c => (
            <DMRow key={c.id} channel={c} active={c.id === activeId} onSelect={() => onSelect(c.id)} />
          ))}
        </Section>
      </div>
    </aside>
  )
}

function Section({ title, actionLabel, onAction, children }: {
  title: string; actionLabel: string; onAction: () => void; children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-2 mb-1">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</h3>
        <button
          type="button"
          onClick={onAction}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          title={actionLabel}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  )
}

function activeClass(active: boolean): string {
  return active
    ? 'bg-brand-navy/10 dark:bg-brand-yellow/10 text-brand-navy dark:text-brand-yellow font-semibold'
    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
}

function unreadPill(n: number) {
  if (n <= 0) return null
  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold px-1.5">
      {n > 99 ? '99+' : n}
    </span>
  )
}

function ChannelRow({ channel, active, onSelect }: { channel: ChatChannelSummary; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={'w-full flex items-center gap-2 rounded-lg px-2 py-1 text-sm ' + activeClass(active)}
      >
        <Hash className="h-4 w-4 text-slate-400 shrink-0" />
        <span className="truncate">{channel.name}</span>
        {unreadPill(channel.unread_count)}
      </button>
    </li>
  )
}

function DMRow({ channel, active, onSelect }: { channel: ChatChannelSummary; active: boolean; onSelect: () => void }) {
  const peer = channel.dm_peer
  const display = peer?.full_name || peer?.email || 'Direct message'
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={'w-full flex items-center gap-2 rounded-lg px-2 py-1 text-sm ' + activeClass(active)}
      >
        {peer ? (
          <Avatar src={peer.avatar_url} name={peer.full_name} email={peer.email} size="xs" />
        ) : (
          <MessageSquare className="h-4 w-4 text-slate-400" />
        )}
        <span className="truncate">{display}</span>
        {unreadPill(channel.unread_count)}
      </button>
    </li>
  )
}
