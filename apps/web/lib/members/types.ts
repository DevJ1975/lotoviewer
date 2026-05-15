export type MemberStatus = 'active' | 'suspended' | 'terminated' | 'archived'
export type MemberReadinessStatus = 'ready' | 'attention' | 'restricted' | 'setup_needed' | 'inactive'
export type EmploymentType = 'employee' | 'contractor' | 'temp' | 'vendor' | 'visitor' | 'other'

export interface MemberSummary {
  member_id: string
  tenant_id: string
  profile_id: string | null
  user_id: string | null
  handle: string
  member_code: string
  display_name: string
  display_name_source: 'system' | 'self' | 'admin'
  legal_name: string | null
  preferred_name: string | null
  pronouns: string | null
  email: string | null
  phone: string | null
  employee_id: string | null
  badge_id: string | null
  employment_type: EmploymentType
  vendor_company: string | null
  department: string | null
  site_label: string | null
  position_title: string | null
  shift_label: string | null
  supervisor_member_id: string | null
  supervisor_name: string | null
  language: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  notification_preferences: Record<string, unknown> | null
  readiness_status: MemberReadinessStatus
  status: MemberStatus
  avatar_url: string | null
  tenant_role: 'owner' | 'admin' | 'member' | 'viewer' | null
  is_admin: boolean | null
  is_superadmin: boolean | null
  created_at: string
  updated_at: string
}

export interface MemberSearchResult extends MemberSummary {
  mention_label: string
  mention_subtitle: string
}

export interface MemberProfilePatch {
  preferred_name?: string | null
  pronouns?: string | null
  phone?: string | null
  language?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  notification_preferences?: Record<string, unknown>
}

export const SELF_EDITABLE_MEMBER_FIELDS = [
  'preferred_name',
  'pronouns',
  'phone',
  'language',
  'emergency_contact_name',
  'emergency_contact_phone',
  'notification_preferences',
] as const

export function normalizeMemberQuery(input: string): string {
  return input.trim().replace(/^#/, '').toLowerCase()
}
