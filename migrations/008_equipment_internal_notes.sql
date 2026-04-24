-- Migration 008: Add a private internal_notes column to loto_equipment.
--
-- The existing `notes` column is public: it gets rendered into the red
-- warning block on the generated placard PDF, so anyone who sees the
-- printed placard sees those notes. Staff need a separate, private
-- scratchpad for per-placard context that should stay in the database
-- and never appear on the PDF — reminders about quirky isolation steps,
-- historical issues, scheduling notes, etc.
--
-- Stored as plain text to keep the query path simple. No RLS change
-- needed — the existing loto_equipment row policies already gate reads
-- and writes, and internal_notes is just another column on those rows.
-- Idempotent via `if not exists`.

alter table public.loto_equipment
  add column if not exists internal_notes text;

comment on column public.loto_equipment.internal_notes is
  'Private per-placard notes for staff. Never rendered on the placard PDF.';
