-- Migration 265: expand + publish the Training & Competency Matrix user manual.
--
-- The matrix shipped (migration 240, v1.13.0) with only a stub manual in
-- seed_module_manuals.sql, and the row was never present in this database's
-- `manuals` table. This migration upserts the full manual content and publishes
-- it (visible to all authenticated users), following the repo convention that
-- full manual bodies live in an expansion migration (cf. 135_expand_all_user_manuals.sql)
-- while the seed file keeps the coverage stub.
--
-- Idempotent: ON CONFLICT updates the body and publishes only if not already
-- published; the reciprocal cross-link into the Training-records manual is
-- guarded by a NOT LIKE check and a best-effort DO block.

insert into public.manuals (module_id, title, summary, body_md, published_at)
values (
  'admin-training-competency-matrix',
  'Training & Competency Matrix',
  'Org-wide required training by worker and course — expiry status, course catalog, and per-position requirements.',
  $md$## Overview

The Training & Competency Matrix shows, in one grid, which workers are current on the training their job requires and where the gaps are. Every active worker is a row, every course they are required to hold is a column, and every cell shows readiness: current, due soon, overdue, or missing. Completions are stored against the worker's member record, so the same entry appears here, in My Safety Readiness, and in audit exports without re-keying.

## Who Uses It

- Admins build the course catalog and map requirements to positions.
- Trainers and supervisors record completions and work the gaps.
- Workers see their own status through My Safety Readiness.
- Auditors read the matrix as the org-wide proof of competency coverage.

## Build The Course Catalog

1. Open Admin and select Training & Competency Matrix.
2. Go to the Course catalog tab.
3. Add each course with a code, title, and category.
4. Set a validity window in months for trainings that expire; leave it blank for one-time training.
5. Mark required-for-all for trainings every worker must hold.
6. Save. New courses become available on the Requirements tab.

## Set Position Requirements

1. Go to the Requirements tab.
2. Choose a position.
3. Add the courses that position must hold.
4. Save. Workers in that position now show those courses as required columns in the matrix.

## Record Completions

1. Go to the Matrix tab.
2. Click the cell for the worker and course.
3. Enter the completion date. The expiry date is computed from the course's validity window.
4. Save. The cell updates to its new status and the worker's readiness reflects it.

## Read The Matrix And Close Gaps

1. Scan for overdue (red) and missing (empty) cells.
2. Filter to the due-soon column to schedule refreshers before they lapse.
3. Assign and deliver the training.
4. Record the completion to clear the gap.

## Troubleshooting

If a worker shows no cells, they have nothing required yet: assign a position that has requirements, or mark a course required-for-all. If a completion does not appear, confirm it is linked to the worker's member record and that the course is one their position requires. If a certification reads current forever, check that its course has a validity window.

## Related Modules

- Training records for §1910.146(g) confined-space role certifications.
- My Safety Readiness for the worker-facing status view.
- LOTO Compliance for §1910.147 competency and retraining.
- STRIKE for microlearning that is not a formal certificate.
$md$,
  now()
)
on conflict (module_id) do update
  set title        = excluded.title,
      summary      = excluded.summary,
      body_md      = excluded.body_md,
      published_at = coalesce(public.manuals.published_at, now()),
      updated_at   = now();

-- Reciprocal cross-link from the Training-records manual (best-effort, idempotent).
do $$
begin
  update public.manuals
     set body_md    = body_md || E'\n- Training & Competency Matrix for the org-wide, course-driven required-training grid.',
         updated_at = now()
   where module_id = 'admin-training'
     and body_md not like '%Training & Competency Matrix%';
exception when others then
  raise notice 'admin-training cross-ref skipped: %', sqlerrm;
end $$;
