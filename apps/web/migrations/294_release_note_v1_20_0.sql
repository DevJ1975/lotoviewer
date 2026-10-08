-- Migration 294: publish the v1.20.0 release note.
--
-- Same rationale as 254/255/290/293: shipping the announcement as a migration
-- lands it in the same deploy as the changes it describes.
--
-- The banner shows a published note for RELEASE_NOTE_BANNER_DAYS (28) from
-- `published_at`, which is when this runs, not when the release merged.
--
-- `created_by` is NULL — no human authored this row.
--
-- Body syntax is constrained by lib/markdown.ts: **bold**, [links](…),
-- `- ` bullets and blank-line paragraph breaks only. No italics, no headings.
-- A bullet list renders only if every line of its block starts with `- `, and
-- each bullet is a single line.
--
-- Idempotent via a NOT EXISTS guard on `version`.

begin;

insert into public.release_notes (version, title, body_md, published_at, created_by)
select
  'v1.20.0',
  'Hazard Hunt now schedules itself, plus accuracy and security fixes',
  $md$**Scheduled Hazard Hunts now actually run.** The daily generator was never switched on, so no hunt was ever created automatically. It now runs every morning and creates that day's hunt, on its weekly or monthly day, from your active schedules. Hunts that are generated but not completed count against your cadence adherence, which feeds your EHS score, so expect new runs to start appearing for any site that has set up schedules.

**Safety board digests are now delivered.** The job that sends them was not scheduled either. If you chose a daily or weekly digest you will start receiving it; if you chose none, nothing changes.

**OSHA ITA coverage check corrected.** An establishment whose NAICS code is listed in both Appendix A and Appendix B, with 20 to 99 employees, was wrongly shown as not required to submit its 300A data. It is now treated as required. **If that describes one of your sites, check your ITA submission.**

**Two incident KPIs are more accurate.** Mean time to close and mean days to return to work no longer count records with missing or invalid dates as if they had contributed, which understated both. Expect these figures to move for any site with incomplete dates.

We also fixed:

- A fail recorded against an informational inspection item (text, photo or signature) no longer turns the whole inspection into a fail or opens a corrective action.
- SDS revision comparisons no longer show phantom changes for fields an older record does not have.
- Security hardening across support chat, incident corrective actions and the anonymous report endpoints.

Nothing here needs any action from you except the ITA check above, if it applies.$md$,
  now(),
  null
where not exists (
  select 1 from public.release_notes where version = 'v1.20.0'
);

commit;
