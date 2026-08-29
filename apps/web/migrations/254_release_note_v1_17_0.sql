-- Migration 254: publish the v1.17.0 release note.
--
-- Release notes are normally authored by hand at /superadmin/release-notes
-- (runbook §6 step 4). This one ships as a migration instead so the
-- announcement lands in the same deploy as the features it describes —
-- a note added manually afterwards is a step that can be forgotten, and an
-- announcement that arrives days late is worse than none.
--
-- `created_by` is NULL: no human authored this row, and attributing it to a
-- superadmin who did not write it would be a small lie in an audit column.
-- The superadmin UI remains the path for every hand-written note.
--
-- Body syntax is constrained by lib/markdown.ts, which deliberately supports
-- only **bold**, [links](https://…), `- ` bullets, and blank-line paragraph
-- breaks. There is no italic and no heading — anything else renders as
-- literal characters, so this body sticks to bold and paragraphs.
--
-- Dollar-quoted ($md$) rather than concatenated string literals: the body
-- contains apostrophes and newlines, and quoting it once is far harder to get
-- subtly wrong than escaping each fragment.
--
-- Idempotent via a NOT EXISTS guard on `version` — the table has no unique
-- constraint there (a bigserial id is the only key), so ON CONFLICT has
-- nothing to bite on. Re-running never inserts a duplicate.
--
-- Banner lifetime: the note surfaces until the user dismisses it or it ages
-- past RELEASE_NOTE_BANNER_DAYS (7) from published_at, whichever comes
-- first — see packages/core/src/releaseNotes.ts. Publishing at now() starts
-- that clock at deploy time.

begin;

insert into public.release_notes (version, title, body_md, published_at, created_by)
select
  'v1.17.0',
  'Regulatory Watch now covers Cal/OSHA — and a new Coming Up box',
  $md$A new **Coming Up** panel on your dashboard shows regulatory changes that have **not taken effect yet**, ordered by the soonest deadline. Each one is labelled **Comments close** or **Effective** so it is clear what the date is asking of you.

If you operate a site in **California**, Cal/OSHA Title 8 rulemaking now appears alongside federal OSHA. Sites outside California continue to see federal items only.

We also corrected the **severe-injury reporting countdown** for California sites. Cal/OSHA requires reporting within **8 hours for all four triggers** — not the federal 24 — so the clock on hospitalizations, amputations, and eye injuries now reflects the shorter window. Reports filed before this change keep the deadline they were tracked under.$md$,
  now(),
  null
where not exists (
  select 1 from public.release_notes where version = 'v1.17.0'
);

commit;
