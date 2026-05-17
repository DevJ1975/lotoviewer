-- Migration 186: Lock the anon role out of the Phase 1 RPCs.
--
-- Migrations 180-184 revoked execute from `public` and `authenticated`
-- on the destructive RPCs, but `anon` is a distinct Supabase role with
-- its own grant when a security-definer function is created. Without
-- this revoke an unauthenticated browser session could call
-- supabase.rpc('merge_members', …) and bypass the API route's admin
-- gate entirely.
--
-- The three sync trigger functions (sync_profile_to_members,
-- sync_loto_worker_to_members, sync_membership_to_members) were
-- created without any explicit grant block in 180, so they kept the
-- default PUBLIC grant. They are trigger-only and have no business
-- being reachable from PostgREST. Revoke them too.
--
-- A fresh apply of 180-184 from this commit forward already includes
-- the anon revoke (see those files); this migration is the fix-forward
-- for environments that already ran the earlier versions.

begin;

revoke all on function public.merge_members(uuid, uuid, uuid, text) from anon;
revoke all on function public.reconcile_members_backfill(uuid) from anon;
revoke all on function public.audit_member_drift() from anon;

revoke all on function public.sync_profile_to_members() from public, anon, authenticated;
revoke all on function public.sync_loto_worker_to_members() from public, anon, authenticated;
revoke all on function public.sync_membership_to_members() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
