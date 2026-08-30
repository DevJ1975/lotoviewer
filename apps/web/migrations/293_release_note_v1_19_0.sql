-- Migration 293: publish the v1.19.0 release note.
--
-- Same rationale as 254/255/290: shipping the announcement as a migration
-- lands it in the same deploy as the changes it describes.
--
-- `created_by` is NULL — no human authored this row.
--
-- Body syntax is constrained by lib/markdown.ts: **bold**, [links](…),
-- `- ` bullets and blank-line paragraph breaks only. No italics, no headings.
--
-- Idempotent via a NOT EXISTS guard on `version`.

begin;

insert into public.release_notes (version, title, body_md, published_at, created_by)
select
  'v1.19.0',
  'Hazard Hunt, richer hazardous-waste records, and faster pages',
  $md$**Hazard Hunt.** Customisable daily, weekly and monthly OSHA and Cal/OSHA inspection rounds. Findings and write-ups feed the risk model, so proactive hunting now counts toward your score instead of being invisible to it.

**One note on scores.** Adding that indicator changes how every other one is weighted, so a score from before this release and one from after are not directly comparable. The model version is recorded alongside each score so you can tell which is which.

**Hazardous waste records now carry jurisdiction, acute classification, land-disposal-restriction notices and contingency plans.** Whether federal or California rules apply is decisive for several thresholds, and the module previously had nowhere to say which.

**Behaviour-Based Safety has its own wiki page** and supports coaching teams.

**Several pages got faster.** Chat unread counts, tenant health and the AI budget check each used to make a handful of separate database calls where one now does; the sign-in check makes its two lookups at the same time instead of one after the other.

We also fixed:

- Incident notifications went out one at a time before the reporter saw their confirmation. Someone who had just reported an injury could sit watching a spinner while messages were sent in sequence. They now go together.
- Two dead paths in the incident reporter, and the mismatch that hid them.
- The rapid-review "overdue" badge was comparing against a clock that only updated when something else on the page changed, so it could show stale.

Nothing here needs any action from you.$md$,
  now(),
  null
where not exists (
  select 1 from public.release_notes where version = 'v1.19.0'
);

commit;
