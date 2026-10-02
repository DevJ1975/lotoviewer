import { reviewRouteFor } from '@/lib/environmental/registerApi'

// POST /api/environmental/permits/[id]/review   Confirm the permit is still recorded as it stands. Admins only.

export const POST = reviewRouteFor('environmental_permits')
