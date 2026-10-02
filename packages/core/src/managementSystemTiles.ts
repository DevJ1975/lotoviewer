// Dashboard tile selection by discipline. Each tile belongs to exactly one
// standard; an integrated management system shows the tiles of every
// standard together. Keeping the choice here means a combined ISO 14001 +
// ISO 45001 dashboard is a merge of tile lists, not a second dashboard.

import type { Discipline } from './managementSystem'

/** A standard a tile can belong to. `integrated` is a view, never a tile's home. */
export type TileDiscipline = Exclude<Discipline, 'integrated'>

/** One dashboard tile: a clickable status card for one register or workflow. */
export interface DashboardTile {
  /** Stable key, unique across all disciplines. */
  id: string
  discipline: TileDiscipline
  title: string
  /** The list page the tile opens. */
  href: string
}

/**
 * The tiles a dashboard for `discipline` shows, in registry order.
 * `integrated` shows every tile; `ems` and `ohs` show only their own.
 *
 * @param registry  All registered tiles, in display order.
 * @param discipline The management system the dashboard is for.
 */
export function tilesForDiscipline(
  registry: readonly DashboardTile[],
  discipline: Discipline,
): DashboardTile[] {
  if (discipline === 'integrated') return [...registry]
  return registry.filter(tile => tile.discipline === discipline)
}
