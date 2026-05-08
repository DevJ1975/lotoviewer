// Client helpers for the safety-boards feature. Mirrors the chat
// client.ts pattern so the UI is consistent.

import { supabase } from '@/lib/supabase'

export interface SafetyBoardSummary {
  id:           string
  name:         string
  slug:         string
  description:  string | null
  archived_at:  string | null
  created_at:   string
  thread_count: number
}

export interface SafetyReaction {
  emoji:    string
  user_ids: string[]
  count:    number
}

export interface SafetyThreadSummary {
  id:                 string
  board_id:           string
  author_user_id:     string
  author_email:       string | null
  author_full_name:   string | null
  author_avatar_url:  string | null
  title:              string
  body:               string
  body_mentions:      string[]
  pinned:             boolean
  locked:             boolean
  edited_at:          string | null
  created_at:         string
  last_reply_at:      string
  reply_count:        number
}

export interface SafetyThreadDetail {
  id: string
  board_id: string
  author_user_id: string
  author_email: string | null
  author_full_name: string | null
  author_avatar_url: string | null
  title: string
  body: string
  body_mentions: string[]
  pinned: boolean
  locked: boolean
  edited_at: string | null
  created_at: string
  last_reply_at: string
  reactions: SafetyReaction[]
}

export interface SafetyReply {
  id:                 string
  thread_id:          string
  author_user_id:     string
  author_email:       string | null
  author_full_name:   string | null
  author_avatar_url:  string | null
  body:               string
  body_mentions:      string[]
  parent_reply_id:    string | null
  edited_at:          string | null
  created_at:         string
  reactions:          SafetyReaction[]
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}
function tenantHeader(t: string): Record<string, string> { return { 'x-active-tenant': t } }
async function jsonHeaders(t: string): Promise<Record<string, string>> {
  return { 'content-type': 'application/json', ...tenantHeader(t), ...(await authHeader()) }
}
async function readJson<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (j as { error?: string }).error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return j as T
}

export async function listBoards(tenantId: string): Promise<SafetyBoardSummary[]> {
  const res = await fetch('/api/safety-boards', { headers: { ...tenantHeader(tenantId), ...(await authHeader()) } })
  const j = await readJson<{ boards: SafetyBoardSummary[] }>(res)
  return j.boards
}

export async function createBoard(tenantId: string, p: { name: string; slug?: string; description?: string }) {
  const res = await fetch('/api/safety-boards', {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(p),
  })
  const j = await readJson<{ board: SafetyBoardSummary }>(res)
  return j.board
}

export async function listThreads(tenantId: string, boardId: string): Promise<SafetyThreadSummary[]> {
  const res = await fetch(`/api/safety-boards/${boardId}/threads`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ threads: SafetyThreadSummary[] }>(res)
  return j.threads
}

export async function createThread(tenantId: string, boardId: string, p: { title: string; body: string }) {
  const res = await fetch(`/api/safety-boards/${boardId}/threads`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(p),
  })
  const j = await readJson<{ thread: { id: string } }>(res)
  return j.thread
}

export async function getThread(tenantId: string, boardId: string, threadId: string): Promise<SafetyThreadDetail> {
  const res = await fetch(`/api/safety-boards/${boardId}/threads/${threadId}`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ thread: SafetyThreadDetail }>(res)
  return j.thread
}

export async function patchThread(
  tenantId: string, boardId: string, threadId: string,
  patch: Partial<{ title: string; body: string; pinned: boolean; locked: boolean }>,
) {
  const res = await fetch(`/api/safety-boards/${boardId}/threads/${threadId}`, {
    method: 'PATCH',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(patch),
  })
  await readJson<unknown>(res)
}

export async function deleteThread(tenantId: string, boardId: string, threadId: string) {
  const res = await fetch(`/api/safety-boards/${boardId}/threads/${threadId}`, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}

export async function listReplies(tenantId: string, boardId: string, threadId: string): Promise<SafetyReply[]> {
  const res = await fetch(`/api/safety-boards/${boardId}/threads/${threadId}/replies`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ replies: SafetyReply[] }>(res)
  return j.replies
}

export async function createReply(
  tenantId: string, boardId: string, threadId: string,
  p: { body: string; parent_reply_id?: string },
): Promise<SafetyReply> {
  const res = await fetch(`/api/safety-boards/${boardId}/threads/${threadId}/replies`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(p),
  })
  const j = await readJson<{ reply: SafetyReply }>(res)
  return j.reply
}

export async function patchReply(tenantId: string, replyId: string, body: string) {
  const res = await fetch(`/api/safety-boards/replies/${replyId}`, {
    method: 'PATCH',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ body }),
  })
  await readJson<unknown>(res)
}

export async function deleteReply(tenantId: string, replyId: string) {
  const res = await fetch(`/api/safety-boards/replies/${replyId}`, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}

export async function addBoardReaction(
  tenantId: string, target_type: 'thread' | 'reply', target_id: string, emoji: string,
) {
  const res = await fetch('/api/safety-boards/reactions', {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ target_type, target_id, emoji }),
  })
  await readJson<unknown>(res)
}

export async function removeBoardReaction(
  tenantId: string, target_type: 'thread' | 'reply', target_id: string, emoji: string,
) {
  const u = new URL('/api/safety-boards/reactions', window.location.origin)
  u.searchParams.set('target_type', target_type)
  u.searchParams.set('target_id',   target_id)
  u.searchParams.set('emoji',       emoji)
  const res = await fetch(u.pathname + u.search, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}
