'use client'

import Link from 'next/link'
import {
  Building2, ArrowRight, LifeBuoy, BarChart3, Activity, Heart, History,
  Database, Search, Mail, Megaphone, Webhook, FileCode2,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { AllMembersPanel } from './_components/AllMembersPanel'

// Superadmin landing. AuthGate enforces is_superadmin before this renders;
// the env allowlist is enforced server-side by requireSuperadmin() in
// every /api/superadmin/* route.
//
// Tiles are grouped so a 12-tile grid stays scannable. Order inside each
// group is stable; new tiles append to the matching section.

interface Tile {
  href:  string
  icon:  LucideIcon
  title: string
  desc:  string
}

const SECTIONS: Array<{ title: string; description: string; tiles: Tile[] }> = [
  {
    title: 'Tenants',
    description: 'Configure organizations, members, and what they can do.',
    tiles: [
      { href: '/superadmin/tenants', icon: Building2,
        title: 'Tenants',
        desc: 'List, create, and configure tenant organizations and their modules.' },
      { href: '/superadmin/search', icon: Search,
        title: 'Cross-tenant search',
        desc: 'Find equipment, permits, workers, profiles, tickets across every tenant in one query.' },
    ],
  },
  {
    title: 'Operations',
    description: 'Day-to-day platform health and triage.',
    tiles: [
      { href: '/superadmin/cron', icon: Activity,
        title: 'Cron jobs',
        desc: 'Last fired, status, and manual trigger for every scheduled job.' },
      { href: '/superadmin/health', icon: Heart,
        title: 'Tenant health',
        desc: 'Per-tenant row counts, last activity, AI spend, open tickets at a glance.' },
      { href: '/superadmin/support', icon: LifeBuoy,
        title: 'AI support tickets',
        desc: 'Triage tickets opened by the in-app assistant, view conversation transcripts, mark resolved.' },
    ],
  },
  {
    title: 'Diagnostics',
    description: 'Audit trails and ad-hoc investigation surfaces.',
    tiles: [
      { href: '/superadmin/audit', icon: History,
        title: 'Cross-tenant audit',
        desc: 'Audit log across every tenant. Filter by tenant, table, actor, operation.' },
      { href: '/superadmin/email-log', icon: Mail,
        title: 'Email log',
        desc: 'Every Resend send: invites, training reminders, risk reviews, review links. Filter by kind / status.' },
      { href: '/superadmin/webhook-deliveries', icon: Webhook,
        title: 'Webhook deliveries',
        desc: 'Per-attempt log of outbound webhooks. Status, latency, response body, and replay.' },
      { href: '/superadmin/ai-usage', icon: BarChart3,
        title: 'AI usage & cost',
        desc: 'Anthropic invocation log: spend by tenant, by surface, by day. Failure visibility.' },
      { href: '/superadmin/queries', icon: FileCode2,
        title: 'Saved queries',
        desc: 'Author + run read-only SQL across all tenants. Sharable and version-controlled in the DB.' },
    ],
  },
  {
    title: 'Authoring',
    description: 'Content + schema authoring surfaces.',
    tiles: [
      { href: '/superadmin/release-notes', icon: Megaphone,
        title: 'Release notes',
        desc: 'Author + publish change announcements. Latest published note shows as a banner to every user.' },
      { href: '/superadmin/migrations', icon: Database,
        title: 'Migrations',
        desc: 'Repo migration files + GitHub links. Pair with the SQL editor to verify what’s applied.' },
    ],
  },
]

export default function SuperadminHome() {
  const { profile } = useAuth()

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">
          Superadmin
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
          Tenant management
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          Signed in as <span className="font-mono">{profile?.email}</span>.
          Actions here cross tenant boundaries — RLS is bypassed by your
          superadmin role.
        </p>
      </header>

      <div className="space-y-8 mb-8">
        {SECTIONS.map(section => (
          <section key={section.title}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold">
                {section.title}
              </h2>
              <p className="text-xs text-slate-400 dark:text-slate-500 hidden sm:block">
                {section.description}
              </p>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {section.tiles.map(t => (
                <li key={t.href}>
                  <TileLink tile={t} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <AllMembersPanel />
    </div>
  )
}

function TileLink({ tile }: { tile: Tile }) {
  const Icon = tile.icon
  return (
    <Link
      href={tile.href}
      className="block p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-brand-navy dark:hover:border-brand-yellow hover:shadow-sm transition-all group"
    >
      <div className="flex items-start gap-3">
        <Icon className="h-5 w-5 text-brand-navy dark:text-brand-yellow shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {tile.title}
            </h3>
            <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-brand-navy dark:group-hover:text-brand-yellow transition-colors shrink-0" />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">
            {tile.desc}
          </p>
        </div>
      </div>
    </Link>
  )
}
