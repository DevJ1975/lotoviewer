# Soteria FIELD — Migration Reconciliation

**Date:** 2026-08-28 · **Repo:** `lotoviewer` (working tree, branch `fix/audit-remediation`) · **Version:** 1.17.1
**Production DB:** `zwtnpyjifbdytlektxlc` — queried **read-only** for this reconciliation. Nothing was applied.

---

## 1. Verdict

The repo and production have drifted in both directions, and both directions are now fully mapped:

- **10 repo migrations are merged but not applied** to production — `034`, `053`, `054`, `055`,
  `200`, `225`, `236`, `255`, `257`, `258` — plus **one partial apply** (`012` is missing one unique
  index) and **one chain gap** (`loto_equipment.signed_placard_url` is read by 16 code sites and one
  migration-defined function, but **no migration anywhere creates it** and it does not exist in
  production).
- **51 ledger rows were applied out-of-band and exist in no repo file.** The three construction
  migrations from 2026-08-06 are the largest (7 tables, 11 functions, full RLS) and are **recovered
  today** as `263`–`265`, byte-verified against production by md5. 10 more rows are data-only
  hygiene; ~38 others are schema- or posture-bearing and still unrecovered (§4.3).
- **Single highest-risk item: migration `054` was never applied.** Production's `profiles` table
  still carries the 004-era policies (`profiles_admin_read_all` / `profiles_admin_write` gated on
  the pre-multi-tenant `current_user_is_admin()`), which is exactly the **cross-tenant profile
  read/write leak 054 was written to close** — live since roughly May. Verified directly:
  production's policy set on `profiles` is `profiles_admin_read_all, profiles_admin_write,
  profiles_self_read, profiles_self_update`, and `current_user_visible_profile_ids()` does not
  exist.
- The **loudest** item remains `257`: `/api/cron/vision-sweep-resume` has failed 2,016 consecutive
  times in 7 days, the daily `vision-hazard-sweep` fails, and `draft-regulatory-document` makes a
  **paid** Anthropic call and then throws on insert into the missing `document_drafts`. All four
  of its tables are confirmed absent.
- One correction to the earlier report: **`251` IS applied** (ledger row `20260729175441`, and the
  `member_status_events_event_type_check` constraint contains `'access_reset'`). `255` and `258`
  are confirmed unapplied.

Deliverables in this pass: recovered migrations `263`–`265`, proposed repair `266`, the two-way
drift guard `scripts/check-migration-drift.mjs` + `scripts/migration-drift-baseline.json`, and the
ordered apply plan in §6. Every apply-plan pre-check was executed against production today and
passes.

---

## 2. Method — how files were matched to ledger rows, and how "applied" was decided

**Matching.** The repo numbers files `NNN_slug.sql`; `supabase_migrations.schema_migrations`
records 14-digit timestamp versions with free-form names. 219 ledger rows were matched to files
in tiers:

| Tier | Rule | Example |
|---|---|---|
| 1 | ledger name == `NNN_slug` filename exactly | `195_email_suppressions` → `195_email_suppressions.sql` |
| 2 | ledger name == bare slug | `invite_reminders` → `190_invite_reminders.sql` |
| 3 | ledger name == `slug_NNN[a-z]` (early convention), matched on slug even when the number has since changed | `incidents_core_059` → `059_incidents_core.sql`; `function_hardening_055` → `124_function_hardening.sql` (renumbered before merge) |
| 4 | explicit alias for spellings history mangled | `osha_ita_submission_local_069` → `075_osha_ita_submission.sql`; `incident_attachments_statements_061` → `061_incident_attachments_and_statements.sql` |

168 of 219 rows matched a file; 51 did not (list (c), §4.3). Notable renumber evidence: the
chemicals block is recorded as `082`–`095` but lives at `089`–`102`; fleet is recorded as
`200`/`201` but lives at `202`/`203`; `function_hardening_055`/`storage_bucket_listing_lockdown_056`
live at `124`/`125`. All matched on slug; where a slug was not unique the match was reviewed by
hand. **Assumption flagged:** slug-matched rows are assumed to carry the same SQL as the repo file
(renumbered, not rewritten); content was spot-checked, not diffed row-by-row.

**Applied-ness.** The ledger alone cannot answer it: rows only exist for migrations applied via
MCP/CLI since 2026-05-06 — everything earlier was pasted into the SQL editor with no record. So
every object every numbered migration declares was extracted (tables, views, functions, columns,
indexes, triggers, policies) and probed in bulk against the live catalogs. The probe queries (all
plain `SELECT`s, full text in §5):

- relations: `pg_class` joined to `pg_namespace`, `relkind in ('r','p','v','m','f')`
- functions: `pg_proc` by `proname` in schema `public`
- columns: `information_schema.columns`
- indexes: `pg_class` with `relkind = 'i'`
- triggers: `pg_trigger` where `not tgisinternal`
- constraints / policies / cron jobs / data rows: targeted queries per migration (§5)

Out of ~1,150 probed objects, **everything resolved** except the objects belonging to the 10
unapplied migrations, one index from `012`, and the `signed_placard_url` chain gap. The reverse
probe (live `public` relations not declared by any repo migration) produced exactly the drift-B
loss list in §4.3.

**Inference flags.** (1) DML-only pre-ledger migrations (`006`, `007`, `023`, `028`, `030`, `041`,
`110`–`112`, `122`, `135`, `136` …) leave no schema fingerprint; they are marked *applied
(inferred)* from era and surviving data, not proven. (2) Early RLS-policy-only files (`004`,
`029`, `040`, `054`-adjacent…) were verified only where policy names survive — later out-of-band
policy rewrites (`rls_initplan_hoisting`, advisor sweeps) legitimately renamed/rewrote many, so
absence of an *old* policy name was never treated as "unapplied" on its own (`054` was condemned
on the *presence of the policies it deletes* plus the absence of its helper function).

---

## 3. List (b) — in repo, NOT applied to production

| # | Migration | Classification | What it creates/changes | Live check result |
|---|---|---|---|---|
| 1 | `012_compliance_extensions.sql` | **PARTIAL — NEEDS-CARE** | everything applied except unique index `idx_entries_one_open_per_entrant` on `loto_confined_space_entries(permit_id, entrant_name) where exited_at is null` | index absent; duplicate pre-check returns **0** rows, so it creates cleanly |
| 2 | `034_bug_reports.sql` | **SAFE-ADDITIVE** | table `bug_reports`, 2 indexes, RLS + 2 policies | table absent — `/api/support/bug-report` and daily-health-report cron error today |
| 3 | `053_cs_auto_cancel_trigger.sql` | **SAFE-ADDITIVE** (behavioral) | function `cs_atmospheric_auto_cancel()` + trigger `trg_cs_atmospheric_auto_cancel` on `loto_atmospheric_tests` | both absent — the §1910.146(e)(5) auto-cancel documented in the KB does not actually run |
| 4 | `054_profiles_tenant_scoped_read.sql` | **NEEDS-CARE** (security fix) | drops `profiles_admin_read_all`/`profiles_admin_write`; creates `current_user_visible_profile_ids()`, `profiles_tenant_visible_read`, `profiles_superadmin_read`, `profiles_visible_write` | helper function absent; production still runs the exact policy set 054 deletes — **cross-tenant profile read/write leak live** |
| 5 | `055_dashboard_indexes.sql` | **SAFE-ADDITIVE** | 3 indexes: `idx_ai_invocations_occurred_at`, `idx_support_tickets_created_at`, `idx_loto_training_records_expires_at` | all 3 absent |
| 6 | `200_wls_demo_seed_functions.sql` | **NEEDS-CARE** (writes demo data) | functions `seed_wls_incidents_demo/near_miss_demo/bbs_demo` + revokes; **calls all three at apply time** (writes to the `is_demo` tenant only; idempotent by deterministic ids) | all 3 functions absent — 3 of the 4 RPCs `reset-demo` calls do not exist |
| 7 | `225_strike_vimeo_only.sql` | **SAFE-ADDITIVE** | relaxes `strike_media_access_provider_check` to admit `'vimeo'`; drops the provider-domain checks; `video_provider` default → `'vimeo'` | prod check has **no** `vimeo`; default still `'storage'`; `strike_media_access` has 0 rows so the swap is trivially safe |
| 8 | `236_rca_multi_root_branching_ai.sql` | **SAFE-ADDITIVE** | table `incident_rca_ai_suggestions` (+RLS/policy), columns `incident_rca_5whys.parent_id/ai_origin/ai_edited`, `incident_actions.ai_origin/ai_edited`, 2 indexes | table and all 5 columns absent — `/api/incidents/[id]/rca/assist` errors today |
| 9 | `255_release_note_v1_17_1.sql` | **SAFE-ADDITIVE** (DML, guarded) | inserts the v1.17.1 release note (`where not exists` guard) | `release_notes` has `v1.17.0` but **no `v1.17.1`** |
| 10 | `257_predictive_safety_intelligence.sql` | **SAFE-ADDITIVE** | tables `vision_sweep_runs`, `vision_sweep_photos`, `vision_hazard_signals`, `document_drafts`; 13 indexes; 4 tenant-scope policies; 2 touch triggers | all 4 tables, all 13 indexes, both triggers absent — **the 3 broken production surfaces** |
| 11 | `258_loto_procedure_draft_nonempty.sql` | **NEEDS-CARE** (validates existing rows) | CHECK `loto_audit_changes_procedure_draft_nonempty` | constraint absent; violating-row pre-check returns **0**, so it validates cleanly |
| 12 | *(chain gap — no owning file until today)* `266_loto_equipment_signed_placard_url.sql` | **SAFE-ADDITIVE** (new repair, written this pass) | column `loto_equipment.signed_placard_url text` | column absent; 16 `apps/web` call sites select it → placard signing counts every item as failed |

Nothing in list (b) is UNSAFE/BLOCKED: no drops of user data, no rewrites, no dependency on an
absent object. Ordering interactions and the exact verification queries are in §5–§6.

Also checked and **confirmed applied** despite having no ledger row or being previously suspect:
`134` (its tables/functions/backfill are live; its only `signed_placard_url` references sit inside
`apply_loto_review_photo_replacement`, which `215` later drops — the real gap is the column, fixed
by `266`), `139` (live `signoff_loto_review_link` no longer contains the readiness gate), `242`
(all 4 `pg_cron` jobs live), `243` (`_photo_backup_pre_v2.relrowsecurity = true`), `241`/`245`
(all indexes present except `idx_loto_audit_results_run`, which out-of-band ledger row
`20260612205718 226_drop_duplicate_audit_results_index` **deliberately dropped** as a duplicate),
and `251` (constraint contains `'access_reset'`; ledger `20260729175441`).

---

## 4. List (c) — applied to production, NOT in the repo (51 ledger rows)

### 4.1 Recovered this pass (the 2026-08-06 construction vertical)

| Ledger version | Name | Recovered as | Verification |
|---|---|---|---|
| `20260806042305` | `tenants_industry_profile` | `apps/web/migrations/263_recover_tenants_industry_profile.sql` | body md5 `e3285224016f25df55fecf49c98e1c04` == production, 526 bytes |
| `20260806042532` | `construction_projects` | `apps/web/migrations/264_recover_construction_projects.sql` | body md5 `06f686f1471903c514927726fd74ebb8` == production, 34,781 bytes |
| `20260806042915` | `fix_project_calendar_ordinal_assignment` | `apps/web/migrations/265_recover_fix_project_calendar_ordinal_assignment.sql` | body md5 `d2f2b2c1054b84f1893c2636280e267d` == production, 3,052 bytes |

Recovery mechanics: SQL pulled with
`select array_to_string(statements, E'\n') from supabase_migrations.schema_migrations where version = …`,
reassembled locally, and byte-verified against `md5(array_to_string(statements, E'\n'))` from
production before a recovery header was prepended. **The bodies are verbatim** — and they were
already fully idempotent as applied (`create table/index if not exists`, `create or replace
function`, `drop trigger/policy if exists` before create, `pg_constraint`-guarded constraint
adds), so each file is safe both against production (objects exist; all 7 tables hold 0 rows) and
on a fresh rebuild (objects don't exist). Numbering: `npm run migration:next` said 259, but the
open-PR collision map (saas-evaluation §5.1) contests 259–262, so **263–266 were used on the
assumption 259–262 stay reserved for in-flight PRs** — flagged, not verified.

### 4.2 Data-only out-of-band rows (10) — no rebuild loss, acknowledge and move on

`20260518213548/213656/213829` (`snakking_loto_rewrites*`), `20260518221154` (`skt2_240_h_tag_cleanup`),
`20260518221305` (`bulk_photo_cleanup`), `20260518221359` (`flag_stub_records`),
`20260518222536/222609` (`popchip_batch part1/part2`), `20260518223403` (`photo_rollback`),
`20260518225124` (`marlen_clean_oem_photo`). Tenant data hygiene in the style of the repo's
`data_hygiene_snak_king_*.sql` files, never committed. (`20260506174204
data_hygiene_snak_king_2026_05_06` **is** in the repo as an unnumbered file and is aliased, not
counted here.)

### 4.3 Schema/posture-bearing out-of-band rows — still unrecovered (~38)

A rebuild from `migrations/` loses all of this. Verified live objects with no owning file
(reverse probe: live `public` relations not declared by any repo migration):

| Group | Ledger rows | Live objects a rebuild would lose |
|---|---|---|
| Legal registry + compliance calendar v1 | `20260513205353 compliance_calendar_and_legal_registry_139` | tables `legal_register`, `compliance_obligations`, `compliance_obligation_completions` (0 rows each; note `241` indexes `compliance_obligation_completions`, so a rebuild also breaks `241`) |
| Tenant secrets envelope | `20260509145418 tenant_secrets_envelope_114` | table `tenant_secrets` (0 rows) + envelope functions |
| Webhook SSRF hardening | `20260509145927 webhook_url_safety_116` | hardened `fire_webhooks()` body |
| loto-photos tenant SELECT policy | `20260509150121 loto_photos_tenant_select_115` | storage policy (dormant, bucket still public) |
| pg_cron enablement | `20260508051740 enable_pg_cron_for_anon_prune` | `pg_cron` extension + `prune-anon-report-ip-attempts` job (job verified live) |
| QR-token function hardening | `20260508231956 harden_qr_token_function_search_path` | pinned `search_path` on the 106 helpers |
| CAD drawings feature | `20260518180104/180121/180143` | tables `loto_cad_drawings`, `loto_drawing_defects` (0 rows) + CAD/facility columns on `loto_equipment` |
| Placard publish gate (retired) | `20260518221108/224141/224344/233129` | gate function chain, ends **disabled** — verify end-state before bothering to recover |
| Review-link field flags | `20260520103243 loto_review_link_equipment_field_flag` | field-flag columns on `loto_review_link_equipment` |
| PHI storage bucket | `20260524202855 medical_records_bucket` | private `medical-records` bucket (referenced by `201`'s header, created nowhere) |
| Placard QR backfill marker | `20260606155006 289_loto_placard_qr_backfill_marker` | `loto_equipment.placard_qr_backfilled` + index |
| Perf index drop | `20260612205718 226_drop_duplicate_audit_results_index` | drop of `idx_loto_audit_results_run` (repo `218` recreates it on rebuild — mild perf regression only) |
| Perf consolidation RPCs | `20260613012950 227_perf_consolidation_rpcs` | N+1-collapsing read RPCs |
| Waitlist | `20260613032726 228_waitlist_signups` | table `waitlist_signups` (0 rows) |
| Hazmat catalogs (seeded!) | `20260614232545/232621/232742/232802/232820/232837` | `ghs_pictogram_catalog` (9 rows), `dot_hazard_class_catalog` (20 rows), `nfpa704_legend` (18 rows), `hazardous_waste_label_prints`, stream-symbol/tier-two columns |
| Safety weather | `20260616224419/224604/224644 232/233/234_safety_weather_*` | tables `safety_weather_settings`, `safety_weather_readings` (0 rows) + site-coordinate columns |
| 2026-08-05/06 security remediation sweep | `audit_log_retention_legal_hold`, `inspector_tokens_snapshots`, `placard_publishable_tenant_scope`, `actor_identity_member_rebind`, `storage_anon_write_revoke` ×2, `rls_initplan_hoisting` ×2, `active_tenant_header_null_safety`, `realtime_publication`, `rpc_surface_lockdown`, `function_search_path`, `rpc_revoke_from_public` (13 rows) | tables `inspector_tokens`, `inspector_token_accesses` (0 rows); the `(select …)`-wrapped RLS policy rewrites (why repo policies ≠ production, saas-evaluation §2.4); storage/RPC revokes; realtime publication config |

Note the naming collisions inside the ledger itself: out-of-band rows claim numbers `217`, `226`,
`227`, `228`, `232`, `233`, `234` — all of which the repo has since assigned to *different*
migrations. Matching was done on content/slug, never on those numbers.

**Recommendation:** recover these with the same md5-verified procedure as 263–265, one PR each for
the substantive groups (legal registry, CAD, catalogs, weather, tenant secrets, inspector tokens,
security sweep consolidated). Until then they are pinned in `scripts/migration-drift-baseline.json`
so the new check stays green without forgetting them. Also worth recovering eventually:
`_photo_backup_pre_v2` (26 rows) and `loto_hygiene_log` (246 rows) exist only via hand-applied or
unnumbered files, and `loto_equipment` / `loto_energy_steps` still predate the chain entirely (no
`000_baseline.sql` — known from saas-evaluation §2.5).

### 4.4 List (a) — full two-way ledger (every numbered migration ↔ ledger/status)

Statuses: a version+name pair means matched ledger row(s); *no ledger row — applied pre-ledger,
schema-verified* means every schema object the file declares exists live (DML-only files: applied
inferred, see §2); **NOT APPLIED** as in §3.

| Migration file | Ledger row(s) / status |
|---|---|
| `001_loto_reviews.sql` | no ledger row — applied pre-ledger, schema-verified |
| `002_decommissioned_and_indexes.sql` | no ledger row — applied pre-ledger, schema-verified |
| `003_auth_profiles_audit.sql` | no ledger row — applied pre-ledger, schema-verified |
| `004_profiles_rls_fix.sql` | no ledger row — applied pre-ledger, schema-verified |
| `005_storage_loto_photos_rls.sql` | no ledger row — applied pre-ledger, schema-verified |
| `006_backfill_photo_status.sql` | no ledger row — applied pre-ledger, schema-verified |
| `007_reconnect_orphaned_energy_steps.sql` | no ledger row — applied pre-ledger, schema-verified |
| `008_equipment_internal_notes.sql` | no ledger row — applied pre-ledger, schema-verified |
| `009_confined_spaces.sql` | no ledger row — applied pre-ledger, schema-verified |
| `010_confined_space_text_rosters.sql` | no ledger row — applied pre-ledger, schema-verified |
| `011_permit_serials_and_cap.sql` | no ledger row — applied pre-ledger, schema-verified |
| `012_compliance_extensions.sql` | no ledger row — applied pre-ledger, schema-verified |
| `013_webhooks.sql` | no ledger row — applied pre-ledger, schema-verified |
| `014_work_order_link.sql` | no ledger row — applied pre-ledger, schema-verified |
| `015_photo_annotations.sql` | no ledger row — applied pre-ledger, schema-verified |
| `016_push_subscriptions.sql` | no ledger row — applied pre-ledger, schema-verified |
| `017_training_records.sql` | no ledger row — applied pre-ledger, schema-verified |
| `018_push_auto_trigger.sql` | no ledger row — applied pre-ledger, schema-verified |
| `019_hot_work_permits.sql` | no ledger row — applied pre-ledger, schema-verified |
| `020_hot_work_triggers.sql` | no ledger row — applied pre-ledger, schema-verified |
| `021_training_roles_hot_work.sql` | no ledger row — applied pre-ledger, schema-verified |
| `022_iso_photo_annotations.sql` | no ledger row — applied pre-ledger, schema-verified |
| `023_rename_energy_codes.sql` | no ledger row — applied pre-ledger, schema-verified |
| `024_permit_signon_tokens.sql` | no ledger row — applied pre-ledger, schema-verified |
| `025_meter_alerts.sql` | no ledger row — applied pre-ledger, schema-verified |
| `026_loto_devices.sql` | no ledger row — applied pre-ledger, schema-verified |
| `027_multi_tenant_schema.sql` | no ledger row — applied pre-ledger, schema-verified |
| `028_multi_tenant_backfill.sql` | no ledger row — applied pre-ledger, schema-verified |
| `029_multi_tenant_rls.sql` | no ledger row — applied pre-ledger, schema-verified |
| `030_seed_wls_demo.sql` | no ledger row — applied pre-ledger, schema-verified |
| `031_fix_membership_recursion.sql` | no ledger row — applied pre-ledger, schema-verified |
| `032_active_tenant_header_scope.sql` | no ledger row — applied pre-ledger, schema-verified |
| `033_storage_tenant_scope.sql` | no ledger row — applied pre-ledger, schema-verified |
| `034_bug_reports.sql` | **NOT APPLIED** |
| `035_placard_review_portal.sql` | no ledger row — applied pre-ledger, schema-verified |
| `036_review_link_email_channel.sql` | no ledger row — applied pre-ledger, schema-verified |
| `037_risk_assessment_schema.sql` | no ledger row — applied pre-ledger, schema-verified |
| `038_risk_audit_log.sql` | no ledger row — applied pre-ledger, schema-verified |
| `039_risk_constraints_and_triggers.sql` | no ledger row — applied pre-ledger, schema-verified |
| `040_risk_assessment_rls.sql` | no ledger row — applied pre-ledger, schema-verified |
| `041_controls_library_seed.sql` | no ledger row — applied pre-ledger, schema-verified |
| `042_near_miss_module.sql` | no ledger row — applied pre-ledger, schema-verified |
| `043_jha_module.sql` | no ledger row — applied pre-ledger, schema-verified |
| `045_support_assistant.sql` | no ledger row — applied pre-ledger, schema-verified |
| `046_support_message_feedback.sql` | no ledger row — applied pre-ledger, schema-verified |
| `047_ai_invocations.sql` | no ledger row — applied pre-ledger, schema-verified |
| `048_support_ticket_archive.sql` | no ledger row — applied pre-ledger, schema-verified |
| `049_fix_tenant_memberships_recursion.sql` | no ledger row — applied pre-ledger, schema-verified |
| `050_loto_training_role.sql` | no ledger row — applied pre-ledger, schema-verified |
| `051_loto_workers.sql` | no ledger row — applied pre-ledger, schema-verified |
| `052_tenant_id_defaults.sql` | no ledger row — applied pre-ledger, schema-verified |
| `053_cs_auto_cancel_trigger.sql` | **NOT APPLIED** |
| `054_profiles_tenant_scoped_read.sql` | **NOT APPLIED** |
| `055_dashboard_indexes.sql` | **NOT APPLIED** |
| `056_cron_runs.sql` | no ledger row — applied pre-ledger, schema-verified |
| `057_email_log.sql` | no ledger row — applied pre-ledger, schema-verified |
| `058_release_notes.sql` | 20260507162540 (release_notes_058) |
| `059_incidents_core.sql` | 20260507232113 (incidents_core_059) |
| `059b_migrate_near_miss.sql` | 20260507232131 (incidents_fold_near_miss_059b) |
| `060_incident_people.sql` | 20260507232152 (incident_people_060) |
| `061_incident_attachments_and_statements.sql` | 20260507232212 (incident_attachments_statements_061) |
| `062_incident_investigations.sql` | 20260507232244 (incident_investigations_062) |
| `063_incident_actions.sql` | 20260507232313 (incident_actions_063) |
| `064_incident_care_cases.sql` | 20260507232337 (incident_care_cases_064) |
| `065_osha_compliance.sql` | 20260507232410 (osha_compliance_065) |
| `066_incident_notifications.sql` | 20260507232444 (incident_notifications_066) |
| `067_anon_intake_and_lessons.sql` | 20260507232503 (anon_intake_and_lessons_067) |
| `068_incident_anon_token_link.sql` | 20260507232515 (incident_anon_token_link_068) |
| `069_toolbox_talks.sql` | 20260508005125 (toolbox_talks_module_069) |
| `070_toolbox_signature_inserted_by.sql` | 20260508005138 (toolbox_signature_inserted_by_070) |
| `071_profile_avatars.sql` | 20260508014928 (profile_avatars_071) |
| `072_action_item_comments.sql` | 20260508014946 (action_item_comments_072) |
| `073_internal_chat.sql` | 20260508015020 (internal_chat_073) |
| `074_safety_boards.sql` | 20260508014832 (safety_boards_074) |
| `075_osha_ita_submission.sql` | 20260508010557 (osha_ita_submission_local_069) |
| `076_osha_ita_auto_submit.sql` | 20260508010617 (osha_ita_auto_submit_local_070) |
| `077_safety_boards_tier1.sql` | 20260508031829 (safety_boards_tier1_077) |
| `078_safety_boards_tier2.sql` | 20260508031858 (safety_boards_tier2_078) |
| `079_safety_boards_tier3.sql` | 20260508031959 (safety_boards_tier3_079) |
| `080_module_manuals.sql` | 20260508035228 (module_manuals_080) |
| `081_bbs_module.sql` | 20260508063136 (bbs_module_081) |
| `082_anon_receipt_code.sql` | 20260508051633 (anon_receipt_code) |
| `083_tenant_report_locale.sql` | 20260508051642 (tenant_report_locale) |
| `084_qr_token_routing.sql` | 20260508051650 (qr_token_routing) |
| `085_anon_ip_throttle.sql` | 20260508051701 (anon_ip_throttle) |
| `086_qr_token_captcha_geofence.sql` | 20260508051713 (qr_token_captcha_geofence) |
| `087_qr_token_audit_log.sql` | 20260508051725 (qr_token_audit_log) |
| `088_harden_anon_ip_throttle.sql` | 20260508051956 (harden_anon_ip_throttle_exposure) |
| `089_chemicals_module.sql` | 20260508145919 (chemicals_module_082) |
| `090_chemical_label_prints.sql` | 20260508145937 (chemical_label_prints_083) |
| `091_chemical_inventory.sql` | 20260508150004 (chemical_inventory_084) |
| `092_chemical_sds_drift.sql` | 20260508150023 (chemical_sds_drift_085) |
| `093_chemical_compliance.sql` | 20260508150057 (chemical_compliance_086) |
| `094_chemical_guardrails.sql` | 20260508150123 (chemical_guardrails_087) |
| `095_chemical_approvals.sql` | 20260508150138 (chemical_approvals_088) |
| `096_jha_step_chemicals.sql` | 20260508150155 (jha_step_chemicals_089) |
| `097_chemical_webhooks.sql` | 20260508150215 (chemical_webhooks_090) |
| `098_chemical_maq_view.sql` | 20260508150231 (chemical_maq_view_091) |
| `099_chemical_training.sql` | 20260508150245 (chemical_training_092) |
| `100_tenant_scoped_webhooks.sql` | 20260508150304 (tenant_scoped_webhooks_093) |
| `101_chemical_function_hardening.sql` | 20260508153125 (chemical_function_hardening_094) |
| `102_chemical_fk_indexes.sql` | 20260508153238 (chemical_fk_indexes_095) |
| `103_assistant_conversations.sql` | 20260508231712 (assistant_conversations_103) |
| `104_pgvector_extension.sql` | 20260508231724 (pgvector_extension_104) |
| `105_knowledge_base.sql` | 20260508231750 (knowledge_base_105) |
| `106_equipment_qr.sql` | 20260508231811 (equipment_qr_106) |
| `107_policy_uploads_bucket.sql` | 20260509012408 (policy_uploads_bucket_107) |
| `108_publish_seven_manuals.sql` | 20260509052635 (publish_seven_manuals_108) |
| `109_add_manual_source_type.sql` | 20260509052647 (add_manual_source_type_109) |
| `110_toolbox_talks_backfill_may9_jun30.sql` | 20260509061853 (toolbox_talks_backfill_may9_jun30_110) |
| `111_toolbox_talks_es_and_grade6.sql` | 20260509062807 (toolbox_talks_es_and_grade6_111) |
| `112_toolbox_talks_es_gap_fill.sql` | 20260509063340 (toolbox_talks_es_gap_fill_112) |
| `113_toolbox_talks_engaging_rewrite.sql` | 20260509070316 (toolbox_talks_engaging_rewrite_113a); 20260509070855 (toolbox_talks_engaging_rewrite_113b); 20260509071236 (toolbox_talks_engaging_rewrite_113c) |
| `114_strike_core.sql` | no ledger row — applied pre-ledger, schema-verified |
| `115_command_center_safety_alerts.sql` | 20260511043000 (command_center_safety_alerts_115) |
| `116_strike_studio_superadmin_only.sql` | no ledger row — applied pre-ledger, schema-verified |
| `117_strike_assignment_visibility.sql` | no ledger row — applied pre-ledger, schema-verified |
| `118_equipment_readiness.sql` | no ledger row — applied pre-ledger, schema-verified |
| `119_worker_readiness_command_center.sql` | no ledger row — applied pre-ledger, schema-verified |
| `120_equipment_readiness_strike_source.sql` | no ledger row — applied pre-ledger, schema-verified |
| `121_equipment_readiness_schedules.sql` | no ledger row — applied pre-ledger, schema-verified |
| `122_equipment_readiness_seed_repair.sql` | no ledger row — applied pre-ledger, schema-verified |
| `123_publish_equipment_readiness_manual.sql` | no ledger row — applied pre-ledger, schema-verified |
| `124_function_hardening.sql` | 20260506181912 (function_hardening_055) |
| `125_storage_bucket_listing_lockdown.sql` | 20260506182439 (storage_bucket_listing_lockdown_056) |
| `126_webhook_deliveries.sql` | 20260507162610 (webhook_deliveries_059) |
| `127_saved_queries.sql` | 20260507162628 (saved_queries_060) |
| `128_ai_invocations_cache_columns.sql` | no ledger row — applied pre-ledger, schema-verified |
| `129_near_miss_ai_insights.sql` | no ledger row — applied pre-ledger, schema-verified |
| `130_superadmin_daily_reports.sql` | no ledger row — applied pre-ledger, schema-verified |
| `131_unified_members.sql` | no ledger row — applied pre-ledger, schema-verified |
| `132_member_profile_workflow.sql` | no ledger row — applied pre-ledger, schema-verified |
| `133_harden_tenant_numbers.sql` | no ledger row — applied pre-ledger, schema-verified |
| `134_loto_review_business_rules.sql` | no ledger row — applied pre-ledger, schema-verified |
| `135_expand_all_user_manuals.sql` | 20260514013248 (expand_all_user_manuals_135) |
| `136_toolbox_talk_yearly_packs.sql` | no ledger row — applied pre-ledger, schema-verified |
| `137_toolbox_talk_access_hardening.sql` | no ledger row — applied pre-ledger, schema-verified |
| `138_publish_hazardous_waste_manual.sql` | 20260514012353 (publish_hazardous_waste_manual_138) |
| `139_loto_review_signoff_drop_readiness_gate.sql` | no ledger row — applied pre-ledger, schema-verified |
| `140_hazardous_waste_streams_and_containers.sql` | 20260514020509 (hazardous_waste_streams_and_containers_140) |
| `141_enable_hazardous_waste_module.sql` | 20260514012404 (enable_hazardous_waste_module_139) |
| `142_hazardous_waste_areas_inspections.sql` | 20260515042348 (hazardous_waste_areas_inspections_142) |
| `143_loto_group_permits.sql` | 20260516032848 (loto_group_permits_143) |
| `144_loto_contractor_companies.sql` | 20260516033115 (loto_contractor_companies_144) |
| `145_loto_competency_exams.sql` | 20260516033211 (loto_competency_exams_145) |
| `146_loto_walkdown_checklists.sql` | 20260516033236 (loto_walkdown_checklists_146) |
| `147_loto_energy_step_types.sql` | 20260516033258 (loto_energy_step_types_147) |
| `148_loto_periodic_inspections.sql` | 20260516033328 (loto_periodic_inspections_148) |
| `149_loto_retraining_triggers.sql` | 20260516033413 (loto_retraining_triggers_149) |
| `150_loto_signed_pdf_artifacts.sql` | 20260516033435 (loto_signed_pdf_artifacts_150) |
| `151_tenant_retention_and_legal_holds.sql` | 20260516033504 (tenant_retention_and_legal_holds_151) |
| `152_incident_capas.sql` | 20260516033531 (incident_capas_152) |
| `153_risk_controls_hierarchy.sql` | 20260516033551 (risk_controls_hierarchy_153) |
| `154_iso45001_clause_evidence.sql` | 20260516033610 (iso45001_clause_evidence_154) |
| `155_incident_predictions.sql` | 20260516033634 (incident_predictions_155) |
| `160_tenant_sso_and_scim.sql` | 20260516033704 (tenant_sso_and_scim_160) |
| `161_cmms_integrations.sql` | 20260516033735 (cmms_integrations_161) |
| `162_bbs_observations_v2.sql` | 20260516033757 (bbs_observations_v2_162) |
| `163_vendor_prequalifications.sql` | 20260516033830 (vendor_prequalifications_163) |
| `164_tenants_language_preference.sql` | 20260516033844 (tenants_language_preference_164) |
| `165_advisor_sweep.sql` | 20260516034454 (advisor_sweep_165) |
| `170_prop65_chemicals.sql` | 20260516045746 (prop65_chemicals_170) |
| `171_prop65_chemical_links.sql` | 20260516045808 (prop65_chemical_links_171) |
| `172_prop65_sites.sql` | 20260516045832 (prop65_sites_172) |
| `173_prop65_exposure_assessments.sql` | 20260516045856 (prop65_exposure_assessments_173) |
| `174_prop65_warnings.sql` | 20260516045918 (prop65_warnings_174) |
| `175_prop65_notifications.sql` | 20260516045944 (prop65_notifications_175) |
| `176_prop65_annual_reviews.sql` | 20260516050010 (prop65_annual_reviews_176) |
| `177_prop65_compliance_status.sql` | 20260516050032 (prop65_compliance_status_177) |
| `178_prop65_anon_column_grants.sql` | 20260516050043 (prop65_anon_column_grants_178) |
| `180_member_sync_triggers.sql` | 20260517045521 (member_sync_triggers_180) |
| `181_member_backfill_delta.sql` | 20260517045546 (member_backfill_delta_181) |
| `182_member_drift_audit.sql` | 20260517045624 (member_drift_audit_182) |
| `183_member_login_link.sql` | 20260517045634 (member_login_link_183) |
| `184_member_merge.sql` | 20260517045706 (member_merge_184) |
| `185_loto_workers_compat_view.sql` | 20260517045717 (loto_workers_compat_view_185) |
| `186_member_rpc_anon_revoke.sql` | 20260517045918 (member_rpc_anon_revoke_186) |
| `187_module_manual_source_type.sql` | 20260519162616 (module_manual_source_type_187) |
| `188_working_at_heights_schema.sql` | 20260519162921 (working_at_heights_schema_188) |
| `189_loto_supervisor_review_flow.sql` | 20260519195424 (loto_supervisor_review_flow) |
| `190_invite_reminders.sql` | 20260523174904 (invite_reminders) |
| `191_profile_onboarding.sql` | 20260523175732 (profile_onboarding) |
| `192_compliance_obligations.sql` | 20260523200614 (compliance_calendar_obligations) |
| `193_inspection_templates.sql` | 20260523200404 (inspection_templates) |
| `194_notification_channels.sql` | 20260523200416 (notification_channels) |
| `195_email_suppressions.sql` | 20260523223349 (195_email_suppressions) |
| `196_ehs_scorecard_targets.sql` | 20260524134701 (196_ehs_scorecard_targets) |
| `197_incident_severe_injury_reports.sql` | 20260524134719 (197_incident_severe_injury_reports) |
| `198_incident_actions_completed_by.sql` | 20260524134729 (198_incident_actions_completed_by) |
| `199_hot_work_permit_photos.sql` | 20260524150509 (199_hot_work_permit_photos) |
| `200_wls_demo_seed_functions.sql` | **NOT APPLIED** |
| `201_care_phi_confidentiality.sql` | 20260524201337 (care_phi_confidentiality) |
| `202_fleet_registers.sql` | 20260524150903 (200_fleet_registers) |
| `203_fleet_vehicle_inspections.sql` | 20260524151403 (201_fleet_vehicle_inspections) |
| `204_iso14001_ems.sql` | 20260524201400 (iso14001_ems) |
| `205_iso14001_objectives.sql` | 20260524201415 (iso14001_objectives) |
| `206_nonconformities.sql` | 20260524201437 (nonconformities) |
| `207_management_reviews.sql` | 20260524201449 (management_reviews) |
| `208_loto_equipment_manufacturer_model.sql` | 20260519223632 (loto_equipment_manufacturer_model) |
| `209_facilities.sql` | 20260524201503 (facilities) |
| `210_facility_id_columns.sql` | 20260524201519 (facility_id_columns) |
| `211_facility_rls_scope.sql` | 20260524201532 (facility_rls_scope) |
| `212_hazardous_waste_inspection_photos.sql` | 20260614232456 (hazardous_waste_inspection_photos) |
| `213_chemical_emergency_phone.sql` | 20260605191826 (chemical_emergency_phone) |
| `214_chemical_synonym_search.sql` | 20260605192828 (chemical_synonym_search) |
| `215_loto_qr_placard_and_photo_staging.sql` | 20260606055645 (loto_qr_placard_and_photo_staging) |
| `216_qr_placard_review_link.sql` | 20260606073345 (qr_placard_review_link) |
| `217_loto_audit_columns.sql` | no ledger row — applied pre-ledger, schema-verified |
| `218_loto_audit_runs.sql` | no ledger row — applied pre-ledger, schema-verified |
| `219_loto_audit_apply_and_rollback.sql` | no ledger row — applied pre-ledger, schema-verified |
| `220_loto_audit_procedure_draft.sql` | 20260608074136 (loto_audit_procedure_draft) |
| `221_loto_audit_regulator.sql` | 20260608074055 (loto_audit_regulator_columns) |
| `222_loto_audit_enforce_review_gate.sql` | 20260610023440 (loto_audit_enforce_review_gate_222) |
| `223_strike_media_hardening.sql` | 20260611172136 (strike_media_hardening) |
| `224_strike_video_provider.sql` | 20260611172144 (strike_video_provider) |
| `225_strike_vimeo_only.sql` | **NOT APPLIED** |
| `226_regulation_update_checks.sql` | 20260608041529 (regulation_update_checks) |
| `227_em385_requirements_catalog.sql` | 20260614161726 (em385_requirements_catalog) |
| `228_em385_requirements_seed.sql` | 20260614161828 (em385_requirements_seed) |
| `229_em385_projects.sql` | 20260614161845 (em385_projects) |
| `230_em385_register_items.sql` | 20260614161912 (em385_register_items) |
| `231_em385_document_files.sql` | 20260614161921 (em385_document_files) |
| `232_osha_regulation_updates.sql` | 20260617043328 (osha_regulation_updates) |
| `233_sds_library.sql` | 20260617054323 (sds_library) |
| `234_chemical_sds_fetch_pending.sql` | 20260617061958 (234_chemical_sds_fetch_pending) |
| `235_chemical_sds_photo_capture.sql` | 20260617062003 (235_chemical_sds_photo_capture) |
| `236_rca_multi_root_branching_ai.sql` | **NOT APPLIED** |
| `237_operator_console_conversations.sql` | 20260620011745 (operator_console_conversations) |
| `238_agent_action_queue.sql` | 20260620011803 (agent_action_queue) |
| `239_loto_zero_energy_certifications.sql` | 20260620011520 (loto_zero_energy_certifications) |
| `240_training_competency_matrix.sql` | 20260621062735 (training_competency_matrix) |
| `241_scale_hardening_indexes.sql` | no ledger row — applied pre-ledger, schema-verified |
| `242_retention_jobs.sql` | no ledger row — applied pre-ledger, schema-verified |
| `243_security_advisor_fixes.sql` | no ledger row — applied pre-ledger, schema-verified |
| `244_incident_ecfa.sql` | 20260715004015 (244_incident_ecfa) |
| `245_scorecard_scale_indexes.sql` | 20260715004027 (245_scorecard_scale_indexes) |
| `246_em385_number_sequences_rls.sql` | 20260715005716 (246_em385_number_sequences_rls) |
| `247_invite_tokens.sql` | 20260724172154 (247_invite_tokens) |
| `248_auth_user_email_lookup.sql` | 20260724172204 (248_auth_user_email_lookup) |
| `249_profiles_privileged_columns.sql` | 20260730231950 (249_profiles_privileged_columns) |
| `250_number_sequences_rls.sql` | 20260730232006 (250_number_sequences_rls) |
| `251_member_access_reset_event.sql` | 20260729175441 (member_access_reset_event) |
| `252_severe_injury_jurisdiction.sql` | 20260730232033 (252_severe_injury_jurisdiction) |
| `253_regulation_updates_jurisdiction.sql` | 20260730232039 (253_regulation_updates_jurisdiction) |
| `254_release_note_v1_17_0.sql` | 20260730232047 (254_release_note_v1_17_0) |
| `255_release_note_v1_17_1.sql` | **NOT APPLIED** |
| `256_wls_iso14001_demo.sql` | 20260819174319 (wls_iso14001_demo) |
| `257_predictive_safety_intelligence.sql` | **NOT APPLIED** |
| `258_loto_procedure_draft_nonempty.sql` | **NOT APPLIED** |
| `263_recover_tenants_industry_profile.sql` | 20260806042305 (tenants_industry_profile) |
| `264_recover_construction_projects.sql` | 20260806042532 (construction_projects) |
| `265_recover_fix_project_calendar_ordinal_assignment.sql` | 20260806042915 (fix_project_calendar_ordinal_assignment) |
| `266_loto_equipment_signed_placard_url.sql` | **NOT APPLIED** |

---

## 5. Verification queries used (all read-only, run 2026-08-28)

Bulk object probes (candidate lists elided to `…` — the full lists were generated from the
migration files themselves; every query returns **only the missing objects**):

```sql
-- relations (tables + views): returned exactly the 034/236/257 tables
with cand(name) as (values ('bug_reports'),('incident_rca_ai_suggestions'),('vision_sweep_runs'),…)
select name from cand where not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = cand.name and c.relkind in ('r','p','v','m','f'));

-- functions: returned cs_atmospheric_auto_cancel, current_user_visible_profile_ids,
--            seed_wls_{incidents,near_miss,bbs}_demo, apply_loto_review_photo_replacement†
with cand(name) as (values ('cs_atmospheric_auto_cancel'),…)
select name from cand where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = cand.name);
-- † expected-missing: dropped by 215_loto_qr_placard_and_photo_staging.sql:196

-- columns: returned the 236 columns + loto_equipment.signed_placard_url
with cand(tbl, col) as (values ('incident_rca_5whys','parent_id'),…)
select tbl || '.' || col from cand where not exists (
  select 1 from information_schema.columns ic
   where ic.table_schema = 'public' and ic.table_name = cand.tbl and ic.column_name = cand.col);

-- indexes: returned the 034/055/236/257 indexes, 012's idx_entries_one_open_per_entrant,
--          and idx_loto_audit_results_run (deliberately dropped out-of-band, see §4.3)
with cand(name) as (values ('idx_ai_invocations_occurred_at'),…)
select name from cand where not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = cand.name and c.relkind = 'i');

-- triggers: returned only trg_cs_atmospheric_auto_cancel (053) and the two 257 touch triggers
with cand(name) as (values ('trg_cs_atmospheric_auto_cancel'),…)
select name from cand where not exists (
  select 1 from pg_trigger t where not t.tgisinternal and t.tgname = cand.name);
```

Targeted checks:

```sql
-- 251 applied / 258 unapplied
select pg_get_constraintdef(oid) like '%access_reset%' from pg_constraint
 where conname = 'member_status_events_event_type_check';                          -- true
select 1 from pg_constraint where conname = 'loto_audit_changes_procedure_draft_nonempty'; -- 0 rows

-- 225 unapplied
select pg_get_constraintdef(oid) like '%vimeo%' from pg_constraint
 where conname = 'strike_media_access_provider_check';                             -- false
select column_default from information_schema.columns
 where table_name = 'strike_module_versions' and column_name = 'video_provider';   -- 'storage'::text

-- 254 applied / 255 unapplied
select version from release_notes where version in ('v1.17.0','v1.17.1');          -- only v1.17.0

-- 054 unapplied (the leak): production's live policy set on profiles
select polname from pg_policy p join pg_class c on c.oid = p.polrelid
 where c.relname = 'profiles';
-- profiles_admin_read_all, profiles_admin_write, profiles_self_read, profiles_self_update

-- 139 applied (readiness gate gone), 242 applied (cron jobs), 243 applied (RLS on backup)
select prosrc like '%readiness%' from pg_proc where proname = 'signoff_loto_review_link'; -- false
select jobname from cron.job;  -- member-drift-audit-daily, prune-anon-report-ip-attempts,
                               -- prune-audit-log, prune-cron-runs
select relrowsecurity from pg_class where relname = '_photo_backup_pre_v2';         -- true

-- apply-plan pre-checks (all pass as of 2026-08-28)
select count(*) from (select permit_id, entrant_name from loto_confined_space_entries
 where exited_at is null group by 1,2 having count(*) > 1) d;                       -- 0  (012)
select count(*) from loto_audit_changes where change_kind = 'procedure_draft'
 and (jsonb_typeof(new_value->'steps') is distinct from 'array'
      or jsonb_array_length(new_value->'steps') = 0);                              -- 0  (258)
select distinct provider from strike_media_access;                                  -- none (225)
select 1 from tenants where is_demo limit 1;                                        -- exists (200)

-- manuals finding (§8)
select count(*) from manuals;                                                       -- 28
select s from unnest(array['em385','prop65','working-at-heights','fleet-safety']) s
 where not exists (select 1 from manuals m where m.module_id = s);                   -- all 4 missing
```

---

## 6. Ordered apply plan

Run in this order. Every step is idempotent as written. **Apply each file through a mechanism
that records a `schema_migrations` row** (MCP `apply_migration` or `supabase migration up`), NOT
an SQL-editor paste — that is what lets `check-migration-drift.mjs` go green and is the whole
point; after each apply, delete the file's entry from
`scripts/migration-drift-baseline.json → repo_known_unapplied`. No step requires app downtime.
Steps 1–9 are independent of each other; 10→11 and 12→13→14 are ordered pairs/runs; nothing needs
to share a transaction beyond what the files' own `begin/commit` already do (`258` has no wrapper —
run its two `alter table` statements as one transaction).

| # | File | Class | Depends on | Expected effect | Verify with |
|---|---|---|---|---|---|
| 1 | `034_bug_reports.sql` | SAFE-ADDITIVE | — | `bug_reports` exists; `/api/support/bug-report` + daily-health-report stop erroring | `select 1 from pg_class where relname='bug_reports';` |
| 2 | `053_cs_auto_cancel_trigger.sql` | SAFE-ADDITIVE (behavioral: permits with failing atmospheric tests start auto-cancelling, per §1910.146(e)(5) — this is the documented intent) | `loto_atmospheric_tests` (live) | trigger live | `select tgname from pg_trigger where tgname='trg_cs_atmospheric_auto_cancel';` |
| 3 | `054_profiles_tenant_scoped_read.sql` | **NEEDS-CARE — do first among the risky ones, it closes the leak** | `current_user_tenant_ids()`, `is_superadmin()` (live) | admin-global policies replaced by tenant-visible set; its self-test do-block is documented safe from the migration role | `select polname from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname='profiles';` — expect `profiles_self_read, profiles_self_update, profiles_tenant_visible_read, profiles_superadmin_read, profiles_visible_write`; then smoke-test admin worker-picker and profile pages as a tenant admin |
| 4 | `055_dashboard_indexes.sql` | SAFE-ADDITIVE | — | 3 indexes | `select relname from pg_class where relname in ('idx_ai_invocations_occurred_at','idx_support_tickets_created_at','idx_loto_training_records_expires_at');` — 3 rows |
| 5 | re-run `012_compliance_extensions.sql` (or just its `idx_entries_one_open_per_entrant` statement — the rest is already live and fully guarded) | NEEDS-CARE (unique index; dup pre-check = 0 today, re-check at apply time) | — | double-open-entry protection restored | `select 1 from pg_class where relname='idx_entries_one_open_per_entrant' and relkind='i';` |
| 6 | `200_wls_demo_seed_functions.sql` | NEEDS-CARE (defines 3 functions **and seeds the demo tenant at apply time** — writes only to the `is_demo` tenant, deterministic ids, idempotent) | demo tenant (exists) | reset-demo RPCs exist; demo data restored | `select proname from pg_proc where proname like 'seed_wls_%';` — expect all 4 |
| 7 | `225_strike_vimeo_only.sql` | SAFE-ADDITIVE (constraint superset + default; media-access table is empty) | — | Vimeo shape representable | `select pg_get_constraintdef(oid) from pg_constraint where conname='strike_media_access_provider_check';` — contains `vimeo` |
| 8 | `236_rca_multi_root_branching_ai.sql` | SAFE-ADDITIVE | `incident_investigations` (live) | RCA assist endpoint unblocked | `select 1 from pg_class where relname='incident_rca_ai_suggestions';` + `select column_name from information_schema.columns where table_name='incident_rca_5whys' and column_name='parent_id';` |
| 9 | `255_release_note_v1_17_1.sql` | SAFE-ADDITIVE (guarded DML; note the banner clock starts at apply `now()`) | `release_notes` (live) | v1.17.1 note published | `select 1 from release_notes where version='v1.17.1';` |
| 10 | **`257_predictive_safety_intelligence.sql`** | SAFE-ADDITIVE — **unblocks three broken production surfaces**: `/api/cron/vision-sweep-resume` (2,016 consecutive failures), daily `vision-hazard-sweep`, and `draft-regulatory-document`'s paid-Anthropic-call-then-throw on `document_drafts` | `facilities` (209), `active_facility_id()` (211), `touch_updated_at()` — all live | 4 tables + 13 indexes + 4 policies + 2 triggers; the 5-minute cron goes green on its next tick | `select relname from pg_class where relname in ('vision_sweep_runs','vision_sweep_photos','vision_hazard_signals','document_drafts');` — 4 rows; then watch one `vision-sweep-resume` tick succeed |
| 11 | `258_loto_procedure_draft_nonempty.sql` | NEEDS-CARE (CHECK validates existing rows — pre-check returned 0 violators today; re-run it immediately before applying). Sorts after 257 both numerically and logically (guards the table 220 built and 257's draft flow feeds) | `loto_audit_changes` (live) | zero-step drafts rejected at INSERT | `select 1 from pg_constraint where conname='loto_audit_changes_procedure_draft_nonempty';` |
| 12 | `263_recover_tenants_industry_profile.sql` | SAFE-ADDITIVE (recovery; **no-op on production** — records the ledger linkage for the rebuilt chain) | — | none live; on fresh rebuild: `tenants.industry_profile` | `select 1 from information_schema.columns where table_name='tenants' and column_name='industry_profile';` (already true) |
| 13 | `264_recover_construction_projects.sql` | SAFE-ADDITIVE (recovery; no-op on production) — **must follow 263, precede 265** | 263; `members`(131), `facilities`(209), `pg_trgm` | none live; on rebuild: the 7-table construction schema | `select count(*) from pg_class where relname in ('construction_projects','project_areas','project_companies','project_workers','project_calendar','project_presence','construction_project_number_sequences');` = 7 |
| 14 | `265_recover_fix_project_calendar_ordinal_assignment.sql` | SAFE-ADDITIVE (recovery; re-asserts the fixed function bodies — `create or replace` to the same text) — **must follow 264** | 264 | none live | `select prosrc like '%v_offset%' from pg_proc where proname='recompute_project_calendar_ordinals' and prorettype='void'::regtype... ` simplest: `select 1 from pg_proc where proname='generate_project_calendar';` |
| 15 | `266_loto_equipment_signed_placard_url.sql` | SAFE-ADDITIVE (**proposed repair** — new column, fixes the live placard-signing bug; delete the file instead if you disagree, and remove its baseline entry) | — | 16 code sites stop 400ing; departments page counts signed placards correctly | `select 1 from information_schema.columns where table_name='loto_equipment' and column_name='signed_placard_url';` |

If MCP `apply_migration` is used, each step lands its own `schema_migrations` row named after the
file — after step 15, `SUPABASE_DB_URL=… node scripts/check-migration-drift.mjs` should report
**0 warnings** once the 11 `repo_known_unapplied` baseline entries are deleted.

Two things deliberately **not** in the plan: the ~38 unrecovered out-of-band rows (§4.3 — recover
as follow-up PRs, they are already live so nothing is broken by waiting), and any change to the
production data of the 7 construction tables (0 rows; nothing to reconcile).

---

## 7. Preventing recurrence — `scripts/check-migration-drift.mjs`

`scripts/check-migration-numbers.mjs` only guards prefix uniqueness inside the repo; nothing
compared the repo against `supabase_migrations.schema_migrations`, which is how both drifts grew
unnoticed. The new check closes that:

- **Both directions.** Fails on (1) a numbered migration file with no ledger row (the 257 failure
  mode) and (2) a ledger row with no matching file (the construction-projects failure mode).
- **Matching** replicates §2's tiers (exact `NNN_slug`, bare slug, `slug_NNN[a-z]` with renumber
  tolerance) plus an explicit `ledger_aliases` map for the handful history spelled differently.
- **Baseline, not amnesia.** `scripts/migration-drift-baseline.json` pins today's fully-reconciled
  state: 77 pre-ledger files verified applied (`repo_applied_without_ledger`), the 11 known-unapplied
  files (`repo_known_unapplied` — surfaced as warnings until applied, then the entry is deleted),
  and the 51 out-of-band versions (`db_out_of_band`). Only **new** drift fails the build, so it can
  land green today; the script also reports stale baseline entries so the file shrinks over time.
- **Opt-in, offline-safe.** Without `SUPABASE_DB_URL` it prints one line and exits 0, so the
  offline `check:repo` chain never breaks. With it, it runs one read-only `SELECT` over `psql`
  (the ledger schema is not exposed over PostgREST; any read-only role works). A
  `MIGRATION_DRIFT_LEDGER_FILE` hook feeds a saved snapshot for tests — the script was validated
  end-to-end against today's real 219-row ledger: **0 failures, 11 acknowledged warnings**.

**Proposed wiring (not applied — decide and wire yourself):**

```jsonc
// package.json
"check:migration-drift": "node scripts/check-migration-drift.mjs",
// option A: append to check:repo — safe because it self-skips without the env var
"check:repo": "… && npm run check:migration-drift"
```

and in CI, a step with the secret so it actually bites — ideally both on `main` pushes and on a
daily schedule (out-of-band applies don't wait for pushes):

```yaml
- name: Migration drift (repo ↔ production ledger)
  env: { SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL_READONLY }} }
  run: node scripts/check-migration-drift.mjs
```

---

## 8. Related findings

1. **`check:manuals` cannot catch the failure it exists for.** It validates
   `seed_module_manuals.sql` against `features.ts` — the seed file, not the database. Production
   `manuals` has **28 rows** and is missing `em385`, `prop65`, `working-at-heights`,
   `fleet-safety` (verified, §5), yet CI is green. Not fixed here (needs the same opt-in-DB-mode
   treatment as the drift check, or a run of `/api/superadmin/manuals/bootstrap`); noted for
   follow-up.
2. **`219_loto_audit_apply_and_rollback.sql` is invisible to the repo's own tooling.** Both
   `check-migration-numbers.mjs` and `next-migration-number.mjs` exclude `*_rollback.sql`, which
   silently drops this *forward* migration (it is applied — its three snapshot tables hold live
   rows). `check-migration-drift.mjs` uses the tighter `^\d{3}[a-z]?_rollback\.sql$`; the other
   two scripts deserve the same one-line fix (not made here — they were out of scope).
3. **Correction to `saas-evaluation-2026-08-20.md` §2.3:** the "four unapplied migrations" list
   (034, 134, 236, 257) is two-thirds right — `134` is applied except for the
   `signed_placard_url` **chain gap** (the column was never created by any migration, so "apply
   134" was never the fix; `266` is), and the full sweep here found **ten** plus the `012`
   partial. Also `251` is applied, contrary to the task brief.
4. **Session/branch note:** this work was done on the checked-out branch `fix/audit-remediation`
   (clean at `84b21555` before this pass), **not `main`** as the task description assumed. No
   branch was switched, nothing was committed; new/changed files are left in the working tree.
5. **Ledger self-collisions:** out-of-band rows claim numbers `217`/`226`/`227`/`228`/`232`–`234`
   that the repo has since reassigned to different migrations — one more reason the drift check
   matches on slug and never trusts embedded numbers.

---

## Files produced by this pass

| Path | What |
|---|---|
| `apps/web/migrations/263_recover_tenants_industry_profile.sql` | recovery of `20260806042305`, body md5-verified |
| `apps/web/migrations/264_recover_construction_projects.sql` | recovery of `20260806042532`, body md5-verified |
| `apps/web/migrations/265_recover_fix_project_calendar_ordinal_assignment.sql` | recovery of `20260806042915`, body md5-verified |
| `apps/web/migrations/266_loto_equipment_signed_placard_url.sql` | proposed chain-gap repair (new SQL, clearly marked) |
| `scripts/check-migration-drift.mjs` | two-way repo ↔ ledger drift check (opt-in via `SUPABASE_DB_URL`) |
| `scripts/migration-drift-baseline.json` | acknowledged historical drift; shrink as items are fixed |
| `docs/audits/migration-reconciliation-2026-08-28.md` | this report |
