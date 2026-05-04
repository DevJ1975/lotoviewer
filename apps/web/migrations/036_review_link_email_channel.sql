-- Migration 036: Track which channel sent each review-link invite.
--
-- 'auto'   — Resend send via /api/admin/review-links (the default).
-- 'manual' — Admin chose "Open in your mail app" / "Copy email text"
--            and delivered through their own email client. The row
--            still exists (token + URL still valid); we just
--            recorded that the OUTBOUND notification went through a
--            different channel so the panel UI can label it
--            accordingly ("Sent manually" badge instead of the
--            amber "Pending send" badge that means "we tried Resend
--            but no provider id came back").
--
-- Defaults to 'auto' for every existing row + every future row that
-- doesn't pass an explicit channel.
--
-- Idempotent — guards on add column / backfill / check constraint.
-- Re-running is a no-op.

begin;

alter table public.loto_review_links
  add column if not exists email_channel text not null default 'auto';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'loto_review_links_email_channel_check'
  ) then
    alter table public.loto_review_links
      add constraint loto_review_links_email_channel_check
      check (email_channel in ('auto', 'manual'));
  end if;
end $$;

-- Belt-and-suspenders backfill. Production rows already have the
-- column default applied at add-time; this catches any preview /
-- staging rows that were inserted out-of-order.
update public.loto_review_links
   set email_channel = 'auto'
 where email_channel is null;

notify pgrst, 'reload schema';
commit;
