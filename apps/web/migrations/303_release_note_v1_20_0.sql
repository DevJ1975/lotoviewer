-- Migration 303: publish the v1.20.0 release note.
--
-- Same rationale as 254/255/290/293: shipping the announcement as a migration
-- lands it in the same deploy as the changes it describes. Apply it after
-- 295–302, with the deploy that carries the Environmental module.
--
-- `created_by` is NULL — no human authored this row.
--
-- Body syntax is constrained by lib/markdown.ts: **bold**, [links](…),
-- `- ` bullets and blank-line paragraph breaks only. No italics, no headings.
--
-- Idempotent via a NOT EXISTS guard on `version`. Rollback: 303_rollback.sql.

begin;

insert into public.release_notes (version, title, body_md, published_at, created_by)
select
  'v1.20.0',
  'Environmental management for ISO 14001, and security fixes',
  $md$**Environmental management (ISO 14001).** Organizations with the Environmental module switched on can now keep the registers an environmental management system is built on: context and interested parties, the scope and the policy, environmental aspects scored under normal, abnormal and emergency conditions, and compliance obligations with scheduled, evidence-backed evaluations. Each register shows a red, amber or green light, and a process map records who owns each part of the system. Ask an administrator to switch the module on.

**A more honest ISO 14001 report card.** It now grades only from environmental records. Seven clauses the platform cannot evidence yet read "not assessed" instead of being graded from safety records or counted against you, so check those against your own records before an audit. A report card from before this release and one from after are not directly comparable.

We also fixed:

- Support chat and corrective-action assignment now check that a person belongs to your organization before showing or sending them anything.
- The anonymous reporting pages no longer show technical database messages when something goes wrong.
- OSHA ITA coverage now recognizes industries listed in both appendices. Some establishments with 20 to 99 employees were told they need not file their 300A when they must, so check yours if your industry is one of them.
- Mean-time KPIs, inspection scoring and SDS comparisons each had a calculation error. All three are corrected.$md$,
  now(),
  null
where not exists (
  select 1 from public.release_notes where version = 'v1.20.0'
);

commit;
