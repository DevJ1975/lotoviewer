# Protecting OSHA 301 PII on `incident_people` — design note

**Status:** Design only. Nothing here is applied. Migration 256 ships the one piece that needed
no judgment call (teaching both helpers about the investigation team); the column-protection
decision below is yours to make.

---

## The problem

`incident_people` stores OSHA 301 §I personal detail: `date_of_birth`, `gender`, `home_address`,
plus `body_part`, `injury_nature`, `treatment_facility`.

Its RLS policy (`migrations/060_incident_people.sql:88-100`) is plain tenant scope —
`for all to authenticated`, no column gating. The redaction everybody relies on lives in the
`incident_people_safe` **view**, which wraps the sensitive columns in `can_view_incident_pii()`.

A view is not an access control while the base table is reachable. Supabase exposes PostgREST to
the browser with the user's JWT, and this app already issues direct `supabase.from(...)` calls
client-side (`app/incidents/[id]/page.tsx`, `app/_components/Prop65IncidentBanner.tsx:32`), so the
capability is not theoretical. Any authenticated member can run:

```js
supabase.from('incident_people').select('full_name, date_of_birth, home_address, gender')
```

and read it for every injured person in their tenant. Not a cross-tenant leak — an
inside-the-tenant one, which is exactly what OSHA 1904.29(b)(7) privacy-case handling exists to
prevent.

Migration 201 fixed this defect class for care PHI with `can_view_care_phi()` and per-table
policies. The pattern exists here; it was never applied to `incident_people`.

## Why the obvious fix does not work

The instinct is `REVOKE SELECT (date_of_birth, gender, home_address) ON incident_people FROM
authenticated`, forcing everyone through the view.

That breaks the view. Migration `165_advisor_sweep.sql` set
`incident_people_safe` to `security_invoker = true` — deliberately, because as a definer view it
bypassed RLS and leaked across tenants. An invoker view runs with the **caller's** privileges, so
once the columns are revoked from `authenticated`, the view cannot read them either — including
for the admins and investigators who are supposed to see them. Everyone gets NULL.

So column REVOKE and the current invoker view are mutually exclusive. Any real fix has to pick
one of the following.

## Option A — split the PII into a child table (recommended)

Move `date_of_birth`, `gender`, `home_address` into `incident_people_pii`, keyed 1:1 on
`incident_people.id`, carrying its own `tenant_id` and `incident_id`.

```sql
create table public.incident_people_pii (
  person_id      uuid primary key references public.incident_people(id) on delete cascade,
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  incident_id    uuid not null references public.incidents(id) on delete cascade,
  date_of_birth  date,
  gender         text,
  home_address   text
);
```

with a row policy shaped exactly like 201's:

```sql
create policy people_pii_scope on public.incident_people_pii
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and public.can_view_incident_pii(incident_id)
  )
  with check ( ...same... );
```

`incident_people_safe` becomes a LEFT JOIN onto it, and keeps `security_invoker = true`: an
unauthorized caller simply gets no joined row, so the columns come back NULL — the same
redaction semantics the view already promises, now enforced by the database instead of by
convention.

**Why this one.** It uses only mechanisms this codebase already gets right (row-level policies +
`can_view_*` helpers), it does not disturb the 165 fix, and it makes the illegal state
unrepresentable rather than merely unselected.

**Cost.** A real data migration: backfill, then drop the three columns, then update the write
path in `api/incidents/[id]/people/route.ts:132-138` (which already has the `canSetPii` gate — it
would write to the child table instead) and the six routes that read the base table directly with
the service role (`osha/301`, `classify`, `classify/ai-suggest`, `care`, `safety-alerts`,
`people`). Those all use `supabaseAdmin()`, so they keep working, but their selects need the join.

**Sequencing.** Ship additively first (create + backfill + dual-write), verify, then drop the old
columns in a follow-up. Do not do it in one migration — migration 198 is the cautionary tale in
this repo for a consolidation that stopped after phase 1.

## Option B — definer view plus column REVOKE (faster, riskier)

Revoke the three columns from `authenticated`, and revert `incident_people_safe` to
`security_definer` so it can still read them — adding an explicit tenant predicate inside the
view body to replace the RLS it would no longer inherit.

One migration, no data movement. But it reinstates the exact shape migration 165 removed, will be
flagged again by Supabase's advisor, and correctness now rests on a hand-written tenant predicate
inside a view rather than on the policy engine. If the predicate is wrong, it is a cross-tenant
leak — a strictly worse failure than the one being fixed.

Only take this if the PII split cannot be scheduled and the hole must close this week.

## What migration 256 does (already written, not applied)

Independent of the above, both gate helpers ignored the investigation team:

- `can_view_incident_pii()` checked superadmin, owner/admin and `assigned_investigator` only —
  even though `062_incident_investigations.sql:47` documents that it honours `team_member_ids`.
- `can_view_care_phi()` inherited the same gap, so a **lead investigator** who is not also the
  incident's `assigned_investigator` is refused care data on the case they are running.

256 makes both match their documentation. Both fields are set by an admin on the investigation
row, so this does not let a member elevate themselves. It is safe to apply on its own and does
not depend on which option above you choose.

## Verification before applying anything

Against a branch database, as a plain `member` JWT:

```sql
-- must return zero rows (or NULL columns) after the fix, and does not today
select full_name, date_of_birth, home_address from public.incident_people;

-- must still return the roster with PII nulled
select * from public.incident_people_safe;
```

Then as the lead investigator on an incident where they are *not* `assigned_investigator`:
`can_view_incident_pii(<incident>)` must be true after 256 and is false before it.
