import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'
import { sanitizeId } from '@soteria/core/storagePaths'
import { parseAnnotations } from '@/lib/photoAnnotations'
import QrPlacardPhoto from './_components/QrPlacardPhoto'
import QrEnergySteps from './_components/QrEnergySteps'

// Public LOTO placard view. A worker scans the printed placard QR
// (https://soteriafield.app/qr/{qr_token}) and lands here with NO login.
//
// Trust model:
//   • The page never sees the service key. It calls the SECURITY DEFINER
//     RPC `get_placard_by_qr` with the anon key — the same key the browser
//     would hold — so RLS is never weakened and only display-safe columns
//     leave the database.
//   • The RPC also logs the resolved scan to loto_placard_scan_log and
//     returns NULL for unknown / decommissioned tokens, which renders the
//     clean "Placard not found" state below.
//
// force-dynamic: each scan is a fresh request (and a logged event); never
// cache a placard.

export const dynamic = 'force-dynamic'

const TOKEN_RE = /^[0-9a-f]{16}$/

interface EnergyStep {
  energy_type:            string | null
  tag_description:        string | null
  isolation_procedure:    string | null
  method_of_verification: string | null
}

interface Placard {
  equipment_id:    string
  description:     string | null
  department:      string | null
  iso_photo_url:   string | null
  equip_photo_url: string | null
  iso_annotations: unknown
  verified:        boolean | null
  verified_date:   string | null
  /** Active public review link token for this tenant, or null if none is live. */
  review_link_token: string | null
  energy_steps:    EnergyStep[]
}

async function resolvePlacard(token: string): Promise<Placard | null> {
  if (!TOKEN_RE.test(token)) return null

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Supabase env not configured')

  const h = await headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    null
  const userAgent = h.get('user-agent') ?? null

  // Anon-keyed client: proves the RPC's anon grant is sufficient and keeps
  // the service key out of this code path entirely.
  const anonClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data, error } = await anonClient.rpc('get_placard_by_qr', {
    p_token:      token,
    p_ip:         ip,
    p_user_agent: userAgent,
  })
  if (error) throw new Error(error.message)
  return (data as Placard | null) ?? null
}

export default async function QrPlacardPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const placard = await resolvePlacard(token)

  if (!placard) return <NotFound />

  const isoAnnotations = parseAnnotations(placard.iso_annotations)

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-xl mx-auto px-4 py-6 space-y-5">
        <header className="rounded-2xl bg-brand-navy text-white p-5 shadow-sm">
          <div className="text-[11px] font-bold tracking-widest uppercase opacity-90">
            SoteriaField · LOTO placard
          </div>
          <h1 className="text-2xl font-bold mt-1 font-mono">{placard.equipment_id}</h1>
          {placard.description ? (
            <p className="text-sm opacity-95 mt-1">{placard.description}</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {placard.department ? (
              <span className="rounded-md bg-white/10 px-2.5 py-1 text-xs font-semibold">
                {placard.department}
              </span>
            ) : null}
            <VerifiedBadge verified={placard.verified} />
          </div>
        </header>

        <QrPlacardPhoto
          isoUrl={placard.iso_photo_url}
          equipUrl={placard.equip_photo_url}
          isoAnnotations={isoAnnotations}
        />

        <section className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-xs font-bold tracking-wide uppercase text-slate-500 mb-3">
            Energy-control steps
          </h2>
          <QrEnergySteps steps={placard.energy_steps} />
        </section>

        {placard.review_link_token ? (
          <UpdatePhotoCta token={placard.review_link_token} equipmentId={placard.equipment_id} />
        ) : null}

        <footer className="pt-1 pb-6 text-center text-[11px] text-slate-400">
          Read-only placard view · Lock out, tag out, verify zero energy before service.
        </footer>
      </div>
    </main>
  )
}

function VerifiedBadge({
  verified,
}: { verified: boolean | null }) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-400/20 px-2.5 py-1 text-xs font-semibold text-rose-100">
        Needs COI review
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-400/20 px-2.5 py-1 text-xs font-semibold text-amber-100">
      Unverified
    </span>
  )
}

function UpdatePhotoCta({
  token, equipmentId,
}: { token: string; equipmentId: string }) {
  // Deep-link into the tenant's public review portal, FOCUSED on this one
  // machine (?equipment=…) so a phone isn't served the full batch page, and
  // anchored to its card. The reviewer replaces the photo there; it stages as
  // "pending reconcile" and an admin applies it. No editing happens on this
  // read-only placard view itself.
  const href = `/review/${token}?equipment=${encodeURIComponent(equipmentId)}#eq-${sanitizeId(equipmentId)}`
  return (
    <a
      href={href}
      className="block rounded-2xl border border-brand-navy/20 bg-brand-navy/[0.04] dark:border-white/10 dark:bg-white/[0.04] p-4 transition-colors hover:bg-brand-navy/[0.08] dark:hover:bg-white/[0.08]"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-brand-navy dark:text-white">Photo out of date?</div>
          <div className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
            Submit a replacement for this placard — your admin reviews it before it goes live.
          </div>
        </div>
        <span className="shrink-0 rounded-lg bg-brand-navy px-3 py-2 text-xs font-semibold text-white">
          Update photo →
        </span>
      </div>
    </a>
  )
}

function NotFound() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
      <div className="max-w-md text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold">
          SoteriaField · LOTO placard
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Placard not found</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          This code doesn&apos;t match an active placard. The equipment may have been
          decommissioned, or the code may be mistyped. Check with your supervisor.
        </p>
      </div>
    </main>
  )
}
