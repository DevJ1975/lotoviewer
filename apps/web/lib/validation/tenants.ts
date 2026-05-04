// Single source of truth for tenant + membership validation.
// Used by every /api/superadmin/* route AND by client-side forms that
// want to fail fast before submitting. Keep in sync with the CHECK
// constraints in migration 027 (tenants.slug, tenants.tenant_number,
// tenant_memberships.role, tenants.status).

import type { TenantRole, TenantStatus } from '@/lib/types'

// 4-digit zero-padded number — matches the tenants.tenant_number CHECK.
// Validates URL params (the [number] route segment).
export const TENANT_NUMBER_RE = /^[0-9]{4}$/

// URL-safe slug — matches the tenants.slug CHECK. 3-64 chars, lowercase
// letters/digits/hyphens, no leading/trailing hyphens.
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/

// Permissive email regex sufficient for "has the user typed something
// shaped like an address." Real validation happens at Supabase auth.
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export const VALID_ROLES: ReadonlySet<TenantRole> =
  new Set<TenantRole>(['owner', 'admin', 'member', 'viewer'])

export const VALID_STATUSES: ReadonlySet<TenantStatus> =
  new Set<TenantStatus>(['active', 'trial', 'disabled', 'archived'])

// Convenience predicates so callers don't import the regex AND test it.
// Read at the call site as `isValidTenantNumber(number)` rather than
// `TENANT_NUMBER_RE.test(number)`.
export const isValidTenantNumber = (n: string): boolean => TENANT_NUMBER_RE.test(n)
export const isValidSlug         = (s: string): boolean => SLUG_RE.test(s)
export const isValidEmail        = (e: string): boolean => EMAIL_RE.test(e)
export const isValidRole         = (r: unknown): r is TenantRole =>
  typeof r === 'string' && VALID_ROLES.has(r as TenantRole)
export const isValidStatus       = (s: unknown): s is TenantStatus =>
  typeof s === 'string' && VALID_STATUSES.has(s as TenantStatus)

// Validate + normalize a tenant name. Returns null when invalid.
export function normalizeName(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (trimmed.length < 1 || trimmed.length > 200) return null
  return trimmed
}

// Validate + normalize an email (lowercase, trimmed). Returns null when invalid.
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const lower = input.trim().toLowerCase()
  if (!isValidEmail(lower)) return null
  return lower
}
