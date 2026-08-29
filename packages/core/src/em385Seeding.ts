// Pure transform that turns the EM-385 requirements catalog into the register
// rows a newly-created project starts with. Kept I/O-free so it is trivially
// unit-testable; the API route reads the catalog from the DB and bulk-inserts
// the result (see app/api/em385/projects/route.ts).
//
// Rule: a project's register is seeded from the catalog rows that (a) match the
// project's edition and (b) are flagged default_required. Optional /
// as-applicable requirements can be added later as custom items.

import type { Em385Category, Em385Edition, Em385RequirementRow } from './em385'

// The minimal catalog shape the planner needs.
export type Em385CatalogEntry = Pick<
  Em385RequirementRow,
  'id' | 'edition' | 'category' | 'title' | 'default_required'
>

// The insert shape for em385_register_items. status is always 'not_started' at
// seed time; dates/version/links are filled in by users as work progresses.
export interface Em385RegisterSeedItem {
  tenant_id:      string
  project_id:     string
  requirement_id: string
  title:          string
  category:       Em385Category
  status:         'not_started'
}

export function planRegisterSeed(
  catalog: ReadonlyArray<Em385CatalogEntry>,
  args: { projectId: string; tenantId: string; edition: Em385Edition },
): Em385RegisterSeedItem[] {
  return catalog
    .filter(row => row.edition === args.edition && row.default_required)
    .map(row => ({
      tenant_id:      args.tenantId,
      project_id:     args.projectId,
      requirement_id: row.id,
      title:          row.title,
      category:       row.category,
      status:         'not_started' as const,
    }))
}
