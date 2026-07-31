import {
  getChildren,
  getModules,
  isFeatureAccessible,
  type FeatureCategory,
  type FeatureDef,
} from '@soteria/core/features'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

export type NavigationGroupId =
  | 'pinned'
  | 'daily-work'
  | 'hazards-incidents'
  | 'permits-controls'
  | 'reporting'
  | 'admin-people'
  | 'admin-platform'
  | 'admin-records'
  | 'administration'

export interface NavigationGroup {
  id: NavigationGroupId
  label: string
  description: string
  items: NavigationItem[]
}

export interface NavigationItem {
  feature: FeatureDef
  children: FeatureDef[]
  groupId: NavigationGroupId
  keywords: string[]
}

const GROUPS: Omit<NavigationGroup, 'items'>[] = [
  {
    id: 'pinned',
    label: 'Pinned',
    description: 'High-frequency launch points',
  },
  {
    id: 'daily-work',
    label: 'Daily Work',
    description: 'Field workflows teams open every shift',
  },
  {
    id: 'hazards-incidents',
    label: 'Hazards & Incidents',
    description: 'Report, investigate, and reduce risk',
  },
  {
    id: 'permits-controls',
    label: 'Permits & Controls',
    description: 'Controlled work and regulated materials',
  },
  {
    id: 'reporting',
    label: 'Reporting',
    description: 'Scorecards, insights, and compliance packages',
  },
  {
    id: 'admin-people',
    label: 'People & Training',
    description: 'Workers, contractors, and competency records',
  },
  {
    id: 'admin-platform',
    label: 'Platform & Integrations',
    description: 'Tenant configuration, identity, and outbound connections',
  },
  {
    id: 'admin-records',
    label: 'Records & Support',
    description: 'Evidence, device inventory, manuals, and help',
  },
  // Kept as the destination for CATEGORY_FALLBACKS so an unmapped module can
  // never fail to render. Nothing should actually land here — navigationCatalog
  // .test.ts fails the build if a top-level module reaches it, which is how
  // Administration silently grew to 16 rows in the first place.
  {
    id: 'administration',
    label: 'Administration',
    description: 'Tenant setup, records, manuals, and support',
  },
]

const MODULE_GROUPS: Record<string, NavigationGroupId> = {
  'my-safety-readiness': 'pinned',
  'toolbox-talks': 'pinned',
  strike: 'pinned',

  operator: 'daily-work',
  loto: 'daily-work',
  'equipment-readiness': 'daily-work',
  jha: 'daily-work',
  inspections: 'daily-work',
  'fleet-safety': 'daily-work',

  incidents: 'hazards-incidents',
  bbs: 'hazards-incidents',
  'near-miss': 'hazards-incidents',
  'risk-assessment': 'hazards-incidents',
  'safety-boards': 'hazards-incidents',

  'hot-work': 'permits-controls',
  'confined-spaces': 'permits-controls',
  chemicals: 'permits-controls',
  'hazardous-waste': 'permits-controls',
  'working-at-heights': 'permits-controls',
  prop65: 'permits-controls',
  em385: 'permits-controls',
  // Internal (no drawer row), but mapped so the coverage test can assert
  // MODULE_GROUPS is exhaustive without carving out an exception.
  'osha-reg-watch': 'reporting',

  'reports-scorecard': 'reporting',
  'reports-insights': 'reporting',
  'reports-compliance-bundle': 'reporting',
  'reports-compliance-calendar': 'reporting',
  'reports-inspector': 'reporting',

  'admin-workers': 'admin-people',
  'admin-contractors': 'admin-people',
  'admin-training': 'admin-people',
  'admin-training-competency-matrix': 'admin-people',

  'admin-configuration': 'admin-platform',
  'admin-sso': 'admin-platform',
  'admin-scim': 'admin-platform',
  'admin-webhooks': 'admin-platform',
  'admin-cmms': 'admin-platform',
  'admin-ai-usage': 'admin-platform',
  'settings-notifications': 'admin-platform',

  'admin-loto-devices': 'admin-records',
  'admin-hygiene-log': 'admin-records',
  'admin-bbs-dashboard': 'admin-records',
  manuals: 'admin-records',
  support: 'admin-records',
}

const CATEGORY_FALLBACKS: Record<FeatureCategory, NavigationGroupId> = {
  safety: 'daily-work',
  reports: 'reporting',
  admin: 'administration',
}

const KEYWORDS: Record<string, string[]> = {
  loto: ['lockout', 'tagout', 'equipment', 'placards', 'status', 'print'],
  'equipment-readiness': ['pit', 'pre-use', 'inspection', 'defects', 'qr'],
  'risk-assessment': ['risk', 'hazards', 'heat map', 'controls'],
  incidents: ['incident', 'investigation', 'osha', 'corrective action'],
  bbs: ['behavior', 'observation', 'coaching'],
  chemicals: ['chemical', 'sds', 'inventory', 'tier ii', 'restricted'],
  'hazardous-waste': ['waste', 'manifest', 'rcra', 'epa', 'cers', 'cupa', 'dtsc', 'accumulation', 'biennial', 'tier ii'],
  'working-at-heights': ['fall protection', 'harness', 'lanyard', 'srl', 'ladder', 'anchor', 'rescue', 'osha 1910.28', 'osha 1926.501', 'ansi z359'],
  'hot-work': ['permit', 'fire watch', 'spark'],
  'confined-spaces': ['permit', 'entry', 'atmosphere'],
  jha: ['job hazard analysis', 'task', 'hazard'],
  'fleet-safety': ['fleet', 'vehicle', 'truck', 'driver', 'journey', 'trip', 'road', 'dot', 'hazmat', 'placard', 'license', 'insurance', 'registration'],
  strike: ['training', 'microlearning', 'lesson'],
  'toolbox-talks': ['talks', 'briefing', 'training'],
  'safety-boards': ['boards', 'announcements', 'discussions'],
  manuals: ['help', 'wiki', 'changelog'],
  support: ['help', 'ticket', 'support'],
}

const CATEGORY_ORDER: FeatureCategory[] = ['safety', 'reports', 'admin']

function isVisibleFeature(feature: FeatureDef, tenantModules: Record<string, boolean> | null | undefined) {
  if (feature.internal) return false
  return feature.comingSoon || isModuleVisible(feature.id, tenantModules)
}

function visibleChildren(parentId: string, tenantModules: Record<string, boolean> | null | undefined) {
  return getChildren(parentId).filter(child => isVisibleFeature(child, tenantModules))
}

function keywordsFor(feature: FeatureDef, children: FeatureDef[]) {
  return [
    feature.id,
    feature.name,
    feature.description,
    feature.href ?? '',
    ...(KEYWORDS[feature.id] ?? []),
    ...children.flatMap(child => [
      child.id,
      child.name,
      child.description,
      child.href ?? '',
      ...(KEYWORDS[child.id] ?? []),
    ]),
  ].filter(Boolean)
}

export function getNavigationGroups(
  tenantModules: Record<string, boolean> | null | undefined,
): NavigationGroup[] {
  const buckets = new Map<NavigationGroupId, NavigationItem[]>()

  for (const category of CATEGORY_ORDER) {
    for (const feature of getModules(category)) {
      if (!isVisibleFeature(feature, tenantModules)) continue
      const children = visibleChildren(feature.id, tenantModules)
      const groupId = MODULE_GROUPS[feature.id] ?? CATEGORY_FALLBACKS[feature.category]
      const item: NavigationItem = {
        feature,
        children,
        groupId,
        keywords: keywordsFor(feature, children),
      }
      buckets.set(groupId, [...(buckets.get(groupId) ?? []), item])
    }
  }

  return GROUPS.map(group => ({
    ...group,
    items: buckets.get(group.id) ?? [],
  })).filter(group => group.items.length > 0)
}

export function getNavigationCommandItems(
  tenantModules: Record<string, boolean> | null | undefined,
) {
  return getNavigationGroups(tenantModules).flatMap(group =>
    group.items.flatMap(item => {
      const parent = isFeatureAccessible(item.feature.id) && item.feature.href
        ? [{
            feature: item.feature,
            href: item.feature.href,
            group,
            parent: null as FeatureDef | null,
            keywords: item.keywords,
          }]
        : []

      const children = item.children
        .filter(child => isFeatureAccessible(child.id) && child.href)
        .map(child => ({
          feature: child,
          href: child.href!,
          group,
          parent: item.feature,
          keywords: keywordsFor(child, []),
        }))

      return [...parent, ...children]
    }),
  )
}
