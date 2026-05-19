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
    id: 'administration',
    label: 'Administration',
    description: 'Tenant setup, records, manuals, and support',
  },
]

const MODULE_GROUPS: Record<string, NavigationGroupId> = {
  'my-safety-readiness': 'pinned',
  'toolbox-talks': 'pinned',
  strike: 'pinned',

  loto: 'daily-work',
  'equipment-readiness': 'daily-work',
  jha: 'daily-work',

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

  'reports-scorecard': 'reporting',
  'reports-insights': 'reporting',
  'reports-compliance-bundle': 'reporting',
  'reports-inspector': 'reporting',

  'admin-loto-devices': 'administration',
  'admin-workers': 'administration',
  'admin-configuration': 'administration',
  'admin-webhooks': 'administration',
  'admin-training': 'administration',
  'admin-hygiene-log': 'administration',
  'settings-notifications': 'administration',
  manuals: 'administration',
  support: 'administration',
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
