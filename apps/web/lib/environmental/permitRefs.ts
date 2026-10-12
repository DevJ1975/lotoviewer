import type { PermitRow } from './client'

// How the compliance suite refers to a permit. The permit itself lives in the EMS
// permit vault (the Permits register); the suite only names one, and offers a site's
// permits as a choice, for example when saying which permit covers an outfall.

export type PermitRef = Pick<PermitRow, 'id' | 'facility_id' | 'title' | 'permit_number' | 'retired_at'>

export function permitLabel(permit: Pick<PermitRow, 'title' | 'permit_number'>): string {
  return [permit.title, permit.permit_number].filter(Boolean).join(' ')
}

/**
 * The permits that could cover something at one site: that site's own, in force first,
 * then by name. A permit at another site is never offered, because its coverage is a
 * different place's.
 */
export function permitsAtSite<T extends PermitRef>(permits: readonly T[], siteId: string): T[] {
  return permits
    .filter(permit => permit.facility_id === siteId)
    .sort((a, b) => Number(a.retired_at !== null) - Number(b.retired_at !== null) || permitLabel(a).localeCompare(permitLabel(b)))
}
