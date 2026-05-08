// Shared types + fetch helpers for the chat UI. Centralized so the
// sidebar, thread view, composer, and polling hook all agree on what
// a "channel" or "message" looks like.

import { supabase } from '@/lib/supabase'

export interface ChatChannelSummary {
  id:               string
  kind:             'channel' | 'dm'
  name:             string | null
  slug:             string | null
  description:      string | null
  created_at:       string
  last_activity_at: string
  member_count:     number
  my_role:          'member' | 'admin'
  muted:            boolean
  unread_count:     number
  dm_peer:          {
    user_id:    string
    email:      string | null
    full_name:  string | null
    avatar_url: string | null
  } | null
}

export interface ChatAttachment {
  id:           string
  storage_path: string
  mime_type:    string
  size_bytes:   number
  width:        number | null
  height:       number | null
  filename:     string | null
}

export interface ChatReactionAggregate {
  emoji:    string
  user_ids: string[]
  count:    number
}

export interface ChatMessage {
  id:                 string
  channel_id:         string
  author_user_id:     string
  author_email:       string | null
  author_full_name:   string | null
  author_avatar_url:  string | null
  body:               string
  body_mentions:      string[]
  parent_message_id:  string | null
  edited_at:          string | null
  created_at:         string
  attachments:        ChatAttachment[]
  reactions:          ChatReactionAggregate[]
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` }
    : {}
}

function tenantHeader(tenantId: string): Record<string, string> {
  return { 'x-active-tenant': tenantId }
}

async function jsonHeaders(tenantId: string): Promise<Record<string, string>> {
  return {
    'content-type': 'application/json',
    ...tenantHeader(tenantId),
    ...(await authHeader()),
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (json as { error?: string }).error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return json as T
}

export async function listChannels(tenantId: string): Promise<ChatChannelSummary[]> {
  const res = await fetch('/api/chat/channels', {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ channels: ChatChannelSummary[] }>(res)
  return j.channels
}

export async function createChannel(tenantId: string, payload: {
  name: string; slug?: string; description?: string; member_user_ids?: string[]
}): Promise<{ id: string }> {
  const res = await fetch('/api/chat/channels', {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ kind: 'channel', ...payload }),
  })
  const j = await readJson<{ channel: { id: string } }>(res)
  return j.channel
}

export async function findOrCreateDM(tenantId: string, peerUserId: string): Promise<{ id: string }> {
  const res = await fetch('/api/chat/dms', {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ peer_user_id: peerUserId }),
  })
  const j = await readJson<{ channel: { id: string } }>(res)
  return j.channel
}

export async function fetchMessages(
  tenantId: string,
  channelId: string,
  opts?: { since?: string; limit?: number },
): Promise<ChatMessage[]> {
  const u = new URL(`/api/chat/channels/${channelId}/messages`, window.location.origin)
  if (opts?.since) u.searchParams.set('since', opts.since)
  if (opts?.limit) u.searchParams.set('limit', String(opts.limit))
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ messages: ChatMessage[] }>(res)
  return j.messages
}

export async function postMessage(
  tenantId: string,
  channelId: string,
  body: { body: string; parent_message_id?: string; attachment_ids?: string[] },
): Promise<ChatMessage> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(body),
  })
  const j = await readJson<{ message: ChatMessage }>(res)
  return j.message
}

export async function patchMessage(
  tenantId: string, channelId: string, msgId: string, body: string,
): Promise<void> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages/${msgId}`, {
    method: 'PATCH',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ body }),
  })
  await readJson<unknown>(res)
}

export async function deleteMessage(
  tenantId: string, channelId: string, msgId: string,
): Promise<void> {
  const res = await fetch(`/api/chat/channels/${channelId}/messages/${msgId}`, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}

export async function markRead(
  tenantId: string, channelId: string, lastReadId: string | null,
): Promise<void> {
  const res = await fetch(`/api/chat/channels/${channelId}/read`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(lastReadId ? { last_read_message_id: lastReadId } : {}),
  })
  await readJson<unknown>(res)
}

export async function addReaction(
  tenantId: string, msgId: string, emoji: string,
): Promise<void> {
  const res = await fetch(`/api/chat/messages/${msgId}/reactions`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ emoji }),
  })
  await readJson<unknown>(res)
}

export async function removeReaction(
  tenantId: string, msgId: string, emoji: string,
): Promise<void> {
  const url = `/api/chat/messages/${msgId}/reactions?emoji=${encodeURIComponent(emoji)}`
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}

export async function uploadAttachment(
  tenantId: string, channelId: string, file: File,
): Promise<{ id: string; mime_type: string; filename: string | null }> {
  const form = new FormData()
  form.set('file', file)
  const res = await fetch(`/api/chat/channels/${channelId}/attachments`, {
    method: 'POST',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
    body: form,
  })
  const j = await readJson<{ attachment: { id: string; mime_type: string; filename: string | null } }>(res)
  return j.attachment
}

export async function getAttachmentUrl(tenantId: string, attId: string): Promise<string> {
  const res = await fetch(`/api/chat/attachments/${attId}/url`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ url: string }>(res)
  return j.url
}

export async function fetchUnreadTotal(tenantId: string): Promise<number> {
  const res = await fetch('/api/chat/unread', {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ unread: number }>(res)
  return j.unread
}
