import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type LibraryScope = 'global' | 'tenant'
type ModuleStatus = 'draft' | 'in_review' | 'published' | 'archived' | 'superseded'
type RequestStatus = 'requested' | 'scoping' | 'scheduled' | 'filming' | 'editing' | 'review' | 'delivered' | 'cancelled'

export interface StrikeStudioTenantRow {
  id: string
  tenant_number: string
  name: string
  slug: string | null
  status: string | null
}

export interface StrikeStudioModuleRow {
  id: string
  tenant_id: string | null
  tenant_number: string | null
  tenant_name: string | null
  library_scope: LibraryScope
  title: string
  slug: string
  description: string | null
  category: string | null
  tags: string[]
  estimated_minutes: number | null
  status: ModuleStatus
  published_at: string | null
  updated_at: string
  versions_count: number
  latest_version: {
    id: string
    version_number: number
    status: ModuleStatus
    published_at: string | null
    duration_seconds: number | null
    passing_score: number
  } | null
}

export interface StrikeStudioRequestRow {
  id: string
  tenant_id: string
  tenant_number: string | null
  tenant_name: string | null
  title: string
  request_type: string
  priority: string
  status: RequestStatus
  task_description: string | null
  site_location: string | null
  target_audience: string | null
  desired_due_date: string | null
  created_at: string
  updated_at: string
}

export interface StrikeStudioResponse {
  tenants: StrikeStudioTenantRow[]
  modules: StrikeStudioModuleRow[]
  requests: StrikeStudioRequestRow[]
}

interface ModuleRow {
  id: string
  tenant_id: string | null
  library_scope: LibraryScope
  title: string
  slug: string
  description: string | null
  category: string | null
  tags: string[] | null
  estimated_minutes: number | null
  status: ModuleStatus
  published_at: string | null
  updated_at: string
}

interface VersionRow {
  id: string
  module_id: string
  version_number: number
  status: ModuleStatus
  published_at: string | null
  duration_seconds: number | null
  passing_score: number
}

interface RequestRow {
  id: string
  tenant_id: string
  title: string
  request_type: string
  priority: string
  status: RequestStatus
  task_description: string | null
  site_location: string | null
  target_audience: string | null
  desired_due_date: string | null
  created_at: string
  updated_at: string
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const [tenantsResult, modulesResult, versionsResult, requestsResult] = await Promise.all([
    admin
      .from('tenants')
      .select('id, tenant_number, name, slug, status')
      .order('tenant_number', { ascending: true }),
    admin
      .from('strike_modules')
      .select('id, tenant_id, library_scope, title, slug, description, category, tags, estimated_minutes, status, published_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(300),
    admin
      .from('strike_module_versions')
      .select('id, module_id, version_number, status, published_at, duration_seconds, passing_score')
      .order('version_number', { ascending: false }),
    admin
      .from('strike_studio_requests')
      .select('id, tenant_id, title, request_type, priority, status, task_description, site_location, target_audience, desired_due_date, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(100),
  ])

  const firstError = tenantsResult.error ?? modulesResult.error ?? versionsResult.error ?? requestsResult.error
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 })

  const tenants = (tenantsResult.data ?? []) as StrikeStudioTenantRow[]
  const tenantById = new Map(tenants.map(t => [t.id, t]))
  const versionsByModule = new Map<string, VersionRow[]>()
  for (const version of (versionsResult.data ?? []) as VersionRow[]) {
    const bucket = versionsByModule.get(version.module_id) ?? []
    bucket.push(version)
    versionsByModule.set(version.module_id, bucket)
  }

  const modules = ((modulesResult.data ?? []) as ModuleRow[]).map(module => {
    const tenant = module.tenant_id ? tenantById.get(module.tenant_id) : null
    const versions = versionsByModule.get(module.id) ?? []
    const latest = versions[0] ?? null
    return {
      ...module,
      tags: module.tags ?? [],
      tenant_number: tenant?.tenant_number ?? null,
      tenant_name: tenant?.name ?? null,
      versions_count: versions.length,
      latest_version: latest ? {
        id: latest.id,
        version_number: latest.version_number,
        status: latest.status,
        published_at: latest.published_at,
        duration_seconds: latest.duration_seconds,
        passing_score: latest.passing_score,
      } : null,
    } satisfies StrikeStudioModuleRow
  })

  const requests = ((requestsResult.data ?? []) as RequestRow[]).map(request => {
    const tenant = tenantById.get(request.tenant_id)
    return {
      ...request,
      tenant_number: tenant?.tenant_number ?? null,
      tenant_name: tenant?.name ?? null,
    } satisfies StrikeStudioRequestRow
  })

  return NextResponse.json({ tenants, modules, requests } satisfies StrikeStudioResponse)
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: {
    title?: unknown
    slug?: unknown
    library_scope?: unknown
    tenant_id?: unknown
    description?: unknown
    category?: unknown
    tags?: unknown
    estimated_minutes?: unknown
    transcript?: unknown
    video_path?: unknown
    passing_score?: unknown
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || title.length > 160) {
    return NextResponse.json({ error: 'Title is required and must be 160 characters or less' }, { status: 400 })
  }

  const libraryScope = body.library_scope === 'tenant' ? 'tenant' : 'global'
  const tenantId = typeof body.tenant_id === 'string' && body.tenant_id.trim() ? body.tenant_id.trim() : null
  if (libraryScope === 'tenant' && !tenantId) {
    return NextResponse.json({ error: 'Pick a tenant for tenant-scoped STRIKE modules' }, { status: 400 })
  }

  const slug = normalizeSlug(typeof body.slug === 'string' && body.slug.trim() ? body.slug : title)
  if (!slug) {
    return NextResponse.json({ error: 'Slug must contain letters or numbers' }, { status: 400 })
  }

  const estimatedMinutes = normalizeOptionalNumber(body.estimated_minutes)
  if (estimatedMinutes !== null && (estimatedMinutes < 1 || estimatedMinutes > 60)) {
    return NextResponse.json({ error: 'Estimated minutes must be between 1 and 60' }, { status: 400 })
  }

  const passingScore = normalizeOptionalNumber(body.passing_score) ?? 80
  if (passingScore < 0 || passingScore > 100) {
    return NextResponse.json({ error: 'Passing score must be between 0 and 100' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  if (libraryScope === 'tenant') {
    const { data: tenant, error } = await admin
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const { data: module, error: moduleError } = await admin
    .from('strike_modules')
    .insert({
      tenant_id: libraryScope === 'tenant' ? tenantId : null,
      library_scope: libraryScope,
      title,
      slug,
      description: normalizeOptionalString(body.description),
      category: normalizeOptionalString(body.category),
      tags: normalizeTags(body.tags),
      estimated_minutes: estimatedMinutes,
      status: 'draft',
      created_by: gate.userId,
      updated_by: gate.userId,
    })
    .select('id, tenant_id, library_scope, title, slug, description, category, tags, estimated_minutes, status, published_at, updated_at')
    .single()

  if (moduleError) {
    const code = (moduleError as { code?: string }).code
    if (code === '23505') {
      return NextResponse.json({ error: 'A STRIKE module with that slug already exists for this scope' }, { status: 409 })
    }
    return NextResponse.json({ error: moduleError.message }, { status: 500 })
  }

  const { error: versionError } = await admin
    .from('strike_module_versions')
    .insert({
      module_id: module.id,
      tenant_id: libraryScope === 'tenant' ? tenantId : null,
      library_scope: libraryScope,
      version_number: 1,
      status: 'draft',
      video_path: normalizeOptionalString(body.video_path),
      transcript: normalizeOptionalString(body.transcript),
      passing_score: passingScore,
      created_by: gate.userId,
    })

  if (versionError) {
    return NextResponse.json({ error: versionError.message }, { status: 500 })
  }

  return NextResponse.json({ module }, { status: 201 })
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.round(n) : null
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => tag.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12)
  }
  if (typeof value !== 'string') return []
  return value
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12)
}
