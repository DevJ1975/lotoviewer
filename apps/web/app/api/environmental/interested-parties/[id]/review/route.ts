import { reviewRouteFor } from '@/lib/environmental/registerApi'

// POST /api/environmental/interested-parties/[id]/review   Confirm the party's needs still hold. Admins only.

export const POST = reviewRouteFor('ms_interested_parties')
