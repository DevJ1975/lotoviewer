-- Migration 241: scale-hardening indexes (Phase 0 of the 6,500-user audit).
-- See docs/audits/scale-audit-6500-users.md.
--
-- 1. Composite index for the training-matrix lateral join. Measured 29,229 ms ->
--    157 ms (186x) on a synthetic 1,000-member tenant: v_training_matrix's
--    completion sub-join filters (tenant_id, course_id, member_id), and the
--    existing single-column partial indexes don't serve that shape.
-- 2. A leading-tenant_id index on every tenant-scoped table that lacked one. RLS
--    filters every read by tenant_id; without such an index the read is a Seq Scan.
--    These tables are tiny today (instant build); at large scale prefer
--    CREATE INDEX CONCURRENTLY (noted in the audit doc).
-- 3. Drop two exact-duplicate / redundant indexes.
--
-- Forward-only + idempotent: create index if not exists / drop index if exists.

begin;

-- 1. Training-matrix completion lookup (the 186x fix) ------------------------
create index if not exists idx_ltr_tenant_course_member
  on public.loto_training_records (tenant_id, course_id, member_id);

-- 2. Missing leading-tenant_id indexes (43 tenant-scoped tables) -------------
create index if not exists idx_loto_audit_equipment_results_tenant_id on public.loto_audit_equipment_results (tenant_id);
create index if not exists idx_loto_audit_changes_tenant_id           on public.loto_audit_changes (tenant_id);
create index if not exists idx_loto_audit_snapshot_steps_tenant_id    on public.loto_audit_snapshot_steps (tenant_id);
create index if not exists idx_loto_review_link_equipment_tenant_id   on public.loto_review_link_equipment (tenant_id);
create index if not exists idx_loto_audit_snapshot_equipment_tenant_id on public.loto_audit_snapshot_equipment (tenant_id);
create index if not exists idx_support_tickets_tenant_id              on public.support_tickets (tenant_id);
create index if not exists idx_safety_board_replies_tenant_id         on public.safety_board_replies (tenant_id);
create index if not exists idx_chat_messages_tenant_id                on public.chat_messages (tenant_id);
create index if not exists idx_incident_rca_5whys_tenant_id           on public.incident_rca_5whys (tenant_id);
create index if not exists idx_strike_module_versions_tenant_id       on public.strike_module_versions (tenant_id);
create index if not exists idx_safety_board_acknowledgements_tenant_id on public.safety_board_acknowledgements (tenant_id);
create index if not exists idx_support_conversations_tenant_id        on public.support_conversations (tenant_id);
create index if not exists idx_risk_reviews_tenant_id                 on public.risk_reviews (tenant_id);
create index if not exists idx_incident_care_visits_tenant_id         on public.incident_care_visits (tenant_id);
create index if not exists idx_safety_board_reactions_tenant_id       on public.safety_board_reactions (tenant_id);
create index if not exists idx_chat_channel_members_tenant_id         on public.chat_channel_members (tenant_id);
create index if not exists idx_chat_message_reactions_tenant_id       on public.chat_message_reactions (tenant_id);
create index if not exists idx_safety_board_thread_templates_tenant_id on public.safety_board_thread_templates (tenant_id);
create index if not exists idx_notifications_tenant_id                on public.notifications (tenant_id);
create index if not exists idx_strike_quiz_questions_tenant_id        on public.strike_quiz_questions (tenant_id);
create index if not exists idx_strike_quiz_answers_tenant_id          on public.strike_quiz_answers (tenant_id);
create index if not exists idx_equipment_inspection_responses_tenant_id on public.equipment_inspection_responses (tenant_id);
create index if not exists idx_equipment_repairs_tenant_id            on public.equipment_repairs (tenant_id);
create index if not exists idx_loto_audit_snapshots_tenant_id         on public.loto_audit_snapshots (tenant_id);
create index if not exists idx_fleet_motor_vehicle_incidents_tenant_id on public.fleet_motor_vehicle_incidents (tenant_id);
create index if not exists idx_loto_review_photo_replacements_tenant_id on public.loto_review_photo_replacements (tenant_id);
create index if not exists idx_fleet_vehicle_chemicals_tenant_id      on public.fleet_vehicle_chemicals (tenant_id);
create index if not exists idx_safety_board_attachments_tenant_id     on public.safety_board_attachments (tenant_id);
create index if not exists idx_safety_board_access_tenant_id          on public.safety_board_access (tenant_id);
create index if not exists idx_jha_steps_tenant_id                    on public.jha_steps (tenant_id);
create index if not exists idx_jha_hazards_tenant_id                  on public.jha_hazards (tenant_id);
create index if not exists idx_incident_medical_documents_tenant_id   on public.incident_medical_documents (tenant_id);
create index if not exists idx_action_item_comments_tenant_id         on public.action_item_comments (tenant_id);
create index if not exists idx_chat_message_attachments_tenant_id     on public.chat_message_attachments (tenant_id);
create index if not exists idx_fleet_vehicle_placards_tenant_id       on public.fleet_vehicle_placards (tenant_id);
create index if not exists idx_risk_attachments_tenant_id             on public.risk_attachments (tenant_id);
create index if not exists idx_inspection_template_items_tenant_id    on public.inspection_template_items (tenant_id);
create index if not exists idx_incident_rca_taproot_factors_tenant_id on public.incident_rca_taproot_factors (tenant_id);
create index if not exists idx_incident_rca_fishbone_tenant_id        on public.incident_rca_fishbone (tenant_id);
create index if not exists idx_compliance_obligation_completions_tenant_id on public.compliance_obligation_completions (tenant_id);
create index if not exists idx_incident_rca_icam_factors_tenant_id    on public.incident_rca_icam_factors (tenant_id);
create index if not exists idx_safety_board_subscriptions_tenant_id   on public.safety_board_subscriptions (tenant_id);
create index if not exists idx_member_custom_field_values_tenant_id   on public.member_custom_field_values (tenant_id);

-- 3. Drop duplicate / redundant indexes -------------------------------------
drop index if exists public.idx_loto_department;   -- exact duplicate of loto_equipment_department_idx (department)
drop index if exists public.idx_audit_log_tenant;  -- redundant prefix of idx_audit_log_tenant_time (tenant_id, created_at desc)

commit;
