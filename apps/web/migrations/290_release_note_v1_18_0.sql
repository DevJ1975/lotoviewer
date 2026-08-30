-- Migration 290: publish the v1.18.0 release note.
--
-- Same rationale as 254 and 255: shipping the announcement as a migration
-- lands it in the same deploy as the changes it describes, rather than as a
-- manual step afterwards that can be forgotten or arrive days late.
--
-- `created_by` is NULL — no human authored this row, and attributing it to a
-- superadmin who did not write it would be a small lie in an audit column.
--
-- Body syntax is constrained by lib/markdown.ts, which supports only
-- **bold**, [links](https://…), `- ` bullets and blank-line paragraph breaks.
-- No italics, no headings.
--
-- Dollar-quoted ($md$) because the body contains apostrophes and newlines.
--
-- Idempotent via a NOT EXISTS guard on `version` — the table has no unique
-- constraint there, so ON CONFLICT has nothing to bite on.
--
-- The note leads with what a reader can see and act on. The security work is
-- the larger part of this release, but most of it is invisible by design, so
-- it is described in terms of what it prevents rather than what changed.

begin;

insert into public.release_notes (version, title, body_md, published_at, created_by)
select
  'v1.18.0',
  'Hazard symbols, enforced fire watch, and a large security pass',
  $md$**Hazard-communication symbols are here.** GHS pictograms, DOT hazard classes, NFPA 704 diamonds and waste-stream symbols, with printable labels for containers and storage areas.

**The post-work fire watch is now enforced.** NFPA 51B sets a floor on how long a watch must run after hot work stops. The form asked for it; nothing checked it. The database now enforces the minimum as well, because the form is not the only way a permit gets written.

**Behaviour-Based Safety gains coaching**, and there is a new training and competency matrix.

**Placards export to Excel**, per site and per department.

We also fixed several things worth naming:

- The printed placard silently dropped isolation steps past the seventh. A seven-step procedure printed in full; an eight-step one printed seven and gave no indication anything was missing.
- Privacy and Terms are reachable when signed out. The login page links to both, and clicking either sent you back to the login page.
- Reset Demo no longer empties Equipment Readiness, and it now re-seeds any demo organisation rather than only one.
- Turning STRIKE off for an organisation now turns off its interfaces too, not only its pages.

**On security.** This release closes a set of holes found in a full audit. Most are invisible in normal use, which is the point of naming them:

- Quiz answer keys were readable by learners. The page asked only for the answer text, but anything holding a sign-in could ask the database directly for which answer was correct, for every published module.
- Inspector links could read another customer's permits. A link minted for one organisation's Cal/OSHA inspection returned every organisation's confined-space and hot-work permits. **Any inspector link issued before this release has stopped working and must be re-issued** — that is deliberate: the old links could not be made safe.
- A member whose access had been revoked, or who belonged to a switched-off organisation, was still let through by one of the checks.
- An image-handling flaw allowed a crafted upload to run code on the server.

None of these required action from you, and all are closed.$md$,
  now(),
  null
where not exists (
  select 1 from public.release_notes where version = 'v1.18.0'
);

commit;
