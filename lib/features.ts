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
}

// ─── The catalog ───────────────────────────────────────────────────────────
// Order within a category determines drawer order; order within a parent
// determines child order. New features get appended; reordering here
// reorders the UI immediately.
export const FEATURES: FeatureDef[] = [
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

  // ── Confined Spaces module + sub-pages ──────────────────────────────────
  {
    id:          'confined-spaces',
    name:        'Confined Spaces',
    description: 'OSHA 1910.146 permit-required entries',
    href:        '/confined-spaces',
    category:    'safety',
    enabled:     true,
    comingSoon:  false,
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

  // ── Coming-soon modules ─────────────────────────────────────────────────
  {
    id:          'near-miss',
    name:        'Near-Miss Reporting',
    description: 'Capture and track near-miss incidents',
    href:        null,
    category:    'safety',
    enabled:     true,
    comingSoon:  true,
  },
  {
    id:          'hot-work',
    name:        'Hot Work Permit',
    description: 'OSHA 1910.252 hot work authorization',
    href:        null,
    category:    'safety',
    enabled:     true,
    comingSoon:  true,
  },
  {
    id:          'jha',
    name:        'Job Hazard Analysis',
    description: 'Task-level hazard breakdowns',
    href:        null,
    category:    'safety',
    enabled:     true,
    comingSoon:  true,
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
  },
  {
    id:          'admin-webhooks',
    name:        'Webhooks',
    description: 'Outbound HTTP POST on permit + test lifecycle',
    href:        '/admin/webhooks',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
  },
  {
    id:          'settings-notifications',
    name:        'Notifications',
    description: 'Enable Web Push for permit + atmospheric-test alerts',
    href:        '/settings/notifications',
    category:    'admin',
    enabled:     true,
    comingSoon:  false,
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
