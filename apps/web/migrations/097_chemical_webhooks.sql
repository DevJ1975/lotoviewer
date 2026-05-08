-- Migration 090: outbound webhooks on chemical lifecycle events.
--
-- Reuses the public.fire_webhooks(text, jsonb) function shipped in
-- migration 013. Triggers below classify the change and emit one of
-- the chemical.* event names listed in the documentation comment;
-- subscriptions opt in by adding the event name to their `events[]`
-- array. Soft-fails when pg_net isn't installed (per 013's design).
--
-- Event names introduced here:
--
--   chemical.product_created
--   chemical.product_archived
--   chemical.product_unarchived
--   chemical.container_requested      — status flips to 'requested' (or insert with that status)
--   chemical.container_approved       — requested → in_stock
--   chemical.container_rejected       — requested → rejected
--   chemical.container_disposed       — any → disposed
--   chemical.exposure_logged          — chemical_exposure_events insert
--   chemical.sds_revision_pending     — new chemical_sds_documents row whose
--                                       source='ai_fetch' AND parse_review_status='pending'
--
-- Idempotent — drops + recreates the trigger functions, idempotent
-- triggers via DROP IF EXISTS.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. chemical_products lifecycle
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.chemical_products_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.fire_webhooks('chemical.product_created', to_jsonb(NEW));
  elsif TG_OP = 'UPDATE' then
    if NEW.archived_at is not null and OLD.archived_at is null then
      perform public.fire_webhooks('chemical.product_archived',  to_jsonb(NEW));
    elsif NEW.archived_at is null and OLD.archived_at is not null then
      perform public.fire_webhooks('chemical.product_unarchived', to_jsonb(NEW));
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_chem_products_webhook on public.chemical_products;
create trigger trg_chem_products_webhook
  after insert or update on public.chemical_products
  for each row
  execute function public.chemical_products_emit_webhooks();

-- ──────────────────────────────────────────────────────────────────────────
-- 2. chemical_inventory_items lifecycle
-- ──────────────────────────────────────────────────────────────────────────
--
-- Status transitions out of 'requested' fire approve/reject; flips
-- into 'disposed' fire disposed. Fresh inserts with status='requested'
-- fire `container_requested` so the audit trail mirrors what the API
-- pushes to admins.

create or replace function public.chemical_inv_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.status = 'requested' then
      perform public.fire_webhooks('chemical.container_requested', to_jsonb(NEW));
    end if;
  elsif TG_OP = 'UPDATE' then
    if OLD.status = 'requested' and NEW.status = 'in_stock' then
      perform public.fire_webhooks('chemical.container_approved', to_jsonb(NEW));
    elsif OLD.status = 'requested' and NEW.status = 'rejected' then
      perform public.fire_webhooks('chemical.container_rejected', to_jsonb(NEW));
    end if;
    if OLD.status <> 'disposed' and NEW.status = 'disposed' then
      perform public.fire_webhooks('chemical.container_disposed', to_jsonb(NEW));
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_chem_inv_webhook on public.chemical_inventory_items;
create trigger trg_chem_inv_webhook
  after insert or update on public.chemical_inventory_items
  for each row
  execute function public.chemical_inv_emit_webhooks();

-- ──────────────────────────────────────────────────────────────────────────
-- 3. chemical_exposure_events lifecycle
-- ──────────────────────────────────────────────────────────────────────────

create or replace function public.chemical_exposure_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if TG_OP = 'INSERT' then
    perform public.fire_webhooks('chemical.exposure_logged', to_jsonb(NEW));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_chem_exposure_webhook on public.chemical_exposure_events;
create trigger trg_chem_exposure_webhook
  after insert on public.chemical_exposure_events
  for each row
  execute function public.chemical_exposure_emit_webhooks();

-- ──────────────────────────────────────────────────────────────────────────
-- 4. chemical_sds_documents — drift detection
-- ──────────────────────────────────────────────────────────────────────────
--
-- Only fire on the row that the drift cron INSERTS — source='ai_fetch'
-- and parse_review_status='pending'. Manual SDS uploads (source='upload')
-- already get the existing approved-on-create flow and the user is
-- present, so no async push is needed.

create or replace function public.chemical_sds_emit_webhooks()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  if TG_OP = 'INSERT'
     and NEW.source = 'ai_fetch'
     and NEW.parse_review_status = 'pending' then
    perform public.fire_webhooks('chemical.sds_revision_pending', to_jsonb(NEW));
  end if;
  return NEW;
end $$;

drop trigger if exists trg_chem_sds_webhook on public.chemical_sds_documents;
create trigger trg_chem_sds_webhook
  after insert on public.chemical_sds_documents
  for each row
  execute function public.chemical_sds_emit_webhooks();

-- Update the table comment so superadmins setting up subscriptions
-- can see the available event names without grepping migrations.

comment on table public.loto_webhook_subscriptions is
  'Outbound webhook subscriptions. Known events:
   permit.created, permit.signed, permit.canceled,
   test.recorded, test.failed,
   chemical.product_created, chemical.product_archived, chemical.product_unarchived,
   chemical.container_requested, chemical.container_approved,
   chemical.container_rejected, chemical.container_disposed,
   chemical.exposure_logged, chemical.sds_revision_pending';

notify pgrst, 'reload schema';

commit;
