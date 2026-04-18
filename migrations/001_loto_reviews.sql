-- Migration 001: loto_reviews table for digital signature workflow
-- Run against your Supabase project in the SQL editor

create table if not exists public.loto_reviews (
  id             uuid primary key default gen_random_uuid(),
  department     text not null,
  reviewer_name  text,
  reviewer_email text,
  signed_at      timestamptz,
  approved       boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now()
);

-- Index for fast department lookups
create index if not exists loto_reviews_department_idx on public.loto_reviews (department);
create index if not exists loto_reviews_created_at_idx  on public.loto_reviews (created_at desc);

-- Enable Row Level Security
alter table public.loto_reviews enable row level security;

-- Allow any authenticated or anonymous user to insert a review (submit a signature)
create policy "allow_insert_reviews" on public.loto_reviews
  for insert
  with check (true);

-- Allow anyone to read reviews (dashboard visibility)
create policy "allow_read_reviews" on public.loto_reviews
  for select
  using (true);

-- Only service-role can update or delete (no accidental overwrites from the client)
-- (no update/delete policy = blocked for anon/authenticated)
