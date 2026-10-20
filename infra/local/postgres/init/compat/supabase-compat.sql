-- Stand-ins for the handful of Supabase-provided objects the application
-- migrations assume already exist. Surveyed from apps/web/migrations:
--   auth.users(id)   foreign-key target in 83 files, plus email / deleted_at
--   auth.uid()       used by RLS policies in 46 files
--   storage.*        bucket rows and policies in 18 files
--   cron.*           pg_cron scheduling in 2 files
--   net.http_post    webhook / push triggers in 4 files
--   anon, authenticated, service_role roles
--
-- These exist only so the historical migrations apply to plain Postgres.
-- On AWS the real services replace them: Cognito for users, S3 for storage,
-- pg_cron on RDS for cron, and an outbox + queue for webhooks.

-- ── Roles ───────────────────────────────────────────────────────────────
-- PostgREST connects as `authenticator` and switches to one of the three
-- request roles per call, which is what makes RLS policies see the caller.
create role anon          nologin noinherit;
create role authenticated nologin noinherit;
create role service_role  nologin noinherit bypassrls;
create role authenticator noinherit login password :'authenticator_password';
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ── auth ────────────────────────────────────────────────────────────────
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id         uuid        primary key default gen_random_uuid(),
  email      text        unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Same contract as Supabase: the caller's id comes from the verified JWT
-- claims that PostgREST publishes to the session for each request.
create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ),
    ''
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ── storage ─────────────────────────────────────────────────────────────
-- Metadata tables only. File bytes live in the S3-compatible store; the
-- migrations insert bucket rows and attach policies to storage.objects.
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text        primary key,
  name               text        not null unique,
  public             boolean     not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table storage.objects (
  id         uuid        primary key default gen_random_uuid(),
  bucket_id  text        references storage.buckets (id),
  name       text,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

-- ── cron ────────────────────────────────────────────────────────────────
-- Records schedules so the migrations that register jobs apply. Nothing runs
-- them locally; on RDS the real pg_cron extension takes over.
create schema cron;

create table cron.job (
  jobid    bigserial primary key,
  jobname  text unique,
  schedule text not null,
  command  text not null
);

create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$
  insert into cron.job (jobname, schedule, command)
  values (job_name, schedule, command)
  on conflict (jobname) do update
    set schedule = excluded.schedule, command = excluded.command
  returning jobid
$$;

create function cron.unschedule(job_id bigint) returns boolean
language sql as $$
  with removed as (delete from cron.job where jobid = job_id returning 1)
  select exists (select 1 from removed)
$$;

-- ── net ─────────────────────────────────────────────────────────────────
-- Same signature as pg_net's http_post. Locally it only reports that nothing
-- was sent, so a trigger that reaches it is visible rather than silent.
create schema net;

create function net.http_post(
  url                  text,
  body                 jsonb   default '{}'::jsonb,
  params               jsonb   default '{}'::jsonb,
  headers              jsonb   default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 5000
) returns bigint
language plpgsql as $$
begin
  raise notice 'net.http_post stub: not sent to %', url;
  return 0;
end
$$;
