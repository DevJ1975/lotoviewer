// The ISO 14001 EMS database (see _emsTestDatabase) with the Environmental Compliance Suite applied
// on top, in the order they ship: EMS 294-306, then the suite's 311-316. A real Postgres (PGlite),
// so the suite's constraints, policies and functions run as they do in production.
//
// Three things the EMS database does not have and the suite needs: the inspection engine (193) and the
// hazardous-waste tables (140, 142, 272), each applied where production applied it, before the facility
// migrations that give their tables a site; and the storage objects table that the checklist evidence
// policies attach to.

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import {
  BASE_MIGRATIONS, FACILITY_MIGRATIONS, FIXTURE_SQL, PHASE1_1_MIGRATIONS, PHASE1_MIGRATIONS, PHASE2_MIGRATIONS,
  PLATFORM_SQL, PRE_PHASE1_MIGRATIONS, migrationSql,
} from './_emsTestDatabase'

export const SUITE_MIGRATIONS = [
  '311_recover_legal_registry.sql',
  '312_environmental_site_profiles.sql',
  '313_stormwater_outfalls.sql',
  '314_environmental_checklists.sql',
  '315_compliance_calendar_v2.sql',
  '316_legal_register_environmental.sql',
] as const

const STORAGE_STANDINS = `
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function public.storage_path_tenant(name text) returns uuid language sql immutable as $$
  select case when split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then split_part(name, '/', 1)::uuid else null end $$;
grant all on all tables in schema storage to authenticated;
`

/** The hazardous-waste module's tables, which the manifest tracker builds on. */
export const HAZARDOUS_WASTE_MIGRATIONS = [
  '140_hazardous_waste_streams_and_containers.sql',
  '142_hazardous_waste_areas_inspections.sql',
  '272_hazardous_waste_stream_jurisdiction_acute_ldr.sql',
] as const

/**
 * A fresh database: the platform, EMS through its permit vault, then the suite. `extra` appends
 * migrations that are not in SUITE_MIGRATIONS yet (a branch of work adding its own), in order.
 */
export async function createSuiteDatabase(options: { extra?: readonly string[] } = {}): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(PLATFORM_SQL)
  await db.exec(STORAGE_STANDINS)
  const [first, ...rest] = BASE_MIGRATIONS
  for (const file of [first, '193_inspection_templates.sql', ...rest, ...HAZARDOUS_WASTE_MIGRATIONS]) await db.exec(migrationSql(file))
  await db.exec(FIXTURE_SQL)
  for (const file of [
    ...FACILITY_MIGRATIONS, ...PRE_PHASE1_MIGRATIONS, ...PHASE1_MIGRATIONS, ...PHASE1_1_MIGRATIONS, ...PHASE2_MIGRATIONS, ...SUITE_MIGRATIONS,
    ...(options.extra ?? []),
  ]) await db.exec(migrationSql(file))
  return db
}

export const rollbackOf = (file: string) => file.slice(0, 3) + '_rollback.sql'
