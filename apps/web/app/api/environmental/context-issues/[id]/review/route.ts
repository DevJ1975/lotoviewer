import { reviewRouteFor } from '@/lib/environmental/registerApi'

// POST /api/environmental/context-issues/[id]/review   Confirm the issue still holds. Admins only.

export const POST = reviewRouteFor('ms_context_issues')
