// Admin route catalog — single source of truth for the /admin landing
// page, the Administration section of the drawer, and the 301 redirect
// table in next.config.ts.
//
// Each tile lives at `/admin/<section.urlSegment>/<tile.slug>` (Phase B
// URL shape). The old flat URL (`/admin/<tile.legacySlug>`) is preserved
// as `legacyHref` so the redirect generator can produce one rule per
// renamed route.
//
// Adding a new admin route:
//   1. Create apps/web/app/admin/<section.urlSegment>/<slug>/page.tsx.
//   2. Append a tile to the matching section below.
//   3. Run `npm run check:nav` to confirm the catalog and the directory
//      tree are aligned.

import {
  Activity,
  Anchor,
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
  HardHat,
  History,
  IdCard,
  KeyRound,
  LifeBuoy,
  Lock,
  Mountain,
  ScanSearch,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Triangle,
  UserCog,
  Users,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react'

export interface AdminTile {
  slug:       string             // leaf segment under /admin/<section>/
  href:       string             // canonical URL
  legacyHref: string | null      // pre-Phase-B URL (drives 301 redirect)
  icon:       LucideIcon
  title:      string
  desc:       string
}

export interface AdminSection {
  id:          string
  urlSegment:  string             // path segment under /admin/
  title:       string
  description: string
  tiles:       AdminTile[]
}

// Helpers for building the catalog without restating /admin everywhere.
function tile(
  section: string,
  slug: string,
  legacySlug: string | null,
  icon: LucideIcon,
  title: string,
  desc: string,
): AdminTile {
  return {
    slug,
    href:       `/admin/${section}/${slug}`,
    legacyHref: legacySlug ? `/admin/${legacySlug}` : null,
    icon,
    title,
    desc,
  }
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    id:          'people',
    urlSegment:  'people',
    title:       'People & Access',
    description: 'Members, login users, and federated identity.',
    tiles: [
      tile('people', 'members',     'members',
        UsersRound, 'Members',
        'Unified roster — login users and shop-floor workers in one list.'),
      tile('people', 'users',       'users',
        UserCog, 'Login users (legacy)',
        'Invite, promote, and revoke login access. Being absorbed by Members.'),
      tile('people', 'workers',     'workers',
        Users, 'Workers (legacy)',
        'Shop-floor roster. Being absorbed by Members; still writable for SCIM.'),
      tile('people', 'sso',         'sso',
        ShieldCheck, 'Single sign-on',
        'SAML or OIDC federation for tenant logins.'),
      tile('people', 'scim',        'scim',
        KeyRound, 'SCIM tokens',
        'Bearer tokens for SCIM 2.0 workforce provisioning.'),
      tile('people', 'contractors', 'contractors',
        Building2, 'Contractors',
        'Vendor prequalification, host-procedure acknowledgement, and renewals.'),
    ],
  },
  {
    id:          'loto',
    urlSegment:  'loto',
    title:       'LOTO Program',
    description: '29 CFR 1910.147 device inventory, inspections, and competency tracking.',
    tiles: [
      tile('loto', 'devices',              'loto-devices',
        Tag, 'LOTO devices',
        'Physical lock + tag inventory and per-checkout ownership log.'),
      tile('loto', 'periodic-inspections', 'periodic-inspections',
        ClipboardCheck, 'Periodic inspections',
        '1910.147 annual energy-control procedure audits.'),
      tile('loto', 'competency-exams',     'competency-exams',
        Lock, 'Competency exams',
        'LOTO authorized-person certifications and exam tracking.'),
      tile('loto', 'training-records',     'training-records',
        GraduationCap, 'Training records',
        '§1910.146(g) confined-space and role-based training records.'),
    ],
  },
  {
    id:          'observations',
    urlSegment:  'observations',
    title:       'Behavior & Risk',
    description: 'BBS observations admin and the risk-matrix configuration.',
    tiles: [
      tile('observations', 'bbs',           'bbs',
        Eye, 'BBS observations',
        'Manage observation locations, QR codes, and the leading-indicator dashboard.'),
      tile('observations', 'risk-settings', 'risk-settings',
        AlertTriangle, 'Risk matrix settings',
        'Customize likelihood × severity bands and the controls library.'),
    ],
  },
  {
    id:          'chemicals',
    urlSegment:  'chemicals',
    title:       'Chemicals & Prop 65',
    description: 'California Prop 65 §25249.6 + Cal/OSHA §5194 admin surfaces.',
    tiles: [
      tile('chemicals', 'prop65',        'prop65',
        FlaskConical, 'Prop 65 administration',
        'OEHHA chemicals, exposure assessments, warnings, and §5194(h) notifications.'),
      tile('chemicals', 'prop65-manual', 'prop65-manual',
        BookOpen, 'Prop 65 manual',
        'Regulatory reference for the Prop 65 / §5194 workflow.'),
    ],
  },
  {
    id:          'evidence',
    urlSegment:  'evidence',
    title:       'Evidence & Audit Trail',
    description: 'Audit log, signed artifacts, ISO clauses — the proof side of the program.',
    tiles: [
      tile('evidence', 'audit',            'audit',
        History, 'Audit log',
        'Per-row change history with filtering by actor, table, and date range.'),
      tile('evidence', 'signed-artifacts', 'signed-artifacts',
        FileSignature, 'Signed artifacts',
        'Chain-of-custody PDF validation and signed-seal verification.'),
      tile('evidence', 'integrity-manual', 'integrity-manual',
        ScrollText, 'Integrity manual',
        'Sealed artifact hashes, retention, CAPA, and ISO 45001 evidence references.'),
      tile('evidence', 'iso45001',         'iso45001',
        ShieldAlert, 'ISO 45001 clauses',
        'Clause-by-clause evidence mapping for ISO 45001 audits.'),
    ],
  },
  {
    id:          'compliance',
    urlSegment:  'compliance',
    title:       'Compliance Operations',
    description: 'External-auditor packaging, inspector access, and data retention.',
    tiles: [
      tile('compliance', 'compliance-bundle', 'compliance-bundle',
        FileArchive, 'Compliance bundles',
        'Inspector-ready PDF — every permit in a date range with chain-of-custody hashes.'),
      tile('compliance', 'inspector',         'inspector',
        ScanSearch, 'Inspector access',
        'Mint a signed read-only URL for an OSHA or Cal-OSHA inspector.'),
      tile('compliance', 'retention',         'retention',
        FileCog, 'Retention & legal holds',
        'Data retention policies and legal-hold flags by table.'),
    ],
  },
  {
    id:          'platform',
    urlSegment:  'platform',
    title:       'Platform Configuration',
    description: 'Tenant-level settings, integrations, and outbound delivery.',
    tiles: [
      tile('platform', 'configuration',   'configuration',
        Settings, 'Configuration',
        'Org-level settings — work-order URL template, notification routing, defaults.'),
      tile('platform', 'cmms',            'cmms',
        Cable, 'CMMS integrations',
        'Webhook-driven CMMS sync (Maximo, SAP PM, eMaint, or generic).'),
      tile('platform', 'webhooks',        'webhooks',
        Webhook, 'Webhooks',
        'Outbound HTTP POST on permit and test lifecycle events.'),
      tile('platform', 'platform-manual', 'platform-manual',
        BookOpen, 'Platform manual',
        'SSO, SCIM, CMMS, BBS v2, vendor prequal, and i18n reference.'),
    ],
  },
  {
    id:          'insights',
    urlSegment:  'insights',
    title:       'Insights & Operations',
    description: 'KPI dashboards, AI usage, and one-off data ops.',
    tiles: [
      tile('insights', 'scorecard',         'scorecard',
        BarChart3, 'EHS scorecard',
        'TRIR / DART / LTIR plus leading indicators and trend heatmaps.'),
      // The legacy slug was `insights` — a clash with the section name.
      // Renamed to `risk-intelligence` so the URL reads naturally.
      tile('insights', 'risk-intelligence', 'insights',
        Sparkles, 'Risk intelligence',
        'Anomaly detection, supervisor mix, and where to look harder.'),
      tile('insights', 'ai-usage',          'ai-usage',
        Activity, 'AI usage',
        'Tenant Claude invocations: spend by surface, trend, and today vs. cap.'),
      tile('insights', 'hygiene-log',       'hygiene-log',
        Brush, 'Data hygiene log',
        'One-off LOTO data ops — decommissions, renames, FK repairs.'),
    ],
  },
  {
    id:          'working-at-heights',
    urlSegment:  'working-at-heights',
    title:       'Working at Heights',
    description: 'Fall protection inventory, ladders, anchors, rescue plans, permits, inspections.',
    tiles: [
      tile('working-at-heights', 'authorizations',  null,
        IdCard, 'Authorizations',
        'Authorized / Competent / Qualified Person designations with validity windows.'),
      tile('working-at-heights', 'fall-protection', null,
        HardHat, 'Fall protection equipment',
        'Per-serial harness, lanyard, SRL, anchor connector, rope grab, trauma strap, and RDD inventory with service-life tracking.'),
      tile('working-at-heights', 'ladders-portable', null,
        Triangle, 'Portable ladders',
        'ANSI A14-rated portable ladders by type, material, duty rating, and condition.'),
      tile('working-at-heights', 'ladders-fixed',    null,
        Triangle, 'Fixed ladders',
        '1910.28(b)(9) inventory with cage phase-out + 2036 retrofit target dates.'),
      tile('working-at-heights', 'anchors',          null,
        Anchor, 'Anchor points',
        'Engineered + improvised anchors with QP certifications, 5-year recert cycles, capacity ratings.'),
      tile('working-at-heights', 'rescue-plans',     null,
        LifeBuoy, 'Rescue plans',
        'Per-location written rescue plans with named rescuers, equipment cache, and drill schedule.'),
      tile('working-at-heights', 'inspections',      null,
        ScanSearch, 'Inspections log',
        'Pre-use, periodic, and post-event inspection history across every component.'),
    ],
  },
]

export function getAllAdminTiles(): AdminTile[] {
  return ADMIN_SECTIONS.flatMap(s => s.tiles)
}

export function getAdminTile(slug: string): AdminTile | undefined {
  return getAllAdminTiles().find(t => t.slug === slug)
}

// Generates the 301 redirect table consumed by next.config.ts. One
// `:path*` rule per tile (covers the bare URL plus any subroute), plus
// one rule per section that redirects the bare section path
// (/admin/<segment>) back to the landing — the section path itself is
// not a page.
export function getAdminRedirects(): Array<{ source: string; destination: string; permanent: true }> {
  const tileRedirects = getAllAdminTiles()
    .filter(t => t.legacyHref)
    .map(t => ({
      source:      `${t.legacyHref}/:path*`,
      destination: `${t.href}/:path*`,
      permanent:   true as const,
    }))
  const sectionLanders = ADMIN_SECTIONS.map(s => ({
    source:      `/admin/${s.urlSegment}`,
    destination: '/admin',
    permanent:   true as const,
  }))
  return [...tileRedirects, ...sectionLanders]
}

// Surface a notification-tile for the catch-all settings/notifications
// route which lives under /settings, not /admin. Kept here so the
// landing surface can link to it from a sensible group.
export const SETTINGS_NOTIFICATIONS_TILE: AdminTile = {
  slug:       'settings-notifications',
  href:       '/settings/notifications',
  legacyHref: null,
  icon:       Bell,
  title:      'Notification preferences',
  desc:       'Enable Web Push for permit and atmospheric-test alerts.',
}
