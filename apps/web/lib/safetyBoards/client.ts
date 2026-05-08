// Client helpers for the safety-boards feature. Mirrors the chat
// client.ts pattern so the UI is consistent.

import { supabase } from '@/lib/supabase'

// ─── Tier 1 types ──────────────────────────────────────────────────────────

export const THREAD_KINDS = [
  'hazard_report', 'near_miss_reflection', 'lesson_learned',
  'alert', 'question', 'discussion',
] as const
export type ThreadKind = typeof THREAD_KINDS[number]

export const KIND_LABEL: Record<ThreadKind, string> = {
  hazard_report:        'Hazard report',
  near_miss_reflection: 'Near-miss reflection',
  lesson_learned:       'Lesson learned',
  alert:                'Safety alert',
  question:             'Question',
  discussion:           'Discussion',
}

export const KIND_DESCRIPTIONS: Record<ThreadKind, string> = {
  hazard_report:        'Report an unsafe condition you observed.',
  near_miss_reflection: 'Reflect on an incident that almost happened.',
  lesson_learned:       'Share a takeaway from an incident or near-miss.',
  alert:                'Notify the team about a safety concern.',
  question:             'Ask the team about a procedure or hazard.',
  discussion:           'Open-ended conversation.',
}

export const ENTITY_LINK_TYPES = [
  'incident', 'near_miss', 'equipment', 'hot_work_permit',
  'confined_space', 'incident_action', 'jha', 'toolbox_talk',
] as const
export type EntityLinkType = typeof ENTITY_LINK_TYPES[number]

export const ENTITY_LINK_LABEL: Record<EntityLinkType, string> = {
  incident:        'Incident',
  near_miss:       'Near-miss',
  equipment:       'Equipment (LOTO)',
  hot_work_permit: 'Hot-work permit',
  confined_space:  'Confined space',
  incident_action: 'Action item',
  jha:             'JHA',
  toolbox_talk:    'Toolbox talk',
}

// Hrefs from a (type, id) pair. Returns null when the type doesn't
// have a known route (template gracefully degrades to no link).
export function entityHref(type: EntityLinkType, id: string): string | null {
  switch (type) {
    case 'incident':         return `/incidents/${id}`
    case 'near_miss':        return `/near-miss/${id}`
    case 'equipment':        return `/equipment/${id}`
    case 'hot_work_permit':  return `/hot-work/${id}`
    case 'confined_space':   return `/confined-spaces/${id}`
    case 'incident_action':  return null  // detail lives inline on incident
    case 'jha':              return `/jha/${id}`
    case 'toolbox_talk':     return `/toolbox-talks/${id}`
  }
}

export interface ThreadAttachment {
  id:           string
  storage_path: string
  mime_type:    string
  size_bytes:   number
  width:        number | null
  height:       number | null
  filename:     string | null
}

export interface SpawnedAction {
  id:             string
  description:    string
  status:         string
  due_at:         string | null
  owner_user_id:  string | null
  incident_id:    string
}

export interface AckSummary {
  mine: { acknowledged_at: string; comment: string | null } | null
  count: number
  acks: Array<{
    user_id: string
    acknowledged_at: string
    comment: string | null
    full_name: string | null
    email: string | null
  }>
}

export interface SafetyBoardSummary {
  id:               string
  name:             string
  slug:             string
  description:      string | null
  archived_at:      string | null
  created_at:       string
  thread_count:     number
  allow_anonymous?: boolean
}

export interface SafetyReaction {
  emoji:    string
  user_ids: string[]
  count:    number
}

export interface SafetyThreadSummary {
  id:                 string
  board_id:           string
  author_user_id:     string | null
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
  kind:               ThreadKind
  metadata:           Record<string, unknown>
  linked_entity_type: EntityLinkType | null
  linked_entity_id:   string | null
  acknowledgement_required: boolean
  is_anonymous:       boolean
}

export interface SafetyThreadDetail {
  id: string
  board_id: string
  author_user_id: string | null
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
  kind: ThreadKind
  metadata: Record<string, unknown>
  linked_entity_type: EntityLinkType | null
  linked_entity_id: string | null
  acknowledgement_required: boolean
  attachments: ThreadAttachment[]
  spawned_actions: SpawnedAction[]
  is_anonymous: boolean
}

export interface SafetyReply {
  id:                 string
  thread_id:          string
  author_user_id:     string | null
  author_email:       string | null
  author_full_name:   string | null
  author_avatar_url:  string | null
  body:               string
  body_mentions:      string[]
  parent_reply_id:    string | null
  edited_at:          string | null
  created_at:         string
  reactions:          SafetyReaction[]
  attachments:        ThreadAttachment[]
  is_anonymous:       boolean
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

export async function createBoard(tenantId: string, p: { name: string; slug?: string; description?: string; allow_anonymous?: boolean }) {
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

export async function createThread(tenantId: string, boardId: string, p: {
  title: string
  body: string
  kind?: ThreadKind
  metadata?: Record<string, unknown>
  linked_entity_type?: EntityLinkType | null
  linked_entity_id?: string | null
  acknowledgement_required?: boolean
  attachment_ids?: string[]
  is_anonymous?: boolean
}) {
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
  p: { body: string; parent_reply_id?: string; attachment_ids?: string[]; is_anonymous?: boolean },
): Promise<SafetyReply> {
  const res = await fetch(`/api/safety-boards/${boardId}/threads/${threadId}/replies`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(p),
  })
  const j = await readJson<{ reply: SafetyReply }>(res)
  return j.reply
}

// ─── Tier 1 fetchers ───────────────────────────────────────────────────────

export async function uploadBoardAttachment(tenantId: string, file: File): Promise<{ id: string; mime_type: string; filename: string | null }> {
  const form = new FormData()
  form.set('file', file)
  const res = await fetch('/api/safety-boards/attachments', {
    method: 'POST',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
    body: form,
  })
  const j = await readJson<{ attachment: { id: string; mime_type: string; filename: string | null } }>(res)
  return j.attachment
}

export async function getBoardAttachmentUrl(tenantId: string, attId: string): Promise<string> {
  const res = await fetch(`/api/safety-boards/attachments/${attId}/url`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ url: string }>(res)
  return j.url
}

export async function fetchAcknowledgements(tenantId: string, threadId: string): Promise<AckSummary> {
  const res = await fetch(`/api/safety-boards/threads/${threadId}/acknowledge`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  return readJson<AckSummary>(res)
}

export async function acknowledgeThread(tenantId: string, threadId: string, comment?: string): Promise<void> {
  const res = await fetch(`/api/safety-boards/threads/${threadId}/acknowledge`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(comment ? { comment } : {}),
  })
  await readJson<unknown>(res)
}

export async function spawnActionFromThread(
  tenantId: string, threadId: string,
  p: {
    action_type: 'corrective' | 'preventive' | 'interim'
    description?: string
    hierarchy_of_controls?: 'elimination' | 'substitution' | 'engineering' | 'administrative' | 'ppe' | null
    owner_user_id?: string | null
    due_at?: string | null
    incident_id?: string
  },
): Promise<{ action: { id: string }; incident_id: string }> {
  const res = await fetch(`/api/safety-boards/threads/${threadId}/spawn-action`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(p),
  })
  return readJson<{ action: { id: string }; incident_id: string }>(res)
}

export async function searchEntities(
  tenantId: string, type: EntityLinkType, q: string,
): Promise<Array<{ id: string; label: string; sub: string }>> {
  const u = new URL('/api/safety-boards/entity-search', window.location.origin)
  u.searchParams.set('type', type)
  u.searchParams.set('q', q)
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ items: Array<{ id: string; label: string; sub: string }> }>(res)
  return j.items
}

// ─── Tier 2 fetchers ───────────────────────────────────────────────────────

export interface SearchHit {
  hit_in: 'thread' | 'reply'
  thread_id: string
  board_id: string
  kind: ThreadKind
  title: string
  snippet: string
  rank: number
  last_reply_at: string
  reply_id: string | null
  is_anonymous: boolean
  author_full_name: string | null
  author_email: string | null
}

export async function searchBoards(
  tenantId: string,
  q: string,
  filter?: { boardId?: string; kind?: ThreadKind },
): Promise<SearchHit[]> {
  if (!q.trim()) return []
  const u = new URL('/api/safety-boards/search', window.location.origin)
  u.searchParams.set('q', q.trim())
  if (filter?.boardId) u.searchParams.set('board_id', filter.boardId)
  if (filter?.kind)    u.searchParams.set('kind', filter.kind)
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ hits: SearchHit[] }>(res)
  return j.hits
}

export async function setBoardAnonymous(tenantId: string, boardId: string, allow: boolean): Promise<void> {
  const res = await fetch(`/api/safety-boards/${boardId}`, {
    method: 'PATCH',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ allow_anonymous: allow }),
  })
  await readJson<unknown>(res)
}

export interface BoardAccessRow {
  id: string
  scope_type: 'role' | 'department'
  scope_value: string
  created_at: string
}

export async function listBoardAccess(tenantId: string, boardId: string): Promise<BoardAccessRow[]> {
  const res = await fetch(`/api/safety-boards/${boardId}/access`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ scopes: BoardAccessRow[] }>(res)
  return j.scopes
}

export async function addBoardAccess(tenantId: string, boardId: string, scope: { scope_type: 'role' | 'department'; scope_value: string }): Promise<void> {
  const res = await fetch(`/api/safety-boards/${boardId}/access`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(scope),
  })
  await readJson<unknown>(res)
}

export async function removeBoardAccess(tenantId: string, boardId: string, rowId: string): Promise<void> {
  const u = new URL(`/api/safety-boards/${boardId}/access`, window.location.origin)
  u.searchParams.set('id', rowId)
  const res = await fetch(u.pathname + u.search, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}

export type SubscriptionState = 'follow' | 'mute'

export async function getSubscription(
  tenantId: string, target_type: 'board' | 'thread', target_id: string,
): Promise<SubscriptionState | null> {
  const u = new URL('/api/safety-boards/subscriptions', window.location.origin)
  u.searchParams.set('type', target_type)
  u.searchParams.set('id', target_id)
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ subscription: { state: SubscriptionState } | null }>(res)
  return j.subscription?.state ?? null
}

export async function setSubscription(
  tenantId: string, target_type: 'board' | 'thread', target_id: string, state: SubscriptionState,
): Promise<void> {
  const res = await fetch('/api/safety-boards/subscriptions', {
    method: 'PUT',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify({ target_type, target_id, state }),
  })
  await readJson<unknown>(res)
}

export async function clearSubscription(
  tenantId: string, target_type: 'board' | 'thread', target_id: string,
): Promise<void> {
  const u = new URL('/api/safety-boards/subscriptions', window.location.origin)
  u.searchParams.set('type', target_type)
  u.searchParams.set('id', target_id)
  const res = await fetch(u.pathname + u.search, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}

export type DigestCadence = 'off' | 'daily' | 'weekly'

export interface DigestPreference {
  tenant_id: string
  cadence: DigestCadence
  last_sent_at: string | null
}

export async function getDigestPreferences(): Promise<DigestPreference[]> {
  const res = await fetch('/api/users/me/digest-preferences', {
    headers: await authHeader(),
  })
  const j = await readJson<{ preferences: DigestPreference[] }>(res)
  return j.preferences
}

export async function setDigestPreference(tenantId: string, cadence: DigestCadence): Promise<void> {
  const res = await fetch('/api/users/me/digest-preferences', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ tenant_id: tenantId, cadence }),
  })
  await readJson<unknown>(res)
}

// ─── Tier 3 fetchers ───────────────────────────────────────────────────────

export interface TemplateFieldDef {
  key:       string
  label?:    string
  type:      'string' | 'enum' | 'number' | 'boolean'
  options?:  string[]    // for enum
  required?: boolean
}

export interface ThreadTemplate {
  id:             string
  name:           string
  description:    string | null
  kind:           ThreadKind
  default_title:  string | null
  default_body:   string | null
  fields_schema:  TemplateFieldDef[]
  sort_order:     number
}

export async function listTemplates(tenantId: string, boardId: string): Promise<ThreadTemplate[]> {
  const res = await fetch(`/api/safety-boards/${boardId}/templates`, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ templates: ThreadTemplate[] }>(res)
  return j.templates
}

export async function createTemplate(tenantId: string, boardId: string, p: {
  name: string
  description?: string
  kind: ThreadKind
  default_title?: string
  default_body?: string
  fields_schema?: TemplateFieldDef[]
  sort_order?: number
}): Promise<ThreadTemplate> {
  const res = await fetch(`/api/safety-boards/${boardId}/templates`, {
    method: 'POST',
    headers: await jsonHeaders(tenantId),
    body: JSON.stringify(p),
  })
  const j = await readJson<{ template: ThreadTemplate }>(res)
  return j.template
}

export async function deleteTemplate(tenantId: string, boardId: string, templateId: string): Promise<void> {
  const u = new URL(`/api/safety-boards/${boardId}/templates`, window.location.origin)
  u.searchParams.set('id', templateId)
  const res = await fetch(u.pathname + u.search, {
    method: 'DELETE',
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  await readJson<unknown>(res)
}

export interface TrendingRow {
  thread_id:           string
  board_id:            string
  kind:                ThreadKind
  title:               string
  pinned:              boolean
  locked:              boolean
  is_anonymous:        boolean
  acknowledgement_required: boolean
  last_reply_at:       string
  created_at:          string
  reply_count_7d:      number
  reaction_count_7d:   number
  score:               number
}

export async function fetchTrending(tenantId: string, limit = 10): Promise<TrendingRow[]> {
  const u = new URL('/api/safety-boards/trending', window.location.origin)
  u.searchParams.set('limit', String(limit))
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ trending: TrendingRow[] }>(res)
  return j.trending
}

export async function listThreadsByEntity(
  tenantId: string, type: EntityLinkType, id: string,
): Promise<Array<{ id: string; board_id: string; kind: ThreadKind; title: string; pinned: boolean; locked: boolean; last_reply_at: string }>> {
  const u = new URL('/api/safety-boards/by-entity', window.location.origin)
  u.searchParams.set('type', type)
  u.searchParams.set('id', id)
  const res = await fetch(u.pathname + u.search, {
    headers: { ...tenantHeader(tenantId), ...(await authHeader()) },
  })
  const j = await readJson<{ threads: Array<{ id: string; board_id: string; kind: ThreadKind; title: string; pinned: boolean; locked: boolean; last_reply_at: string }> }>(res)
  return j.threads
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
