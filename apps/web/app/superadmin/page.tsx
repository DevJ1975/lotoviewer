'use client'

import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Building2,
  Calendar,
  Database,
  FileCode2,
  Heart,
  History,
  LifeBuoy,
  Mail,
  Megaphone,
  Search,
  Webhook,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { AllMembersPanel } from './_components/AllMembersPanel'

// Superadmin landing. AuthGate enforces is_superadmin before this renders;
// the env allowlist is enforced server-side by requireSuperadmin() in
// every /api/superadmin/* route.
//
// Tiles are grouped so the grid stays scannable as operator tools grow.
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
      {
        href: '/superadmin/tenants',
        icon: Building2,
        title: 'Tenants',
        desc: 'List, create, and configure tenant organizations and their modules.',
      },
      {
        href: '/superadmin/search',
        icon: Search,
        title: 'Cross-tenant search',
        desc: 'Find equipment, permits, workers, profiles, and tickets across every tenant.',
      },
    ],
  },
  {
    title: 'Operations',
    description: 'Day-to-day platform health and triage.',
    tiles: [
      {
        href: '/superadmin/cron',
        icon: Activity,
        title: 'Cron jobs',
        desc: 'Last fired, status, and manual trigger for every scheduled job.',
      },
      {
        href: '/superadmin/health',
        icon: Heart,
        title: 'Tenant health',
        desc: 'Per-tenant row counts, last activity, AI spend, and open tickets at a glance.',
      },
      {
        href: '/superadmin/support',
        icon: LifeBuoy,
        title: 'AI support tickets',
        desc: 'Triage tickets opened by the assistant, view transcripts, and mark resolved.',
      },
      {
        href: '/superadmin/daily-report',
        icon: Calendar,
        title: 'Daily report',
        desc: 'Morning narrative and anomaly bullets across all tenants from the last 24 hours.',
      },
    ],
  },
  {
    title: 'Diagnostics',
    description: 'Audit trails and ad-hoc investigation surfaces.',
    tiles: [
      {
        href: '/superadmin/audit',
        icon: History,
        title: 'Cross-tenant audit',
        desc: 'Audit log across every tenant. Filter by tenant, table, actor, and operation.',
      },
      {
        href: '/superadmin/email-log',
        icon: Mail,
        title: 'Email log',
        desc: 'Every Resend send: invites, reminders, risk reviews, and review links.',
      },
      {
        href: '/superadmin/webhook-deliveries',
        icon: Webhook,
        title: 'Webhook deliveries',
        desc: 'Per-attempt log of outbound webhooks with status, latency, body, and replay.',
      },
      {
        href: '/superadmin/ai-usage',
        icon: BarChart3,
        title: 'AI usage & cost',
        desc: 'Anthropic invocation log: spend by tenant, by surface, by day, and failures.',
      },
      {
        href: '/superadmin/queries',
        icon: FileCode2,
        title: 'Saved queries',
        desc: 'Author and run read-only SQL across tenants from reusable diagnostics.',
      },
    ],
  },
  {
    title: 'Authoring',
    description: 'Content, schema, and learning authoring surfaces.',
    tiles: [
      {
        href: '/superadmin/policies',
        icon: BookOpen,
        title: 'Policies & Regulations',
        desc: 'Upload company policies or global regulations so the assistant can cite them.',
      },
      {
        href: '/superadmin/strike',
        icon: BookOpenCheck,
        title: 'STRIKE Studio',
        desc: 'Author microlearning modules, review requests, and manage the STRIKE library.',
      },
      {
        href: '/wiki',
        icon: BookOpen,
        title: 'User wiki',
        desc: 'Per-module FAQs, Do\'s & Don\'ts, and the wiki-sync update protocol.',
      },
      {
        href: '/superadmin/release-notes',
        icon: Megaphone,
        title: 'Release notes',
        desc: 'Author and publish change announcements shown as banners to users.',
      },
      {
        href: '/superadmin/migrations',
        icon: Database,
        title: 'Migrations',
        desc: 'Repo migration files and GitHub links for applied-SQL verification.',
      },
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
          Actions here cross tenant boundaries; RLS is bypassed by your
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
              {section.tiles.map(tile => (
                <li key={tile.href}>
                  <TileLink tile={tile} />
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
