// Shared types + constants for the /superadmin/tenants/[number]
// sub-components. Kept in a separate file so the components don't have
// to cross-import each other to share a row shape.

import type { TenantRole } from '@soteria/core/types'

export interface MemberRow {
  user_id:              string
  role:                 TenantRole
  joined_at:            string
  email:                string | null
  full_name:            string | null
  must_change_password: boolean
  last_sign_in_at:      string | null
  status:               'invited' | 'active'
}

export const ROLE_OPTIONS: TenantRole[] = ['owner', 'admin', 'member', 'viewer']
