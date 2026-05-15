'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Hash, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { Avatar } from '@/components/ui/Avatar'
import ChannelSidebar from '@/components/chat/ChannelSidebar'
import MessageList from '@/components/chat/MessageList'
import MessageComposer from '@/components/chat/MessageComposer'
import NewChannelDialog, { NewDMDialog } from '@/components/chat/NewChannelDialog'
import { useChannelPolling } from '@/hooks/useChannelPolling'
import {
  listChannels, fetchMessages, postMessage, patchMessage, deleteMessage,
  markRead,
  type ChatChannelSummary, type ChatMessage, type ChatReactionAggregate,
} from '@/lib/chat/client'
import { searchMembers } from '@/lib/members/client'
import type { MentionMember } from '@/components/MentionInput'

// /chat — sidebar (channels + DMs) + active thread view.
//
// State shape:
//   - channels: list returned by /api/chat/channels (with unread counts)
//   - activeId: which channel is currently displayed
//   - messages[activeId]: cached message list
//   - members: tenant roster for the @-autocomplete
//
// Polling cadence: every 4s while the tab is visible. The polling
// hook pauses on visibility change so a backgrounded tab doesn't keep
// hammering the API.

export default function ChatPage() {
  const { userId } = useAuth()
  const { tenant } = useTenant()

  const [channels, setChannels] = useState<ChatChannelSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messagesByChannel, setMessagesByChannel] = useState<Record<string, ChatMessage[]>>({})
  const [members, setMembers]   = useState<MentionMember[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [showNewChannel, setShowNewChannel] = useState(false)
  const [showNewDM, setShowNewDM]           = useState(false)

  // Tenant roster for @-autocomplete + DM-picker. Reuses the
  // RLS-scoped query pattern from the actions page.
  const loadMembers = useCallback(async () => {
    if (!tenant?.id) return
    const roster = await searchMembers(tenant.id, { limit: 250 })
    const next: MentionMember[] = roster
      .filter(m => !!m.user_id)
      .map(m => ({
        user_id:          m.user_id as string,
        member_id:        m.member_id,
        handle:           m.handle,
        email:            m.email,
        full_name:        m.display_name,
        avatar_url:       m.avatar_url,
        position_title:   m.position_title,
        department:       m.department,
        shift_label:      m.shift_label,
        readiness_status: m.readiness_status,
      }))
    setMembers(next)
  }, [tenant])

  const refreshChannels = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const list = await listChannels(tenant.id)
      setChannels(list)
      setActiveId(prev => prev ?? list[0]?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant])

  const refreshMessages = useCallback(async (channelId: string) => {
    if (!tenant?.id) return
    const list = await fetchMessages(tenant.id, channelId, { limit: 50 })
    setMessagesByChannel(prev => ({ ...prev, [channelId]: list }))
  }, [tenant])

  // Initial load.
  useEffect(() => {
    if (!tenant?.id) return
    setLoading(true)
    Promise.all([loadMembers(), refreshChannels()])
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [tenant, loadMembers, refreshChannels])

  // First time we open a channel, fetch its messages.
  useEffect(() => {
    if (!activeId) return
    if (messagesByChannel[activeId]) return
    void refreshMessages(activeId)
  }, [activeId, messagesByChannel, refreshMessages])

  // Mark the channel read when we switch into it (after messages load).
  useEffect(() => {
    if (!activeId || !tenant?.id) return
    const list = messagesByChannel[activeId]
    if (!list || list.length === 0) return
    const lastId = list[list.length - 1].id
    void markRead(tenant.id, activeId, lastId).catch(() => { /* non-fatal */ })
    // Optimistically zero the unread count in the sidebar.
    setChannels(prev => prev.map(c =>
      c.id === activeId ? { ...c, unread_count: 0 } : c,
    ))
  }, [activeId, tenant, messagesByChannel])

  // Live polling while the channel is open.
  useChannelPolling(useCallback(async () => {
    if (!tenant?.id || !activeId) return
    const cur = messagesByChannel[activeId]
    const since = cur && cur.length > 0 ? cur[cur.length - 1].created_at : undefined
    if (!since) {
      // Nothing yet — fetch the recent page.
      const fresh = await fetchMessages(tenant.id, activeId, { limit: 50 })
      setMessagesByChannel(prev => ({ ...prev, [activeId]: fresh }))
      return
    }
    const fresh = await fetchMessages(tenant.id, activeId, { since })
    if (fresh.length > 0) {
      setMessagesByChannel(prev => ({
        ...prev,
        [activeId]: [...(prev[activeId] ?? []), ...fresh],
      }))
      // Bump read pointer so unread doesn't accrue on a focused channel.
      void markRead(tenant.id, activeId, fresh[fresh.length - 1].id).catch(() => {})
    }
    // Refresh sidebar unread counts every poll so OTHER channels stay
    // accurate while the user is focused on one.
    void refreshChannels()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, activeId, messagesByChannel]), { intervalMs: 4000, enabled: !!activeId })

  const activeChannel = useMemo(
    () => channels.find(c => c.id === activeId) ?? null,
    [channels, activeId],
  )
  const messages = activeId ? (messagesByChannel[activeId] ?? []) : []

  async function send(body: string, attachmentIds: string[]) {
    if (!tenant?.id || !activeId) return
    const msg = await postMessage(tenant.id, activeId, {
      body,
      attachment_ids: attachmentIds.length > 0 ? attachmentIds : undefined,
    })
    setMessagesByChannel(prev => ({
      ...prev,
      [activeId]: [...(prev[activeId] ?? []), msg],
    }))
    void markRead(tenant.id, activeId, msg.id).catch(() => {})
    void refreshChannels()
  }

  async function onEdit(msgId: string, body: string) {
    if (!tenant?.id || !activeId) return
    await patchMessage(tenant.id, activeId, msgId, body)
    setMessagesByChannel(prev => {
      const list = prev[activeId] ?? []
      return {
        ...prev,
        [activeId]: list.map(m => m.id === msgId
          ? { ...m, body, edited_at: new Date().toISOString() }
          : m),
      }
    })
  }
  async function onDelete(msgId: string) {
    if (!tenant?.id || !activeId) return
    if (!confirm('Delete this message?')) return
    await deleteMessage(tenant.id, activeId, msgId)
    setMessagesByChannel(prev => {
      const list = prev[activeId] ?? []
      return { ...prev, [activeId]: list.filter(m => m.id !== msgId) }
    })
  }
  function onReactionsChange(msgId: string, next: ChatReactionAggregate[]) {
    setMessagesByChannel(prev => {
      if (!activeId) return prev
      const list = prev[activeId] ?? []
      return {
        ...prev,
        [activeId]: list.map(m => m.id === msgId ? { ...m, reactions: next } : m),
      }
    })
  }

  if (loading && channels.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 bg-white dark:bg-slate-900">
      <ChannelSidebar
        channels={channels}
        activeId={activeId}
        onSelect={setActiveId}
        onNewChannel={() => setShowNewChannel(true)}
        onNewDM={() => setShowNewDM(true)}
      />

      <main className="flex-1 min-w-0 flex flex-col">
        <ChannelHeader channel={activeChannel} />
        {error && (
          <p className="px-3 py-2 text-xs bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">{error}</p>
        )}
        {activeId ? (
          <>
            <MessageList
              messages={messages}
              members={members}
              onEdit={onEdit}
              onDelete={onDelete}
              onReactionsChange={onReactionsChange}
            />
            <MessageComposer
              channelId={activeId}
              members={members}
              onSent={send}
              placeholder={
                activeChannel?.kind === 'dm'
                  ? `Message ${activeChannel.dm_peer?.full_name || activeChannel.dm_peer?.email || 'teammate'}…`
                  : `Message #${activeChannel?.name ?? 'channel'}…`
              }
            />
          </>
        ) : (
          <div className="flex-1 min-h-0 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            {channels.length === 0
              ? 'No channels yet. Create one or start a DM from the sidebar.'
              : 'Pick a channel to start.'}
          </div>
        )}
      </main>

      {showNewChannel && (
        <NewChannelDialog
          members={members}
          onClose={() => setShowNewChannel(false)}
          onCreated={async id => {
            setShowNewChannel(false)
            await refreshChannels()
            setActiveId(id)
          }}
        />
      )}
      {showNewDM && (
        <NewDMDialog
          members={members}
          currentUserId={userId}
          onClose={() => setShowNewDM(false)}
          onCreated={async id => {
            setShowNewDM(false)
            await refreshChannels()
            setActiveId(id)
          }}
        />
      )}
    </div>
  )
}

function ChannelHeader({ channel }: { channel: ChatChannelSummary | null }) {
  if (!channel) {
    return <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">Chat</header>
  }
  if (channel.kind === 'dm') {
    const peer = channel.dm_peer
    const display = peer?.full_name || peer?.email || 'Direct message'
    return (
      <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
        <Avatar src={peer?.avatar_url ?? null} name={peer?.full_name ?? null} email={peer?.email ?? null} size="sm" />
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{display}</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Direct message · private to you both</p>
        </div>
      </header>
    )
  }
  return (
    <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800">
      <div className="flex items-center gap-1.5">
        <Hash className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{channel.name}</h2>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">· {channel.member_count} members</span>
      </div>
      {channel.description && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{channel.description}</p>
      )}
    </header>
  )
}
