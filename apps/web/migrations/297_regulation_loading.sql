-- Migration 297: atomic regulation loading for the Python service.
--
-- The service loads parts of the CFR into the shared knowledge base
-- (knowledge_documents / knowledge_chunks, migration 105) as the platform-level
-- `regulation_ingest` job. PostgREST cannot run several statements in one
-- transaction, and a section replaced non-atomically could be left deleted with
-- nothing inserted, so the writes are functions the service calls with the
-- service-role key:
--
--   replace_regulation_document  delete one section's rows and insert its new
--                                document + chunks, all or nothing
--   prune_regulation_documents   remove sections no longer in the part (repealed
--                                or removed), refusing to run on an empty keep-list
--   record_regulation_snapshot   record which eCFR snapshot a part now reflects,
--                                creating its regulation_update_checks row on
--                                first load (a seeded row for a part that was never
--                                loaded would make the freshness cron email an
--                                "out of date" alert immediately)
--
-- All three are service_role only. They write GLOBAL rows (tenant_id is null) of
-- the regulation source types only, so they can never touch a tenant's own
-- documents or a company policy.
--
-- Idempotent. Rollback: 297_rollback.sql.

begin;

create or replace function public.replace_regulation_document(
  p_source_type    text,
  p_title          text,
  p_jurisdiction   text,
  p_source_url     text,
  p_content_sha256 text,
  p_chunks         jsonb   -- [{ chunk_index, text, embedding: "[0.1,...]", token_count, metadata }]
) returns uuid
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_document uuid;
begin
  if p_source_type not in ('regulation', 'state_reg', 'dot', 'epa', 'rcra') then
    raise exception 'replace_regulation_document: % is not a regulation source type', p_source_type
      using errcode = '22023';
  end if;
  if p_source_url is null or length(btrim(p_source_url)) = 0 then
    raise exception 'replace_regulation_document: source_url is required' using errcode = '22023';
  end if;
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array'
     or jsonb_array_length(p_chunks) not between 1 and 2000 then
    raise exception 'replace_regulation_document: chunks must be an array of 1-2000 items'
      using errcode = '22023';
  end if;

  -- Only the global regulation rows for this exact URL: never a tenant's document.
  delete from public.knowledge_documents
   where tenant_id is null
     and source_url = p_source_url
     and source_type::text in ('regulation', 'state_reg', 'dot', 'epa', 'rcra');

  insert into public.knowledge_documents
    (tenant_id, source_type, title, jurisdiction, source_url, content_sha256, chunk_count)
  values
    (null, p_source_type::public.knowledge_source_type, p_title, p_jurisdiction, p_source_url,
     p_content_sha256, jsonb_array_length(p_chunks))
  returning id into v_document;

  insert into public.knowledge_chunks (document_id, chunk_index, text, embedding, token_count, metadata)
  select v_document,
         (c ->> 'chunk_index')::int,
         c ->> 'text',
         (c ->> 'embedding')::vector(1024),
         (c ->> 'token_count')::int,
         c -> 'metadata'
    from jsonb_array_elements(p_chunks) as c;

  return v_document;
end;
$$;

create or replace function public.prune_regulation_documents(
  p_url_prefix text,
  p_keep_urls  text[]
) returns int
language plpgsql
security definer set search_path = pg_catalog, public
as $$
declare
  v_deleted int;
begin
  -- A prune is "everything under this prefix that is not on the list". An empty
  -- list or a near-empty prefix would turn that into "delete everything", so the
  -- caller must have a real part in hand.
  if p_url_prefix is null or length(p_url_prefix) < 20 then
    raise exception 'prune_regulation_documents: url prefix is too short' using errcode = '22023';
  end if;
  if p_keep_urls is null or cardinality(p_keep_urls) = 0 then
    raise exception 'prune_regulation_documents: refusing to prune with an empty keep-list'
      using errcode = '22023';
  end if;

  delete from public.knowledge_documents
   where tenant_id is null
     and source_type::text in ('regulation', 'state_reg', 'dot', 'epa', 'rcra')
     and left(source_url, length(p_url_prefix)) = p_url_prefix
     and not (source_url = any (p_keep_urls));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.record_regulation_snapshot(
  p_source     text,
  p_title      text,
  p_ecfr_title text,
  p_ecfr_part  text,
  p_snapshot   date
) returns void
language plpgsql
security definer set search_path = pg_catalog, public
as $$
begin
  insert into public.regulation_update_checks
    (source, title, ecfr_title, ecfr_part, ingested_snapshot, ingested_at, latest_amendment,
     needs_update, last_checked_at)
  values
    (p_source, p_title, p_ecfr_title, p_ecfr_part, p_snapshot, now(), p_snapshot, false, now())
  on conflict (source) do update set
    ingested_snapshot = excluded.ingested_snapshot,
    ingested_at       = now(),
    latest_amendment  = greatest(coalesce(public.regulation_update_checks.latest_amendment, date '1900-01-01'),
                                 excluded.ingested_snapshot),
    -- Still behind if eCFR already has an amendment newer than what was just loaded.
    needs_update      = coalesce(public.regulation_update_checks.latest_amendment, date '1900-01-01')
                          > excluded.ingested_snapshot,
    last_checked_at   = now(),
    updated_at        = now();
end;
$$;

revoke all on function public.replace_regulation_document(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.prune_regulation_documents(text, text[]) from public, anon, authenticated;
revoke all on function public.record_regulation_snapshot(text, text, text, text, date) from public, anon, authenticated;
grant execute on function public.replace_regulation_document(text, text, text, text, text, jsonb) to service_role;
grant execute on function public.prune_regulation_documents(text, text[]) to service_role;
grant execute on function public.record_regulation_snapshot(text, text, text, text, date) to service_role;

notify pgrst, 'reload schema';

commit;
