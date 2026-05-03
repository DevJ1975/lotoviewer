-- Migration 024: Per-permit sign-on token for the worker QR flow.
--
-- The token gives an entrant scanning the printed-permit QR access to a
-- self-service page where they identify themselves by name and log in /
-- out without going through the attendant or the full-app auth.
--
-- The token IS the auth — anyone holding the QR can write to the permit's
-- entries. That's the threat model we accept: the QR is on a printed
-- permit physically present at the worksite, and the API we wire to it
-- still validates that the named entrant is on the roster and has current
-- training records before allowing sign-in. Token gets revoked implicitly
-- when the permit is canceled or expires (the API checks at lookup time).
--
-- Hot-work permits intentionally don't get a token in this migration:
-- there's no entry log to write to (§1910.146(i)(4) doesn't apply to hot
-- work), and the fire-watch sign-on is meant to require an authenticated
-- session on file. v2 may revisit.
--
-- Idempotent — guards on add column / create function / create trigger /
-- create unique index. Re-running is a no-op.

-- ── 1. token column + index ────────────────────────────────────────────────

alter table public.loto_confined_space_permits
  add column if not exists signon_token text;

-- 32-hex-char tokens (16 random bytes). The format constraint guards
-- against accidental wrong-shape values being inserted (manual SQL,
-- restored backups, etc.) — the API also validates the format before
-- the DB roundtrip but having both is cheap insurance.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cs_permit_signon_token_format'
  ) then
    alter table public.loto_confined_space_permits
      add constraint cs_permit_signon_token_format
      check (signon_token is null or signon_token ~ '^[0-9a-f]{32}$');
  end if;
end $$;

-- Unique index for fast token-to-permit lookup. Partial so legacy rows
-- with NULL tokens (pre-migration) don't conflict.
create unique index if not exists idx_cs_permit_signon_token
  on public.loto_confined_space_permits(signon_token)
  where signon_token is not null;

-- ── 2. token generator ─────────────────────────────────────────────────────
--
-- pgcrypto's gen_random_bytes returns N random bytes; encode + lower
-- gives us the 32-char hex string we want. pgcrypto is enabled on
-- Supabase by default. If it isn't, the trigger falls back to using
-- gen_random_uuid (also a default Supabase extension) and stripping
-- dashes — same length, same character set, same security guarantee
-- (random 128 bits).

create or replace function public.next_signon_token()
  returns text
  language plpgsql
  volatile
as $$
begin
  -- Try pgcrypto first.
  begin
    return encode(gen_random_bytes(16), 'hex');
  exception when undefined_function then
    -- Fallback: hex of gen_random_uuid with dashes stripped.
    return replace(gen_random_uuid()::text, '-', '');
  end;
end $$;

-- ── 3. BEFORE INSERT trigger ───────────────────────────────────────────────
--
-- Populate signon_token on every new permit. Existing permits stay NULL
-- (they're already issued; their printed PDFs already exist with their
-- old QR pointing at the live permit page) — they don't get retrofitted
-- because the QR they print is fixed.
--
-- A backfill for in-flight permits (canceled_at IS NULL) is provided
-- below as a one-shot UPDATE — not idempotent in the sense that it
-- would generate new tokens on re-run, but harmless since active
-- permits issued before this migration didn't have QR sign-on so
-- their existing QR points to the live page anyway.

create or replace function public.set_permit_signon_token()
  returns trigger
  language plpgsql
as $$
begin
  if new.signon_token is null then
    new.signon_token := public.next_signon_token();
  end if;
  return new;
end $$;

drop trigger if exists trg_cs_permit_set_signon_token on public.loto_confined_space_permits;
create trigger trg_cs_permit_set_signon_token
  before insert on public.loto_confined_space_permits
  for each row
  execute function public.set_permit_signon_token();

-- ── 4. backfill for active permits ─────────────────────────────────────────
--
-- Active (un-canceled, un-expired) permits get a token retroactively so
-- the v2 admin can re-print their PDF with the new QR. Closed permits
-- are left alone — their tokens would never be used.
--
-- Skipped if the column already had values (i.e. this migration ran
-- before and added tokens; we don't want to churn them).

do $$
begin
  if exists (
    select 1 from public.loto_confined_space_permits
     where signon_token is null
       and canceled_at is null
       and expires_at > now()
    limit 1
  ) then
    update public.loto_confined_space_permits
       set signon_token = public.next_signon_token()
     where signon_token is null
       and canceled_at is null
       and expires_at > now();
  end if;
end $$;

-- ── 5. comment for future archaeologists ───────────────────────────────────

comment on column public.loto_confined_space_permits.signon_token is
  'Per-permit token (32 hex chars) used by the worker QR sign-on flow. The token IS the auth for /permit-signon/<token>; the API still validates roster + training before allowing writes. Token is implicitly revoked when canceled_at IS NOT NULL or expires_at < now().';
