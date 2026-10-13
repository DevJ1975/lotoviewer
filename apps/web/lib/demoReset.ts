// The demo-tenant reset's two lists: which tables it wipes, in foreign-key
// order, and which seed functions put the demo back. Used by
// /api/superadmin/tenants/[number]/reset-demo; the PGlite suite runs the
// wipe order against the real schema.
//
// FK ORDER:
//   Children (loto_energy_steps, loto_atmospheric_tests, …) before parents
//   (loto_equipment, loto_confined_space_permits, …). Order matters because
//   we use plain DELETE — no CASCADE — so a child row would block the
//   parent's delete.
//
// SEEDING:
//   Every seed function in SEED_FUNCTIONS runs, in order, against any tenant
//   with is_demo = true. A function missing from the database (42883 /
//   PGRST202) is skipped so a partially-migrated DB still resets.
//
//   This used to be gated on `tenant_number === '0002'`, which meant a second
//   demo tenant was wiped and never re-seeded — audit item A10 in
//   apps/web/docs/multi-tenancy-audit-plan.md. The seeds resolve their own
//   tenant by `is_demo`, so the tenant-number check was both wrong and
//   redundant.
//
// WIPED BUT DELIBERATELY NOT SEEDED:
//   Five tables in DELETE_ORDER have no seed and should not get one. They
//   are registrations, audit trails or work in progress, not demo content,
//   and an empty table after a reset is the correct outcome:
//     - loto_hygiene_log         written only by hand-run hygiene SQL
//     - loto_push_subscriptions  per-browser Web Push registrations
//     - loto_webhook_subscriptions  per-integration endpoints
//     - ms_compliance_evaluations, ms_evidence  compliance evaluations hold
//       their nonconformity in place (migration 298), so they must go before
//       nonconformities can; the nightly scheduler opens fresh ones
//
//   Anything else added to DELETE_ORDER needs a matching seed, or the module
//   it belongs to silently empties on every reset and never comes back. That
//   is exactly how Equipment Readiness was lost.

export const DELETE_ORDER: readonly string[] = [
  // Children (FK to a parent in this list).
  'loto_energy_steps',
  'loto_atmospheric_tests',
  'loto_confined_space_entries',
  'loto_device_checkouts',
  'loto_meter_alerts',
  'equipment_inspection_responses',
  'equipment_evidence',
  'equipment_repairs',
  'equipment_defects',
  'equipment_inspections',
  'equipment_operator_authorizations',
  'bbs_observation_photos',
  'bbs_observation_actions',
  'bbs_observations',
  'position_training_requirements',
  'position_equipment_requirements',
  'worker_position_assignments',
  // ISO 14001 EMS registers (migrations 204-207), children first.
  // seed_wls_iso14001_demo() re-creates these with deterministic ids and
  // ON CONFLICT DO NOTHING, so without the wipe an edited demo row would
  // survive a "reset" forever. compliance_calendar_obligations is
  // deliberately NOT wiped — it also holds system-seeded rows this route
  // cannot restore.
  'iso14001_clause_evidence',
  'environmental_objective_readings',
  'ms_evidence',
  'ms_compliance_evaluations',
  'nonconformity_actions',
  'nonconformities',
  'environmental_objectives',
  'environmental_aspects',
  'management_reviews',
  // Parents.
  'loto_equipment',
  'loto_confined_space_permits',
  'loto_confined_spaces',
  'loto_hot_work_permits',
  'loto_devices',
  'loto_gas_meters',
  'loto_reviews',
  'loto_training_records',
  'loto_webhook_subscriptions',
  'loto_push_subscriptions',
  'loto_hygiene_log',
  'worker_positions',
  'bbs_qr_locations',
  // Audit log goes last so the wipe itself is captured (the rows being
  // deleted include rows that recorded the deletes — the row counts in
  // the response are correct as of the start-of-request snapshot).
  'audit_log',
]

// Seed functions, in dependency order. seed_wls_demo() lays down the
// equipment, spaces and permits every later seed references, so it is first.
//
// Adding a seed migration means adding it here. A function that exists in the
// database but is not listed never runs on reset, so its module stays empty
// until someone calls it by hand.
export const SEED_FUNCTIONS = [
  'seed_wls_demo',
  'seed_wls_worker_readiness_demo',
  'seed_wls_incidents_demo',
  'seed_wls_near_miss_demo',
  'seed_wls_bbs_demo',
  'seed_wls_iso14001_demo',
  'seed_wls_equipment_readiness_demo',
] as const
