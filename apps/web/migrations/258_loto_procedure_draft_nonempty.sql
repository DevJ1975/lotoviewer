-- 258_loto_procedure_draft_nonempty.sql
--
-- Database backstop: a `procedure_draft` change may never carry an empty step
-- list.
--
-- Applying one of these REPLACES the machine's entire energy-control procedure
-- (220_loto_audit_procedure_draft.sql:153-176 — delete-then-insert from
-- `new_value -> 'steps'`). `jsonb_array_elements('[]')` yields zero rows while
-- the DELETE still runs, so a zero-step draft silently erases the procedure and
-- nulls `placard_url`, causing a blank placard to be reprinted for the panel.
--
-- The Author agent now refuses to produce one (runAuthorAgent → assertUsableDraft)
-- and the output schema carries `minItems: 1`. This constraint is the third
-- layer: it holds even if a future caller stages a change row by some other
-- path. Rejecting at INSERT keeps the bad row from ever existing, rather than
-- discovering it at apply time with the DELETE already issued.
--
-- Deliberately NOT a check on the required OSHA phases. That judgement belongs
-- to validateProcedure() and the reviewing safety professional; encoding it here
-- would block a legitimate partial correction a reviewer intends to finish by
-- hand.
--
-- Numbering note: authored as 256, renumbered to 258 before merge. 256
-- (wls_iso14001_demo) and 257 (predictive_safety_intelligence) landed on main
-- while this branch was out; 258 is the first free slot.
--
-- Verified before writing: 29 existing procedure_draft rows, 0 with a non-array
-- `steps`, 0 empty — so this validates without a rewrite.

alter table public.loto_audit_changes
  drop constraint if exists loto_audit_changes_procedure_draft_nonempty;

alter table public.loto_audit_changes
  add constraint loto_audit_changes_procedure_draft_nonempty
  check (
    change_kind <> 'procedure_draft'
    or (
      jsonb_typeof(new_value -> 'steps') = 'array'
      and jsonb_array_length(new_value -> 'steps') > 0
    )
  );

notify pgrst, 'reload schema';
