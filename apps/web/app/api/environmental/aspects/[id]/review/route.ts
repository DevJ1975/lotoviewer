import { reviewRouteFor } from '@/lib/environmental/registerApi'

// POST /api/environmental/aspects/[id]/review   Confirm the aspect and its scores still hold. Admins only.

export const POST = reviewRouteFor('environmental_aspects')
