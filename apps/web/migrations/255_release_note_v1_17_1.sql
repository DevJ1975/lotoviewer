-- Migration 255: publish the v1.17.1 release note.
--
-- Same rationale as 254: shipping the announcement as a migration lands it in
-- the same deploy as the changes it describes, rather than as a manual step
-- afterwards that can be forgotten or arrive days late.
--
-- `created_by` is NULL — no human authored this row, and attributing it to a
-- superadmin who did not write it would be a small lie in an audit column.
--
-- Body syntax is constrained by lib/markdown.ts, which supports only
-- **bold**, [links](https://…), `- ` bullets and blank-line paragraph breaks.
-- No italics, no headings — the `### h3` handling in that file belongs to a
-- different renderer used for toolbox talks, not this surface. Verified
-- against the source rather than assumed; a previous note had to be rewritten
-- for exactly this reason.
--
-- Dollar-quoted ($md$) because the body contains apostrophes and newlines.
--
-- Idempotent via a NOT EXISTS guard on `version` — the table has no unique
-- constraint there, so ON CONFLICT has nothing to bite on.
--
-- Banner lifetime: surfaces until dismissed or until it ages past
-- RELEASE_NOTE_BANNER_DAYS (7) from published_at — see
-- packages/core/src/releaseNotes.ts. Publishing at now() starts that clock at
-- deploy time.
--
-- The note leads with navigation and search rather than with fixes. This
-- release is numbered as a patch, so the version string alone would understate
-- what actually changed for a user; the announcement carries that weight.

begin;

insert into public.release_notes (version, title, body_md, published_at, created_by)
select
  'v1.17.1',
  'Search now finds equipment, and sub-pages are easier to reach',
  $md$**Search covers equipment as well as pages.** Press **Cmd-K** (or **Ctrl-K**) and you can search pages, modules and equipment in one list. Previously the search box in the header looked for equipment only, so searching it for something like "confined space permit" found nothing even though the page existed. The header search button now opens the same panel.

**Module sub-pages are reachable from the menu.** Pages that live inside a module — SDS Library, Tier II Report, MAQ Caps, Approval Queue and others — used to appear only after you had already opened that module some other way. The arrow beside a module now expands it, and it remembers what you left open.

**Administration is split into three groups.** It had grown into a single list longer than several other sections combined. It is now **People & Training**, **Platform & Integrations**, and **Records & Support**.

**Recent pages now include records, not just modules.** An incident, a chemical or a piece of equipment you visited will appear under Recents, where before only top-level pages did.

**A few things moved.** The search box in the header is now a button — clicking it opens the search panel rather than typing into the header itself. Pressing **/** on its own no longer opens search; it was taking over the key on pages where you might reasonably want to type a slash. Use **Cmd-K** or the search button instead.

We also fixed several things worth naming:

- An unusual character in a web address saved under Recents could show an error screen in place of the app, and would keep doing so until browser data was cleared.
- The search panel could show "No matches" directly above a matching piece of equipment, and pressing Enter opened the wrong page.
- Cmd-K now works with Caps Lock on, and closes the panel when pressed again.
- The search panel is now announced correctly by screen readers, name and description both.

**One visible change to expect:** dashboard panels have a slightly different card style, part of bringing the dashboard in line with the rest of the app. Nothing moved and no panel was removed.$md$,
  now(),
  null
where not exists (
  select 1 from public.release_notes where version = 'v1.17.1'
);

commit;
