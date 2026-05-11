-- Migration 128: ai_invocations cache columns + budget_blocked status.
--
-- Adds cache_read_tokens and cache_write_tokens to enable proper cost
-- attribution now that the generation routes (mig 013-era surfaces +
-- the new cache_control on LOTO + CS) actually hit Anthropic prompt
-- caching. Without this, the dashboard can't show "cache hit %" or
-- discount the cached input tokens at the 10% rate Anthropic charges.
--
-- Also extends the status check to include 'budget_blocked' — the
-- per-tenant daily AI budget enforcement (in lib/ai/checkTenantBudget)
-- needs a way to log refused calls so they appear in the dashboard
-- and the operator can see "Acme tried to generate 47 times at 14:00
-- and got budget-blocked".

begin;

alter table public.ai_invocations
  add column if not exists cache_read_tokens   int,
  add column if not exists cache_write_tokens  int;

-- Drop + recreate the status check to include 'budget_blocked'.
-- Rows already in the table (success/rate_limited/error) all satisfy
-- the new constraint, so this is online-safe.
do $$
begin
  alter table public.ai_invocations
    drop constraint if exists ai_invocations_status_check;
  alter table public.ai_invocations
    add constraint ai_invocations_status_check
    check (status in ('success', 'rate_limited', 'error', 'budget_blocked'));
end $$;

comment on column public.ai_invocations.cache_read_tokens is
  'Anthropic prompt-cache hit tokens (cache_read_input_tokens from response.usage). Billed at 10% of base input rate.';
comment on column public.ai_invocations.cache_write_tokens is
  'Anthropic prompt-cache write tokens (cache_creation_input_tokens). Billed at 25% over base input rate.';

notify pgrst, 'reload schema';

commit;
