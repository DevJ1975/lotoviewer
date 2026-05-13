import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'
import ReviewClient from './_components/ReviewClient'

// Public reviewer page. Token is the only auth — the URL is the
// invitation. Server-component flow:
//   1. Validate the token format up front.
//   2. Look up the review_link via service role.
//   3. Reject revoked / expired / unknown tokens with friendly UI.
//   4. Hydrate every active placard for the tenant (grouped by
//      department on the client), plus any previously-saved per-placard
//      notes, then hand off to the client component.
//
// Comments-only model: anyone with the URL leaves freeform comments
// per placard. No sign-off, no approve/reject, no per-reviewer identity.

const TOKEN_RE = /^[0-9a-f]{32}$/

export const dynamic = 'force-dynamic' // never cache; each load reflects current state

interface ReviewLinkRow {
  id:               string
  tenant_id:        string
  department:       string | null
  expires_at:       string
  revoked_at:       string | null
  first_viewed_at:  string | null
  is_public:        boolean | null
}

interface PlacardReviewRow {
  equipment_id: string
  notes:        string | null
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-100 text-rose-800 text-xs font-semibold">
          SoteriaField · Placard review
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{body}</p>
      </div>
    </main>
  )
}

export default async function ReviewPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (!TOKEN_RE.test(token)) notFound()

  const admin = supabaseAdmin()

  const { data: link, error } = await admin
    .from('loto_review_links')
    .select('id, tenant_id, department, expires_at, revoked_at, first_viewed_at, is_public')
    .eq('token', token)
    .maybeSingle<ReviewLinkRow>()

  if (error) throw new Error(error.message)
  if (!link) notFound()

  if (link.revoked_at) {
    return <ErrorScreen title="Link revoked" body="This review link has been retired. Reach out to the tenant admin for the current URL." />
  }
  if (Date.parse(link.expires_at) < Date.now()) {
    return <ErrorScreen title="Link expired" body={`This review link expired on ${formatDate(link.expires_at)}. Reach out to the tenant admin for a fresh one.`} />
  }

  const [equipmentRes, stepsRes, reviewsRes, tenantRes] = await Promise.all([
    admin
      .from('loto_equipment')
      .select('*')
      .eq('tenant_id', link.tenant_id)
      .eq('decommissioned', false)
      .order('department', { ascending: true })
      .order('equipment_id', { ascending: true }),
    admin
      .from('loto_steps')
      .select('*')
      .eq('tenant_id', link.tenant_id)
      .order('equipment_id', { ascending: true })
      .order('step_number', { ascending: true }),
    admin
      .from('loto_placard_reviews')
      .select('equipment_id, notes')
      .eq('review_link_id', link.id),
    admin
      .from('tenants')
      .select('name')
      .eq('id', link.tenant_id)
      .maybeSingle(),
  ])

  const equipmentList = (equipmentRes.data ?? []) as Equipment[]
  const allSteps      = (stepsRes.data ?? [])      as LotoEnergyStep[]
  const stepsByEquipment = new Map<string, LotoEnergyStep[]>()
  for (const s of allSteps) {
    const list = stepsByEquipment.get(s.equipment_id) ?? []
    list.push(s)
    stepsByEquipment.set(s.equipment_id, list)
  }
  const initialReviews = (reviewsRes.data ?? []) as PlacardReviewRow[]
  const tenantName     = tenantRes.data?.name ?? 'your client'

  return (
    <ReviewClient
      token={token}
      reviewLinkId={link.id}
      tenantName={tenantName}
      isFirstView={!link.first_viewed_at}
      equipment={equipmentList}
      stepsByEquipment={Object.fromEntries(stepsByEquipment)}
      initialReviews={initialReviews}
    />
  )
}
