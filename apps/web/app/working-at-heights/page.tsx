'use client'

import Link from 'next/link'
import {
  ArrowRight,
  BookOpen,
  Calculator,
  HardHat,
  IdCard,
  Anchor,
  Triangle,
  LifeBuoy,
  Monitor,
  ScanSearch,
  ScrollText,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'

// Worker-facing module home for Working at Heights. Phase 1 shipped
// the wiki manual + AI ingest + calculator math; Phase 2 shipped the
// admin inventory CRUD. This page is the entry the drawer + home
// dashboard + Cmd-K palette navigate to — it surfaces the parts of
// the module that exist today (manual, admin tiles) and previews the
// surfaces in flight (calculator UI, QR-scan pre-use inspection).
//
// The page is intentionally simple. As Phase 3 lands the calculator
// and the scan flow, those replace their "Coming soon" cards here.

export default function WorkingAtHeightsHome() {
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin || !!profile?.is_superadmin

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-widest text-brand-navy dark:text-brand-yellow">
          Safety module
        </p>
        <h1 className="mt-1 flex items-center gap-3 text-2xl font-black text-slate-950 dark:text-slate-50 sm:text-3xl">
          <HardHat className="size-7 text-brand-navy dark:text-brand-yellow" />
          Working at Heights
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          Federal OSHA + Cal/OSHA fall protection. Ladders, harnesses, lanyards, SRLs,
          anchor points, rescue plans, inspections, and the math that decides which
          system fits a given anchor.
        </p>
      </header>

      <div className="space-y-8">
        <Section title="Reference">
          <ModuleCard
            href="/wiki/working-at-heights"
            Icon={BookOpen}
            title="Manual"
            desc="22-section reference covering every part of the program — Federal OSHA Subpart D + M, Cal/OSHA Title 8 §3210 / §3276 / §1670, ANSI Z359. Cited directly by the assistant chat."
          />
        </Section>

        <Section title="Calculator">
          <ModuleCard
            href="/working-at-heights/calculator"
            Icon={Calculator}
            title="Fall clearance calculator"
            desc="Pick a system (lanyard / SRL / restraint), enter the available clearance, see the verdict and the breakdown live. The math is the same one cited in the manual; the unit-tested helpers in packages/core drive both."
          />
        </Section>

        <Section title="Live operations">
          <ModuleCard
            href="/working-at-heights/permits/status"
            Icon={Monitor}
            title="Permit status board"
            desc="Big-monitor live view of every active permit — countdowns, suspended work, and forced close-outs. Pair with the hot-work board on the same TV."
          />
        </Section>

        {isAdmin && (
          <Section title="Administration">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ModuleCard href="/admin/working-at-heights/authorizations" Icon={IdCard}        title="Authorizations"          desc="Authorized / Competent / Qualified Person designations with validity windows." />
              <ModuleCard href="/admin/working-at-heights/fall-protection" Icon={HardHat}       title="Fall protection equipment" desc="Per-serial harness / lanyard / SRL / anchor connector / rope grab / trauma strap inventory." />
              <ModuleCard href="/admin/working-at-heights/ladders-portable" Icon={Triangle}     title="Portable ladders"         desc="ANSI A14-rated portable ladders by type, material, duty, and condition." />
              <ModuleCard href="/admin/working-at-heights/ladders-fixed"    Icon={Triangle}     title="Fixed ladders"            desc="1910.28(b)(9) inventory with the 2036 cage phase-out retrofit dashboard." />
              <ModuleCard href="/admin/working-at-heights/anchors"          Icon={Anchor}       title="Anchor points"            desc="Engineered + improvised anchors with QP certifications + 5-year recert cycle." />
              <ModuleCard href="/admin/working-at-heights/rescue-plans"     Icon={LifeBuoy}     title="Rescue plans"             desc="Per-location written rescue plans — the most-cited fall violation when missing." />
              <ModuleCard href="/admin/working-at-heights/permits"          Icon={ScrollText}   title="Permits"                  desc="One-shift authorisation gating every at-height task. Pre-condition checklist + clearance snapshot." />
              <ModuleCard href="/admin/working-at-heights/inspections"      Icon={ScanSearch}   title="Inspections log"          desc="Pre-use, periodic, and post-event inspection history across every component." />
            </div>
          </Section>
        )}

        <Section title="Coming soon">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ComingSoonCard
              Icon={ScanSearch}
              title="QR-scan pre-use inspection"
              desc="Mobile scan into a 30-second harness / lanyard / SRL pre-use checklist. Failed items quarantine on the spot."
            />
          </div>
        </Section>
      </div>
    </main>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
        {title}
      </h2>
      {children}
    </section>
  )
}

function ModuleCard({
  href, Icon, title, desc, comingSoonLabel,
}: {
  href: string
  Icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
  comingSoonLabel?: string
}) {
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-brand-navy hover:shadow-sm dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-brand-yellow"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-brand-navy dark:text-brand-yellow" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
              {comingSoonLabel && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                  {comingSoonLabel}
                </span>
              )}
            </h3>
            <ArrowRight className="size-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-navy dark:text-slate-600 dark:group-hover:text-brand-yellow" />
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {desc}
          </p>
        </div>
      </div>
    </Link>
  )
}

function ComingSoonCard({
  Icon, title, desc,
}: {
  Icon: React.ComponentType<{ className?: string }>
  title: string
  desc: string
}) {
  return (
    <div className="block rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-slate-400 dark:text-slate-500" />
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-700 dark:text-slate-300">
            {title}
            <span className="ml-2 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-400">
              Coming soon
            </span>
          </h3>
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {desc}
          </p>
        </div>
      </div>
    </div>
  )
}
