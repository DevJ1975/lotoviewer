// Admin route catalog — single source of truth for the /admin landing
// page and the Administration section of the drawer.
//
// Every directory under apps/web/app/admin/ should appear in exactly
// one section here. The check-nav-sync gate (scripts/check-nav-sync.mjs)
// fails CI if a new admin directory lands without a catalog entry, or
// if a catalog entry references a directory that no longer exists.
//
// Section ordering on the landing page follows the array order below;
// tile ordering within a section is also the array order. New entries
// get appended within their section to keep the page stable.

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  BookOpen,
  Brush,
  Building2,
  Cable,
  ClipboardCheck,
  Eye,
  FileArchive,
  FileCog,
  FileSignature,
  FlaskConical,
  GraduationCap,
  History,
  KeyRound,
  Lock,
  ScanSearch,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  UserCog,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react'

export interface AdminTile {
  slug:  string                 // directory name under app/admin/
  href:  string                 // canonical URL (usually `/admin/${slug}`)
  icon:  LucideIcon
  title: string
  desc:  string
  // When true, this tile is visible to all admins. When false (default
  // for now), the tile is rendered but the route itself may have its
  // own role gate. Setting `superadminOnly: true` hides the tile from
  // tenant admins entirely.
  superadminOnly?: boolean
}

export interface AdminSection {
  id:          string
  title:       string
  description: string
  tiles:       AdminTile[]
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id:          'people',
    title:       'People & Access',
    description: 'Members, login users, and federated identity.',
    tiles: [
      {
        slug:  'members',
        href:  '/admin/members',
        icon:  UsersRound,
        title: 'Members',
        desc:  'Unified roster — login users and shop-floor workers in one list.',
      },
      {
        slug:  'users',
        href:  '/admin/users',
        icon:  UserCog,
        title: 'Login users (legacy)',
        desc:  'Invite, promote, and revoke login access. Being absorbed by Members.',
      },
      {
        slug:  'workers',
        href:  '/admin/workers',
        icon:  Users,
        title: 'Workers (legacy)',
        desc:  'Shop-floor roster. Being absorbed by Members; still writable for SCIM.',
      },
      {
        slug:  'sso',
        href:  '/admin/sso',
        icon:  ShieldCheck,
        title: 'Single sign-on',
        desc:  'SAML or OIDC federation for tenant logins.',
      },
      {
        slug:  'scim',
        href:  '/admin/scim',
        icon:  KeyRound,
        title: 'SCIM tokens',
        desc:  'Bearer tokens for SCIM 2.0 workforce provisioning.',
      },
      {
        slug:  'contractors',
        href:  '/admin/contractors',
        icon:  Building2,
        title: 'Contractors',
        desc:  'Vendor prequalification, host-procedure acknowledgement, and renewals.',
      },
    ],
  },
  {
    id:          'loto',
    title:       'LOTO Program',
    description: '29 CFR 1910.147 device inventory, inspections, and competency tracking.',
    tiles: [
      {
        slug:  'loto-devices',
        href:  '/admin/loto-devices',
        icon:  Tag,
        title: 'LOTO devices',
        desc:  'Physical lock + tag inventory and per-checkout ownership log.',
      },
      {
        slug:  'periodic-inspections',
        href:  '/admin/periodic-inspections',
        icon:  ClipboardCheck,
        title: 'Periodic inspections',
        desc:  '1910.147 annual energy-control procedure audits.',
      },
      {
        slug:  'competency-exams',
        href:  '/admin/competency-exams',
        icon:  Lock,
        title: 'Competency exams',
        desc:  'LOTO authorized-person certifications and exam tracking.',
      },
      {
        slug:  'training-records',
        href:  '/admin/training-records',
        icon:  GraduationCap,
        title: 'Training records',
        desc:  '§1910.146(g) confined-space and role-based training records.',
      },
    ],
  },
  {
    id:          'observations',
    title:       'Behavior & Risk',
    description: 'BBS observations admin and the risk-matrix configuration.',
    tiles: [
      {
        slug:  'bbs',
        href:  '/admin/bbs',
        icon:  Eye,
        title: 'BBS observations',
        desc:  'Manage observation locations, QR codes, and the leading-indicator dashboard.',
      },
      {
        slug:  'risk-settings',
        href:  '/admin/risk-settings',
        icon:  AlertTriangle,
        title: 'Risk matrix settings',
        desc:  'Customize likelihood × severity bands and the controls library.',
      },
    ],
  },
  {
    id:          'chemicals',
    title:       'Chemicals & Prop 65',
    description: 'California Prop 65 §25249.6 + Cal/OSHA §5194 admin surfaces.',
    tiles: [
      {
        slug:  'prop65',
        href:  '/admin/prop65',
        icon:  FlaskConical,
        title: 'Prop 65 administration',
        desc:  'OEHHA chemicals, exposure assessments, warnings, and §5194(h) notifications.',
      },
      {
        slug:  'prop65-manual',
        href:  '/admin/prop65-manual',
        icon:  BookOpen,
        title: 'Prop 65 manual',
        desc:  'Regulatory reference for the Prop 65 / §5194 workflow.',
      },
    ],
  },
  {
    id:          'evidence',
    title:       'Evidence & Audit Trail',
    description: 'Audit log, signed artifacts, ISO clauses — the proof side of the program.',
    tiles: [
      {
        slug:  'audit',
        href:  '/admin/audit',
        icon:  History,
        title: 'Audit log',
        desc:  'Per-row change history with filtering by actor, table, and date range.',
      },
      {
        slug:  'signed-artifacts',
        href:  '/admin/signed-artifacts',
        icon:  FileSignature,
        title: 'Signed artifacts',
        desc:  'Chain-of-custody PDF validation and signed-seal verification.',
      },
      {
        slug:  'integrity-manual',
        href:  '/admin/integrity-manual',
        icon:  ScrollText,
        title: 'Integrity manual',
        desc:  'Sealed artifact hashes, retention, CAPA, and ISO 45001 evidence references.',
      },
      {
        slug:  'iso45001',
        href:  '/admin/iso45001',
        icon:  ShieldAlert,
        title: 'ISO 45001 clauses',
        desc:  'Clause-by-clause evidence mapping for ISO 45001 audits.',
      },
    ],
  },
  {
    id:          'compliance-ops',
    title:       'Compliance Operations',
    description: 'External-auditor packaging, inspector access, and data retention.',
    tiles: [
      {
        slug:  'compliance-bundle',
        href:  '/admin/compliance-bundle',
        icon:  FileArchive,
        title: 'Compliance bundles',
        desc:  'Inspector-ready PDF — every permit in a date range with chain-of-custody hashes.',
      },
      {
        slug:  'inspector',
        href:  '/admin/inspector',
        icon:  ScanSearch,
        title: 'Inspector access',
        desc:  'Mint a signed read-only URL for an OSHA or Cal-OSHA inspector.',
      },
      {
        slug:  'retention',
        href:  '/admin/retention',
        icon:  FileCog,
        title: 'Retention & legal holds',
        desc:  'Data retention policies and legal-hold flags by table.',
      },
    ],
  },
  {
    id:          'platform',
    title:       'Platform Configuration',
    description: 'Tenant-level settings, integrations, and outbound delivery.',
    tiles: [
      {
        slug:  'configuration',
        href:  '/admin/configuration',
        icon:  Settings,
        title: 'Configuration',
        desc:  'Org-level settings — work-order URL template, notification routing, defaults.',
      },
      {
        slug:  'cmms',
        href:  '/admin/cmms',
        icon:  Cable,
        title: 'CMMS integrations',
        desc:  'Webhook-driven CMMS sync (Maximo, SAP PM, eMaint, or generic).',
      },
      {
        slug:  'webhooks',
        href:  '/admin/webhooks',
        icon:  Webhook,
        title: 'Webhooks',
        desc:  'Outbound HTTP POST on permit and test lifecycle events.',
      },
      {
        slug:  'platform-manual',
        href:  '/admin/platform-manual',
        icon:  BookOpen,
        title: 'Platform manual',
        desc:  'SSO, SCIM, CMMS, BBS v2, vendor prequal, and i18n reference.',
      },
    ],
  },
  {
    id:          'insights',
    title:       'Insights & Operations',
    description: 'KPI dashboards, AI usage, and one-off data ops.',
    tiles: [
      {
        slug:  'scorecard',
        href:  '/admin/scorecard',
        icon:  BarChart3,
        title: 'EHS scorecard',
        desc:  'TRIR / DART / LTIR plus leading indicators and trend heatmaps.',
      },
      {
        slug:  'insights',
        href:  '/admin/insights',
        icon:  Sparkles,
        title: 'Risk intelligence',
        desc:  'Anomaly detection, supervisor mix, and where to look harder.',
      },
      {
        slug:  'ai-usage',
        href:  '/admin/ai-usage',
        icon:  Activity,
        title: 'AI usage',
        desc:  'Tenant Claude invocations: spend by surface, trend, and today vs. cap.',
      },
      {
        slug:  'hygiene-log',
        href:  '/admin/hygiene-log',
        icon:  Brush,
        title: 'Data hygiene log',
        desc:  'One-off LOTO data ops — decommissions, renames, FK repairs.',
      },
    ],
  },
]

// Flatten for sync gates and tests.
export function getAllAdminTiles(): AdminTile[] {
  return ADMIN_SECTIONS.flatMap(s => s.tiles)
}

export function getAdminTile(slug: string): AdminTile | undefined {
  return getAllAdminTiles().find(t => t.slug === slug)
}

// Surface a notification-tile for the catch-all settings/notifications
// route which lives under /settings, not /admin. Kept here so the
// landing surface can link to it from a sensible group.
export const SETTINGS_NOTIFICATIONS_TILE: AdminTile = {
  slug:  'settings-notifications',
  href:  '/settings/notifications',
  icon:  Bell,
  title: 'Notification preferences',
  desc:  'Enable Web Push for permit and atmospheric-test alerts.',
}
