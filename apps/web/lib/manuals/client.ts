// Client helpers for the manuals wiki. Same shape as the safety-board
// client lib — no x-active-tenant header (manuals are platform-wide),
// just the bearer token.

import { supabase } from '@/lib/supabase'

export interface ManualSummary {
  id:           string
  module_id:    string
  title:        string
  summary:      string | null
  version:      number
  published_at: string | null
  updated_at:   string
  updated_by:   string | null
}

export interface ManualToc {
  level: 2 | 3 | 4
  text:  string
  slug:  string
}

export interface ManualDetail {
  id:           string
  module_id:    string
  title:        string
  summary:      string | null
  body_md:      string
  version:      number
  published_at: string | null
  created_at:   string
  updated_at:   string
  created_by:   string | null
  updated_by:   string | null
  editor:       { full_name: string | null; email: string | null } | null
  toc:          ManualToc[]
}

export interface ManualVersionMeta {
  id:               string
  version:          number
  title:            string
  summary:          string | null
  change_note:      string | null
  created_at:       string
  created_by:       string | null
  author_full_name: string | null
  author_email:     string | null
}

export interface ManualVersionDetail {
  id:           string
  version:      number
  title:        string
  summary:      string | null
  body_md:      string
  change_note:  string | null
  created_at:   string
  created_by:   string | null
}

export interface ChangelogEntry {
  id:               string
  version:          number
  manual_id:        string
  module_id:        string | null
  module_title:     string | null
  version_title:    string
  change_note:      string | null
  created_at:       string
  author_full_name: string | null
  author_email:     string | null
}

export interface SearchHit {
  manual_id:  string
  module_id:  string
  title:      string
  summary:    string | null
  snippet:    string
  version:    number
  updated_at: string
  is_draft:   boolean
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

async function jsonHeaders(): Promise<Record<string, string>> {
  return { 'content-type': 'application/json', ...(await authHeader()) }
}

async function readJson<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (j as { error?: string }).error ?? `HTTP ${res.status}`
    throw new Error(msg)
  }
  return j as T
}

export async function listManuals(): Promise<ManualSummary[]> {
  const res = await fetch('/api/manuals', { headers: await authHeader() })
  const j = await readJson<{ manuals: ManualSummary[] }>(res)
  return j.manuals
}

export async function getManual(moduleId: string): Promise<ManualDetail> {
  const res = await fetch(`/api/manuals/${moduleId}`, { headers: await authHeader() })
  const j = await readJson<{ manual: ManualDetail }>(res)
  return j.manual
}

export async function listVersions(moduleId: string): Promise<ManualVersionMeta[]> {
  const res = await fetch(`/api/manuals/${moduleId}/versions`, { headers: await authHeader() })
  const j = await readJson<{ versions: ManualVersionMeta[] }>(res)
  return j.versions
}

export async function getVersion(moduleId: string, versionId: string): Promise<ManualVersionDetail> {
  const res = await fetch(`/api/manuals/${moduleId}/versions/${versionId}`, { headers: await authHeader() })
  const j = await readJson<{ version: ManualVersionDetail }>(res)
  return j.version
}

export async function listChangelog(opts: { moduleId?: string; limit?: number } = {}): Promise<ChangelogEntry[]> {
  const u = new URL('/api/manuals/changelog', window.location.origin)
  if (opts.moduleId) u.searchParams.set('module_id', opts.moduleId)
  if (opts.limit)    u.searchParams.set('limit', String(opts.limit))
  const res = await fetch(u.pathname + u.search, { headers: await authHeader() })
  const j = await readJson<{ entries: ChangelogEntry[] }>(res)
  return j.entries
}

export async function searchManuals(q: string): Promise<SearchHit[]> {
  if (!q.trim()) return []
  const u = new URL('/api/manuals/search', window.location.origin)
  u.searchParams.set('q', q.trim())
  const res = await fetch(u.pathname + u.search, { headers: await authHeader() })
  const j = await readJson<{ hits: SearchHit[] }>(res)
  return j.hits
}

// ─── Superadmin write paths ───────────────────────────────────────────────

export async function patchManual(
  moduleId: string,
  patch: {
    title?:       string
    summary?:     string | null
    body_md?:     string
    publish?:     boolean
    unpublish?:   boolean
    change_note?: string
  },
): Promise<ManualDetail> {
  const res = await fetch(`/api/superadmin/manuals/${moduleId}`, {
    method:  'PATCH',
    headers: await jsonHeaders(),
    body:    JSON.stringify(patch),
  })
  const j = await readJson<{ manual: ManualDetail }>(res)
  return j.manual
}

export async function uploadManualImage(file: File, moduleId?: string): Promise<{ url: string }> {
  const form = new FormData()
  form.set('file', file)
  if (moduleId) form.set('module_id', moduleId)
  const res = await fetch('/api/superadmin/manuals/upload', {
    method:  'POST',
    headers: await authHeader(),
    body:    form,
  })
  const j = await readJson<{ url: string }>(res)
  return j
}

export async function bootstrapManuals(): Promise<{ created: string[]; existing: number }> {
  const res = await fetch('/api/superadmin/manuals/bootstrap', {
    method:  'POST',
    headers: await jsonHeaders(),
  })
  return readJson<{ created: string[]; existing: number }>(res)
}
