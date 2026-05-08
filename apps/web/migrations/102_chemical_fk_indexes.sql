-- Migration 095: targeted FK indexes flagged by Supabase's performance
-- linter after applying 082-094.
--
-- The linter raised an INFO for every FK without a covering index. Most
-- of those are user-id columns (created_by, updated_by, approved_by,
-- disposed_by, triggered_by, printed_by, requested_by, …) where:
--   - Parent deletes from auth.users are rare (account deletes, GDPR).
--   - Insert volume is high enough that adding 8-10 user-FK indexes
--     materially raises maintenance cost.
--   - The FK action is ON DELETE SET NULL — fast even without an index
--     because the planner uses a sequential scan once.
--
-- We deliberately skip those.
--
-- Worth indexing (these are actively joined / scanned on cascade):
--   - chemical_products.active_sds_id            — joined by detail page
--   - chemical_max_allowable_quantities.product_id — joined in MAQ view
--   - chemical_sds_documents.superseded_by        — version-history walk
--   - chemical_sds_revision_checks.baseline_sds_id — drift-detail joins
--   - chemical_sds_revision_checks.new_sds_id     — drift-detail joins
--   - chemical_inventory_items.assigned_to        — worker handover lookup
--
-- Idempotent — every index uses IF NOT EXISTS.

create index if not exists idx_chem_products_active_sds
  on public.chemical_products(active_sds_id)
  where active_sds_id is not null;

create index if not exists idx_chem_maq_product
  on public.chemical_max_allowable_quantities(product_id)
  where product_id is not null;

create index if not exists idx_chem_sds_superseded_by
  on public.chemical_sds_documents(superseded_by)
  where superseded_by is not null;

create index if not exists idx_chem_drift_baseline_sds
  on public.chemical_sds_revision_checks(baseline_sds_id)
  where baseline_sds_id is not null;

create index if not exists idx_chem_drift_new_sds
  on public.chemical_sds_revision_checks(new_sds_id)
  where new_sds_id is not null;

create index if not exists idx_chem_inv_assigned_to
  on public.chemical_inventory_items(assigned_to)
  where assigned_to is not null;
