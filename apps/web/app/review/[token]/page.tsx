import { notFound } from 'next/navigation'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import type { Equipment, LotoEnergyStep } from '@/lib/types'
import ReviewClient from './_components/ReviewClient'

// Public reviewer page. Token is the only auth — the URL is the
// invitation. Server-component flow:
//   1. Validate the token format up front.
//   2. Look up the review_link via service role.
//   3. Reject revoked / expired / unknown tokens with friendly UI.
//   4. Hydrate the equipment + energy steps + tenant name + any
//      previously-saved per-placard reviews, then hand off to the
//      client component.
//
// Public read on the loto-photos bucket (migration 005) means we
// can use the existing equip_photo_url / iso_photo_url columns
// directly in <img src=…> — no signed URLs needed.

const TOKEN_RE = /^[0-9a-f]{32}$/

export const dynamic = 'force-dynamic' // never cache; each load reflects current state

interface ReviewLinkRow {
  id:                 string
  tenant_id:          string
  department:         string
  reviewer_name:      string
  reviewer_email:     string
  admin_message:      string | null
  expires_at:         string
  revoked_at:         string | null
  signed_off_at:      string | null
  signoff_approved:   boolean | null
  signoff_typed_name: string | null
  signoff_notes:      string | null
  first_viewed_at:    string | null
}

interface PlacardReviewRow {
  equipment_id: string
  status:       'approved' | 'needs_changes'
  notes:        string | null
}

export default async function ReviewPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params

  if (!TOKEN_RE.test(token)) notFound()

  const admin = supabaseAdmin()

  const { data: link, error } = await admin
    .from('loto_review_links')
    .select('id, tenant_id, department, reviewer_name, reviewer_email, admin_message, expires_at, revoked_at, signed_off_at, signoff_approved, signoff_typed_name, signoff_notes, first_viewed_at')
    .eq('token', token)
    .maybeSingle<ReviewLinkRow>()

  if (error) throw new Error(error.message)
  if (!link) notFound()

  if (link.revoked_at) {
    return <ErrorScreen title="Link revoked" body="This review link has been revoked by the sender. Reach out to them for a new one." />
  }
  if (Date.parse(link.expires_at) < Date.now()) {
    return <ErrorScreen title="Link expired" body={`This review link expired on ${formatDate(link.expires_at)}. Reach out to the sender for a fresh one.`} />
  }

  // Fetch the equipment in this department + its energy steps + any
  // previous note-saves (in case the reviewer is mid-review and
  // refreshed). All three in parallel.
  const [{ data: equipment }, { data: steps }, { data: prevReviews }, { data: tenantRow }] = await Promise.all([
    admin
      .from('loto_equipment')
      .select('*')
      .eq('tenant_id',     link.tenant_id)
      .eq('department',    link.department)
      .eq('decommissioned', false)
      .order('equipment_id', { ascending: true }),
    admin
      .from('loto_steps')
      .select('*')
      .eq('tenant_id', link.tenant_id)
      .order('equipment_id', { ascending: true })
      .order('step_number',   { ascending: true }),
    admin
      .from('loto_placard_reviews')
      .select('equipment_id, status, notes')
      .eq('review_link_id', link.id),
    admin
      .from('tenants')
      .select('name')
      .eq('id', link.tenant_id)
      .maybeSingle(),
  ])

  const equipmentList = (equipment ?? []) as Equipment[]
  const stepsByEquipment = new Map<string, LotoEnergyStep[]>()
  for (const s of (steps ?? []) as LotoEnergyStep[]) {
    const list = stepsByEquipment.get(s.equipment_id) ?? []
    list.push(s)
    stepsByEquipment.set(s.equipment_id, list)
  }
  const initialReviews = (prevReviews ?? []) as PlacardReviewRow[]
  const tenantName = tenantRow?.name ?? 'your client'

  // If the reviewer is already done, show the read-only thank-you.
  if (link.signed_off_at) {
    return (
      <SignedOffScreen
        link={link}
        equipment={equipmentList}
        reviews={initialReviews}
        tenantName={tenantName}
      />
    )
  }

  return (
    <ReviewClient
      token={token}
      reviewLinkId={link.id}
      tenantName={tenantName}
      department={link.department}
      reviewerName={link.reviewer_name}
      adminMessage={link.admin_message}
      expiresAt={link.expires_at}
      isFirstView={!link.first_viewed_at}
      equipment={equipmentList}
      stepsByEquipment={Object.fromEntries(stepsByEquipment)}
      initialReviews={initialReviews}
    />
  )
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return iso }
}

function ErrorScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-100 text-rose-800 text-xs font-semibold">
          Soteria FIELD · Placard review
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{body}</p>
      </div>
    </main>
  )
}

function SignedOffScreen({
  link, equipment, reviews, tenantName,
}: {
  link:       ReviewLinkRow
  equipment:  Equipment[]
  reviews:    PlacardReviewRow[]
  tenantName: string
}) {
  const reviewByEqId = new Map(reviews.map(r => [r.equipment_id, r]))
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-900 py-10 px-4">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold mb-2">
            Review submitted
          </div>
          <h1 className="text-2xl font-bold text-emerald-900">
            Thanks, {link.signoff_typed_name ?? link.reviewer_name}.
          </h1>
          <p className="text-sm text-emerald-800 mt-1">
            Your review of <strong>{tenantName}</strong>'s <strong>{link.department}</strong> placards has been recorded.
          </p>
          <p className="text-xs text-emerald-700 mt-2">
            Outcome: <strong>{link.signoff_approved ? 'Approved' : 'Needs changes'}</strong>
          </p>
        </div>

        {link.signoff_notes ? (
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
            <h2 className="text-xs font-bold tracking-wide uppercase text-slate-500 mb-2">Your overall comments</h2>
            <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{link.signoff_notes}</p>
          </section>
        ) : null}

        <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 space-y-4">
          <h2 className="text-xs font-bold tracking-wide uppercase text-slate-500">Per-placard notes</h2>
          {equipment.length === 0 && (
            <p className="text-sm text-slate-500">No placards in this batch.</p>
          )}
          {equipment.map(eq => {
            const r = reviewByEqId.get(eq.equipment_id)
            return (
              <div key={eq.equipment_id} className="border-t border-slate-100 dark:border-slate-700 pt-3 first:border-t-0 first:pt-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{eq.equipment_id}</span>
                  {r ? (
                    <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${
                      r.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}>
                      {r.status === 'approved' ? 'Approved' : 'Needs changes'}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400">No comment</span>
                  )}
                </div>
                <div className="text-xs text-slate-500">{eq.description}</div>
                {r?.notes ? (
                  <div className="mt-1 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{r.notes}</div>
                ) : null}
              </div>
            )
          })}
        </section>

        <p className="text-center text-xs text-slate-400">
          You can close this tab. The sender has been notified of your submission.
        </p>
      </div>
    </main>
  )
}
