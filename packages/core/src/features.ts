// Feature registry — single source of truth for what's available in the app.
//
// Today (single-tenant): edit this file directly. Toggle `enabled` to false
// to hide a feature from the side drawer; flip `comingSoon` to advertise
// without exposing a route. Type errors fall out of the build if a category
// or feature ID drifts.
//
// Future (multi-tenant): the registry stays as the catalog of all *possible*
// features. A `tenant_features` table will override `enabled` per tenant —
// the resolver below already has the hook (see resolveFeatureFlags). The
// admin UI to manage that table is a separate slice and lives outside this
// file; this file remains the source of truth for what features *exist*.
//
// The drawer reads from FEATURES via getModules / getChildren so the UI is
// one render away from any flag flip.
//
// Nesting: a feature with `parent: 'someModuleId'` is rendered as a child
// of that module in the drawer (indented under an expandable group). A
// feature without `parent` is a top-level module. Modules with children
// get a chevron toggle; the module name itself is a Link to the module's
// home page (its href).

export type FeatureCategory = 'safety' | 'reports' | 'admin'

// Palette keys used by the drawer + chrome accent strip + per-module
// header pill. Stored as a string union (not hex) so the web-only
// resolver in apps/web/lib/moduleVisuals.ts can map each one to a
// LITERAL Tailwind className — Tailwind 4's JIT scanner will only
// pull in classes it can see verbatim in source. Adding a new color
// here means adding the matching row in MODULE_COLOR_CLASSES.
export type ModuleColor =
  | 'red' | 'amber' | 'orange' | 'purple' | 'rose'
  | 'teal' | 'sky' | 'indigo' | 'emerald' | 'slate'

export interface FeatureDef {
  id:          string
  name:        string
  description: string
  // null => not yet routable (Coming Soon entries). The drawer renders
  // these as disabled list items with a "Coming Soon" pill.
  href:        string | null
  category:    FeatureCategory
  // Master switch. false hides the feature from the drawer entirely.
  // For multi-tenant: this is the *fallback* when the tenant has no
  // override row — see resolveFeatureFlags.
  enabled:     boolean
  // Show in drawer with "Coming Soon" pill, not clickable. Independent
  // of `enabled`: a coming-soon feature is "enabled" in the sense that
  // the team wants to advertise it, but it isn't reachable.
  comingSoon:  boolean
  // Optional parent module ID. When set, this feature renders as an
  // indented child under its parent in the drawer. Example: 'status'
  // (LOTO Status Report) has parent: 'loto'. The parent's category
  // wins for grouping purposes — children inherit it for the lookup
  // helpers below.
  parent?:     string
  // Marks features that are live + tenant-toggleable but NOT reachable
  // from the global drawer — they're surfaced via inline UI on a host
  // page instead (e.g. the Client Review Portal lives inside the
  // department detail page rather than as its own drawer entry).
  // Allows href:null without tripping the "live features must be
  // routable" registry invariant.
  internal?:   boolean
  // Lucide icon name (e.g. 'Lock', 'Flame'). Stored as a string so
  // packages/core stays free of lucide-react (web vs. native split).
  // Resolved to a component via apps/web/lib/moduleVisuals.ts. Set on
  // top-level modules only — children inherit visually.
  icon?:       string
  // Palette key for drawer / chrome / per-module-header accents. Same
  // posture as `icon` — set on top-level modules; children inherit.
  color?:      ModuleColor
}

// ─── The catalog ───────────────────────────────────────────────────────────
// Order within a category determines drawer order; order within a parent
// determines child order. New features get appended; reordering here
// reorders the UI immediately.
export const FEATURES: FeatureDef[] = [
  {
    id:          'my-safety-readiness',
    name:        'My Safety Readiness',
    description: 'Profile, training, equipment badges, shift, and leaderboard standing',
    href:        '/my-safety-readiness',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'ShieldCheck',
    color:       'emerald',
  },

  // ── LOTO module + sub-pages ─────────────────────────────────────────────
  // The "LOTO" row navigates to /, the equipment dashboard. Status,
  // Departments, Print Queue, Import, and Decommission all operate on the
  // same loto_equipment table — modeling them as children of the LOTO
  // module makes the navigation intent obvious instead of scattering them
  // across "Reports" and "Admin" buckets.
  {
    id:          'loto',
    name:        'LOTO',
    description: 'Lockout/Tagout equipment + placards',
    href:        '/loto',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'Lock',
    color:       'red',
  },
  {
    id:          'loto-status',
    name:        'Status Report',
    description: 'Photo + verification status by department',
    href:        '/status',
    category:    'safety',
    parent:      'loto',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'loto-departments',
    name:        'Departments',
    description: 'Per-department equipment lists',
    href:        '/departments',
    category:    'safety',
    parent:      'loto',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'loto-print',
    name:        'Print Queue',
    description: 'Batch print placard PDFs',
    href:        '/print',
    category:    'safety',
    parent:      'loto',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'loto-import',
    name:        'Import Equipment',
    description: 'CSV bulk-seed for LOTO equipment',
    href:        '/import',
    category:    'safety',
    parent:      'loto',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'loto-decommission',
    name:        'Decommission',
    description: 'Mark equipment as retired',
    href:        '/decommission',
    category:    'safety',
    parent:      'loto',
    enabled:     true,
    comingSoon:  false,
  },
  {
    // Public review portal — admins email a tokenized link to a
    // non-Soteria reviewer (typically the customer's safety officer)
    // who reviews the placards and signs off without an account.
    // Admin UI lives on /departments/[dept]; public reviewer route is
    // /review/[token]. href:null hides it from the drawer (it's
    // surfaced inline via ClientReviewPanel) but keeps it in the
    // FEATURES catalog so per-tenant disable via tenants.modules works.
    id:          'loto-review-portal',
    name:        'Client Review Portal',
    description: 'Tokenized client signoff on completed placards',
    href:        null,
    category:    'safety',
    parent:      'loto',
    enabled:     true,
    comingSoon:  false,
    internal:    true,
  },

  // ── Equipment Readiness module ──────────────────────────────────────────
  {
    id:          'equipment-readiness',
    name:        'Equipment Readiness',
    description: 'PIT, lift, and mobile equipment pre-use checks',
    href:        '/equipment-readiness',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'ClipboardCheck',
    color:       'teal',
  },
  {
    id:          'equipment-readiness-scan',
    name:        'Scan & Inspect',
    description: 'Launch pre-use checks from equipment QR codes',
    href:        '/equipment-readiness/scan',
    category:    'safety',
    parent:      'equipment-readiness',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'equipment-readiness-defects',
    name:        'Defects',
    description: 'Open defects and out-of-service equipment',
    href:        '/equipment-readiness/defects',
    category:    'safety',
    parent:      'equipment-readiness',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'equipment-readiness-qr',
    name:        'QR Labels',
    description: 'Print scan labels for pre-use inspections',
    href:        '/equipment-readiness/qr',
    category:    'safety',
    parent:      'equipment-readiness',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'equipment-readiness-config',
    name:        'Configuration',
    description: 'Families, schedules, and STRIKE requirements',
    href:        '/equipment-readiness/config',
    category:    'safety',
    parent:      'equipment-readiness',
    enabled:     true,
    comingSoon:  false,
  },

  // ── Risk Assessment module + sub-pages ─────────────────────────────────
  // ISO 45001 6.1 + Cal/OSHA T8 §3203 IIPP hazard-evaluation backbone.
  //
  // Slice 2 status: heat map + list + detail views are live. The
  // wizard (risk-new) and the controls library admin (risk-controls)
  // stay coming-soon until slices 3 and 4. The detail page exposes a
  // "Mark reviewed" + a few PATCH actions; full create flow is the
  // wizard.
  {
    id:          'risk-assessment',
    name:        'Risk Assessment',
    description: 'ISO 45001 6.1 risk register + heat map',
    href:        '/risk',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'AlertTriangle',
    color:       'amber',
  },
  {
    id:          'risk-heatmap',
    name:        'Heat Map',
    description: '5x5 risk matrix view',
    href:        '/risk',
    category:    'safety',
    parent:      'risk-assessment',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'risk-list',
    name:        'Risk Register',
    description: 'List + filter every identified risk',
    href:        '/risk/list',
    category:    'safety',
    parent:      'risk-assessment',
    enabled:     true,
    comingSoon:  false,
  },
  {
    // Hidden from drawer (internal:true) — surfaced via the +New
    // Risk button on the heat map page. Slice 3b made the wizard
    // live; this entry stays internal so the drawer doesn't gain
    // a "New Risk" link of its own (that path is the +New button).
    id:          'risk-new',
    name:        'New Risk',
    description: 'Hazard-ID wizard',
    href:        '/risk/new',
    category:    'safety',
    parent:      'risk-assessment',
    enabled:     true,
    comingSoon:  false,
    internal:    true,
  },
  {
    id:          'risk-controls',
    name:        'Controls Library',
    description: 'Tenant-scoped catalog of available controls',
    href:        '/risk/controls',
    category:    'safety',
    parent:      'risk-assessment',
    enabled:     true,
    comingSoon:  false,
  },

  // ── Confined Spaces module + sub-pages ──────────────────────────────────
  {
    id:          'confined-spaces',
    name:        'Confined Spaces',
    description: 'OSHA 1910.146 permit-required entries',
    href:        '/confined-spaces',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'DoorClosed',
    color:       'purple',
  },
  {
    id:          'cs-status-board',
    name:        'Permit Status Board',
    description: 'Live big-monitor view of active permits + countdown timers',
    href:        '/confined-spaces/status',
    category:    'safety',
    parent:      'confined-spaces',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'cs-import',
    name:        'Import Spaces',
    description: 'CSV bulk-seed for confined-space inventory',
    href:        '/confined-spaces/import',
    category:    'safety',
    parent:      'confined-spaces',
    enabled:     true,
    comingSoon:  false,
  },

  // ── Incident Reporting & Investigation module ─────────────────────────
  // Unified intake for injuries/illnesses, near-misses, property damage,
  // and environmental spills. Folds the legacy near-miss feature into
  // its own type discriminator (see migration 059b). The standalone
  // `near-miss` feature below remains for the transition window —
  // tenants can keep its drawer entry while the new module rolls out;
  // a follow-up release will retire it.
  {
    id:          'incidents',
    name:        'Incident Reporting',
    description: 'Injury, near-miss, damage, and spill intake → investigation → CAPA → OSHA',
    href:        '/incidents',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'Siren',
    color:       'rose',
  },
  {
    id:          'incidents-new',
    name:        'Report Incident',
    description: 'Mobile-friendly intake wizard',
    href:        '/incidents/new',
    category:    'safety',
    parent:      'incidents',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'incidents-osha',
    name:        'OSHA Recordkeeping',
    description: '300 log, 300A annual summary, ITA upload',
    href:        '/osha',
    category:    'safety',
    parent:      'incidents',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'incidents-scorecard',
    name:        'Scorecard',
    description: 'TRIR/DART/LTIR + leading indicators + heatmaps',
    href:        '/incidents/scorecard',
    category:    'safety',
    parent:      'incidents',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'incidents-lessons',
    name:        'Lessons Learned',
    description: 'Tenant-wide library of published investigation findings',
    href:        '/incidents/lessons',
    category:    'safety',
    parent:      'incidents',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'incidents-qr',
    name:        'Anonymous QR Codes',
    description: 'Per-location QR signs for anonymous reporting (OSHA 1904.35)',
    href:        '/incidents/qr',
    category:    'safety',
    parent:      'incidents',
    enabled:     true,
    comingSoon:  false,
  },

  // ── Behavior-Based Safety (BBS) module ───────────────────────────────
  // QR-driven observation program. Workers scan a QR posted at a
  // location, then submit an Unsafe Act, Unsafe Condition, or Safe
  // Behavior. Anonymous submissions are accepted via the QR token;
  // logged-in submissions earn gamification points and appear on the
  // leaderboard. Feeds the EHS scorecard via a weighted formula
  // (participation × close-out × severity).
  {
    id:          'bbs',
    name:        'Behavior-Based Safety',
    description: 'QR-driven unsafe act / condition / safe behavior observations',
    href:        '/bbs',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'Eye',
    color:       'teal',
  },
  {
    id:          'bbs-new',
    name:        'New Observation',
    description: 'Submit an unsafe act / condition / safe behavior',
    href:        '/bbs/new',
    category:    'safety',
    parent:      'bbs',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'bbs-observe',
    name:        'Quick BBS Observe',
    description: 'Mobile-first BBS v2 capture form (ratio-driven leading indicator)',
    href:        '/bbs/observe',
    category:    'safety',
    parent:      'bbs',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'bbs-leaderboard',
    name:        'Leaderboard',
    description: 'Top BBS contributors this period',
    href:        '/bbs/leaderboard',
    category:    'safety',
    parent:      'bbs',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'bbs-qr',
    name:        'QR Codes',
    description: 'Generate per-location QR signs for BBS reporting',
    href:        '/bbs/qr',
    category:    'safety',
    parent:      'bbs',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'bbs-scorecard',
    name:        'BBS Scorecard',
    description: 'Participation × close-out × severity weighted score',
    href:        '/bbs/scorecard',
    category:    'safety',
    parent:      'bbs',
    enabled:     true,
    comingSoon:  false,
  },

  // ── Chemical Management (HazCom / GHS / SDS) ─────────────────────────
  // Tenant-wide chemical catalog with versioned SDS storage. Phase A
  // ships catalog + manual SDS upload + search. Phase B layers AI SDS
  // parsing; Phase E adds nightly drift monitoring. See
  // docs/chemical-management-system-plan.md for the full roadmap.
  {
    id:          'chemicals',
    name:        'Chemical Management',
    description: 'Chemical inventory, GHS labeling, and SDS storage',
    href:        '/chemicals',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'FlaskConical',
    color:       'indigo',
  },
  {
    id:          'chemicals-new',
    name:        'Add Chemical',
    description: 'Add a chemical product and upload its SDS',
    href:        '/chemicals/new',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-review',
    name:        'SDS Review Queue',
    description: 'Review AI-parsed SDS fields awaiting approval',
    href:        '/chemicals/review',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-inventory',
    name:        'Inventory',
    description: 'Containers on shelves, expiring stock, scan in/out',
    href:        '/chemicals/inventory',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-scan',
    name:        'Scan Barcode',
    description: 'Camera barcode lookup for chemical containers',
    href:        '/chemicals/scan',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-locations',
    name:        'Storage Locations',
    description: 'Buildings, rooms, cabinets — where chemicals live',
    href:        '/chemicals/locations',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-drift',
    name:        'SDS Drift Log',
    description: 'Nightly + manual checks of manufacturer SDS revisions',
    href:        '/chemicals/drift',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-tier-two',
    name:        'Tier II Report',
    description: 'EPCRA Tier II rollup of active inventory by location',
    href:        '/chemicals/tier-two',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-restricted',
    name:        'Restricted Chemicals',
    description: 'Banned / restricted CAS + name patterns',
    href:        '/chemicals/restricted',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-approvals',
    name:        'Approval Queue',
    description: 'Approve or reject pending chemical container requests',
    href:        '/chemicals/approvals',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'chemicals-maq',
    name:        'MAQ Caps',
    description: 'Fire-code maximum allowable quantity rules per location',
    href:        '/chemicals/maq',
    category:    'safety',
    parent:      'chemicals',
    enabled:     true,
    comingSoon:  false,
  },

  // ── Hazardous Waste module ─────────────────────────────────────────────
  // California-forward hazardous waste records, accumulation checks,
  // manifest preparation, and inspection binders. The web slice starts
  // as an operating hub and manual; the Expo field slice is intentionally
  // offline-first so technicians can inspect containers away from signal.
  {
    id:          'hazardous-waste',
    name:        'Hazardous Waste',
    description: 'Waste determinations, accumulation checks, manifests, calendar reminders, and inspection binders',
    href:        '/hazardous-waste',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'Recycle',
    color:       'amber',
  },
  {
    id:          'hazardous-waste-field',
    name:        'Field Inspections',
    description: 'Offline-ready accumulation-area and container checks',
    href:        '/hazardous-waste',
    category:    'safety',
    parent:      'hazardous-waste',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'hazardous-waste-documents',
    name:        'Documents & Reports',
    description: 'Official-form preparation packets, PDF records, and submission calendar',
    href:        '/hazardous-waste',
    category:    'safety',
    parent:      'hazardous-waste',
    enabled:     true,
    comingSoon:  false,
  },

  // Legacy near-miss surface — kept enabled during the Phase 1 → Phase 6
  // transition so existing tenants don't lose their bookmarks. The new
  // unified `incidents` module (above) replaces it; remove this entry
  // when the legacy near_misses table is dropped.
  {
    id:          'near-miss',
    name:        'Near-Miss Reporting',
    description: 'Capture and track near-miss incidents',
    href:        '/near-miss',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'AlertOctagon',
    color:       'emerald',
  },
  {
    id:          'hot-work',
    name:        'Hot Work Permit',
    description: 'OSHA 1910.252 + NFPA 51B hot work authorization',
    href:        '/hot-work',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'Flame',
    color:       'orange',
  },
  {
    id:          'hot-work-status',
    name:        'Hot Work Status Board',
    description: 'Live big-monitor view of active hot-work permits + fire-watch timers',
    href:        '/hot-work/status',
    category:    'safety',
    parent:      'hot-work',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'jha',
    name:        'Job Hazard Analysis',
    description: 'Task-level hazard breakdowns',
    href:        '/jha',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'ClipboardList',
    color:       'teal',
  },

  // ── Toolbox Talks module ───────────────────────────────────────────────
  // Daily pre-shift safety briefing + sign-in roster. Talk content is
  // produced by a weekly server-side cron (Sonnet) — there is
  // intentionally no client-side generate button. Workers and admins
  // can read + sign; only the cron creates new talks.
  {
    id:          'toolbox-talks',
    name:        'Toolbox Talks',
    description: 'AI-generated daily safety briefings + crew sign-in sheet',
    href:        '/toolbox-talks',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'Megaphone',
    color:       'sky',
  },
  {
    id:          'strike',
    name:        'STRIKE',
    description: 'Microlearning and task-readiness for high-risk work',
    href:        '/strike',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'GraduationCap',
    color:       'emerald',
  },

  // ── Reports / oversight ─────────────────────────────────────────────────
  // The scorecard is the cross-module trend view aimed at safety directors.
  // Admin-gated at the route level — the drawer surfaces it here so admins
  // can find it; non-admins who land on the route see "Admins only."
  {
    id:          'reports-scorecard',
    name:        'EHS Scorecard',
    description: 'Trends across permits, atmospheric tests, and equipment',
    href:        '/admin/scorecard',
    category:    'reports',
    enabled:     true,
    comingSoon:  false,
    icon:        'BarChart3',
    color:       'slate',
  },
  {
    id:          'reports-insights',
    name:        'Risk Intelligence',
    description: 'Where to look harder — fail-rate hot spots, anomaly detection, supervisor mix',
    href:        '/admin/insights',
    category:    'reports',
    enabled:     true,
    comingSoon:  false,
    icon:        'Sparkles',
    color:       'slate',
  },
  {
    id:          'reports-compliance-bundle',
    name:        'Compliance Bundles',
    description: 'Inspector-ready PDF — every permit in a date range with chain-of-custody hashing',
    href:        '/admin/compliance-bundle',
    category:    'reports',
    enabled:     true,
    comingSoon:  false,
    icon:        'FileArchive',
    color:       'slate',
  },
  {
    id:          'reports-inspector',
    name:        'Inspector access',
    description: 'Mint a signed read-only URL for an OSHA / Cal-OSHA inspector',
    href:        '/admin/inspector',
    category:    'reports',
    enabled:     true,
    comingSoon:  false,
    icon:        'ShieldCheck',
    color:       'slate',
  },
  {
    id:          'admin-loto-devices',
    name:        'LOTO devices',
    description: 'Physical lock + tag inventory and per-checkout ownership log',
    href:        '/admin/loto-devices',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Tag',
    color:       'slate',
  },
  {
    id:          'admin-workers',
    name:        'Workers',
    description: 'Shop-floor worker roster — names, employee IDs, training status',
    href:        '/admin/workers',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Users',
    color:       'slate',
  },

  // ── Admin / configuration ───────────────────────────────────────────────
  {
    id:          'admin-configuration',
    name:        'Configuration',
    description: 'Org-level settings — work-order URL template, etc.',
    href:        '/admin/configuration',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Settings',
    color:       'slate',
  },
  {
    id:          'admin-webhooks',
    name:        'Webhooks',
    description: 'Outbound HTTP POST on permit + test lifecycle',
    href:        '/admin/webhooks',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Webhook',
    color:       'slate',
  },
  {
    id:          'admin-training',
    name:        'Training records',
    description: '§1910.146(g) certifications — entrant / attendant / supervisor / rescuer',
    href:        '/admin/training-records',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'GraduationCap',
    color:       'slate',
  },
  {
    id:          'admin-hygiene-log',
    name:        'Data Hygiene Log',
    description: 'One-off LOTO data ops — decommissions, renames, FK repairs',
    href:        '/admin/hygiene-log',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Brush',
    color:       'slate',
  },
  {
    id:          'admin-ai-usage',
    name:        'AI usage',
    description: 'Your tenant’s Claude invocations: trend, surface breakdown, today’s spend vs cap',
    href:        '/admin/ai-usage',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'BarChart3',
    color:       'slate',
  },
  {
    id:          'settings-notifications',
    name:        'Notifications',
    description: 'Enable Web Push for permit + atmospheric-test alerts',
    href:        '/settings/notifications',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Bell',
    color:       'slate',
  },
  {
    id:          'safety-boards',
    name:        'Safety boards',
    description: 'Internal threaded forums for safety discussion',
    href:        '/safety-boards',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
    icon:        'MessageSquare',
    color:       'indigo',
  },
  {
    id:          'manuals',
    name:        'User manuals',
    description: 'Module-by-module wiki + master changelog',
    href:        '/manuals',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'BookOpen',
    color:       'slate',
  },
  {
    id:          'support',
    name:        'Support',
    description: 'Report a bug — emails the maintainer',
    href:        '/support',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'LifeBuoy',
    color:       'slate',
  },
  // ── Module 3 admin surfaces ─────────────────────────────────────────
  {
    id:          'admin-sso',
    name:        'Single sign-on',
    description: 'SAML or OIDC federation for tenant logins',
    href:        '/admin/sso',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'ShieldCheck',
    color:       'slate',
  },
  {
    id:          'admin-scim',
    name:        'SCIM tokens',
    description: 'SCIM 2.0 bearer tokens for workforce provisioning',
    href:        '/admin/scim',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'KeyRound',
    color:       'slate',
  },
  {
    id:          'admin-cmms',
    name:        'CMMS integrations',
    description: 'Webhook-driven CMMS sync (Maximo / SAP PM / eMaint / generic)',
    href:        '/admin/cmms',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Cable',
    color:       'slate',
  },
  {
    id:          'admin-bbs-dashboard',
    name:        'BBS leading indicators',
    description: 'Safe-to-unsafe ratio + follow-ups-due dashboard',
    href:        '/admin/bbs/dashboard',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Eye',
    color:       'slate',
  },
  {
    id:          'admin-contractors',
    name:        'Contractors',
    description: 'Host-procedure acknowledgement and prequalification',
    href:        '/admin/contractors',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
    icon:        'Building2',
    color:       'slate',
  },
]

// ─── Lookups ───────────────────────────────────────────────────────────────
//
// Three visibility states encoded in two booleans:
//
//   enabled=true,  comingSoon=false, href=string  → live + clickable
//   enabled=true,  comingSoon=true,  href=null    → advertised, not ready
//   enabled=false, *                              → hidden (per-tenant off)
//
// isFeatureEnabled  → "is this feature visible at all" (drawer surface)
// isFeatureAccessible → "can a user click this and reach a real route"
//                       (route guards / conditional UI for live features)
// Coming-soon features pass isFeatureEnabled but NOT isFeatureAccessible.

export function getFeature(id: string): FeatureDef | null {
  return FEATURES.find(f => f.id === id) ?? null
}

export function isFeatureEnabled(id: string): boolean {
  return getFeature(id)?.enabled ?? false
}

// True only when the feature is enabled, not advertised-as-coming, AND has
// an actual route to navigate to. Useful for multi-tenant route guards
// (when a tenant disables a feature, every link to it should fail closed).
export function isFeatureAccessible(id: string): boolean {
  const f = getFeature(id)
  if (!f) return false
  return f.enabled && !f.comingSoon && f.href !== null
}

// All enabled features in the category — flat. Includes both modules
// and their children. Used by tests that verify catalog membership.
export function getFeaturesByCategory(category: FeatureCategory): FeatureDef[] {
  return FEATURES.filter(f => f.category === category && f.enabled)
}

// Top-level modules in the category — features without a parent. The
// drawer iterates these to render the outer rows; each module's children
// are fetched via getChildren(moduleId).
export function getModules(category: FeatureCategory): FeatureDef[] {
  return FEATURES.filter(f => f.category === category && f.enabled && !f.parent)
}

// Children of a module. Coming-Soon entries are rare here but allowed
// (they'd render as disabled child rows). Returns in registry order.
export function getChildren(parentId: string): FeatureDef[] {
  return FEATURES.filter(f => f.parent === parentId && f.enabled)
}

// ─── Multi-tenant resolver hook ────────────────────────────────────────────
// Today this is a passthrough — feature flags come from the static catalog
// above. When multi-tenant lands, replace this body with a Supabase query
// against the (yet-to-be-created) tenant_features table:
//
//   const { data } = await supabase
//     .from('tenant_features')
//     .select('feature_id, enabled')
//     .eq('tenant_id', tenantId)
//
// then merge: tenant overrides win over the static `enabled`. Coming-Soon
// stays a global concept (a feature isn't released yet for ANY tenant) so
// don't expose it as a per-tenant flag.
//
// Keeping the resolver async-shaped so the eventual implementation doesn't
// require ripping out call sites — just await the resolver in a server
// component or a useEffect.
export async function resolveFeatureFlags(_tenantId?: string): Promise<Map<string, FeatureDef>> {
  // Single-tenant fallthrough.
  return new Map(FEATURES.map(f => [f.id, f]))
}
