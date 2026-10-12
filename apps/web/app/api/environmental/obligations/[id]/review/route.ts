import { reviewRouteFor } from '@/lib/environmental/registerApi'

// POST /api/environmental/obligations/[id]/review   Confirm the obligation still applies as recorded. Admins only.

export const POST = reviewRouteFor('compliance_calendar_obligations')
