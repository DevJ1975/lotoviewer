-- Migration 041: Seed controls_library with baseline controls.
--
-- Seeds ~30 starter controls across all 5 hierarchy levels, applied
-- per tenant. Each tenant gets the same baseline set on first apply
-- of this migration; tenants can extend via the (slice-4) Controls
-- Library admin UI.
--
-- Hierarchy levels (ISO 45001 8.1.2):
--   elimination    — remove the hazard entirely
--   substitution   — replace with a safer alternative
--   engineering    — guards, ventilation, isolation, interlocks
--   administrative — procedures, training, signage, rotation
--   ppe            — gloves, respirators, hearing protection
--
-- Each control is tagged with the hazard categories it most often
-- addresses (PDD §5.2 taxonomy), powering the "suggested controls"
-- filter in the wizard.
--
-- Idempotent — uses ON CONFLICT (tenant_id, hierarchy_level, name)
-- DO NOTHING so re-running this migration after a tenant has
-- customized their library is safe (existing rows untouched, the
-- baseline ones reinserted only if a tenant somehow deleted one).
--
-- Future tenants: new tenants created AFTER this migration is
-- applied will NOT automatically get the seed. A trigger on
-- tenants INSERT to copy the baseline is slice-4 work; for now
-- the slice-3 wizard renders a "no library yet — type a custom
-- control" state if controls_library returns zero rows.

begin;

-- ──────────────────────────────────────────────────────────────────────────
-- Seed routine — applies one row per (tenant, hierarchy, name) tuple
-- ──────────────────────────────────────────────────────────────────────────

do $$
declare
  t record;
  -- A baseline control template. Postgres composite type defined inline
  -- below as a one-shot anonymous block.
  baseline jsonb := '[
    {"hl":"elimination",   "name":"Remove the hazardous task from the workflow",          "desc":"Substitute or redesign the process so the hazardous step is no longer performed.",                  "cats":["physical","chemical","mechanical","ergonomic"]},
    {"hl":"elimination",   "name":"Decommission the hazardous equipment",                "desc":"Permanently retire the equipment introducing the hazard; verify with LOTO + tag-out documentation.", "cats":["mechanical","electrical","physical"]},
    {"hl":"elimination",   "name":"Eliminate exposure pathway (sealed system)",          "desc":"Convert open-process operations to fully sealed systems removing worker exposure entirely.",        "cats":["chemical","biological","radiological"]},

    {"hl":"substitution",  "name":"Replace with non-hazardous alternative",              "desc":"Substitute a chemical, material, or process with one that does not present the hazard.",            "cats":["chemical","biological","environmental"]},
    {"hl":"substitution",  "name":"Use lower-energy equipment / process",                "desc":"Reduce the inherent energy in the system (lower voltage, lower pressure, lower speed).",            "cats":["electrical","mechanical","physical"]},
    {"hl":"substitution",  "name":"Switch to less-toxic chemistry",                      "desc":"Use a chemistry/formulation with a lower SDS health hazard rating.",                                "cats":["chemical","biological"]},

    {"hl":"engineering",   "name":"Machine guarding (fixed or interlocked)",             "desc":"Physical barrier preventing contact with the hazard; interlocked guards stop the machine on open.",  "cats":["mechanical","physical"]},
    {"hl":"engineering",   "name":"Local exhaust ventilation (LEV)",                     "desc":"Capture airborne contaminants at the source (1910.94/95).",                                          "cats":["chemical","biological","radiological"]},
    {"hl":"engineering",   "name":"Lockout/tagout (LOTO) hardware",                      "desc":"Energy-isolating devices + locks per OSHA 1910.147.",                                               "cats":["electrical","mechanical","physical"]},
    {"hl":"engineering",   "name":"Ground-fault circuit interrupter (GFCI)",             "desc":"Detects ground faults and trips circuit; required in wet locations per NEC 210.8.",                "cats":["electrical"]},
    {"hl":"engineering",   "name":"Ergonomic workstation redesign",                      "desc":"Adjustable-height work surfaces, anti-fatigue matting, neutral-posture tooling.",                    "cats":["ergonomic","physical"]},
    {"hl":"engineering",   "name":"Sound enclosure / acoustic barriers",                 "desc":"Reduce noise exposure at the source; required engineering control under 1910.95 above 90 dBA.",   "cats":["physical"]},
    {"hl":"engineering",   "name":"Spill containment (secondary containment)",           "desc":"Bunds, drip trays, double-walled tanks per EPCRA/RCRA.",                                            "cats":["chemical","environmental"]},
    {"hl":"engineering",   "name":"Pressure relief valve / rupture disk",                "desc":"Mechanical overpressure protection on closed systems; PSM 1910.119(j).",                            "cats":["mechanical","chemical"]},
    {"hl":"engineering",   "name":"Emergency stop (E-stop)",                             "desc":"Hard-wired stop circuit on machinery; ANSI B11.0 + ISO 13850 compliant.",                            "cats":["mechanical","electrical"]},

    {"hl":"administrative","name":"Written safe-work procedure (SWP)",                   "desc":"Documented step-by-step procedure with hazards + controls reviewed annually.",                       "cats":["physical","chemical","biological","mechanical","electrical","ergonomic","psychosocial","environmental","radiological"]},
    {"hl":"administrative","name":"Job Safety Analysis (JSA / JHA)",                     "desc":"Per-task hazard analysis with worker participation per ISO 45001 5.4.",                              "cats":["physical","chemical","biological","mechanical","electrical","ergonomic","psychosocial"]},
    {"hl":"administrative","name":"Initial + refresher training",                        "desc":"Topic-specific training documented with completion records (1910.132(f) for PPE; topic-specific elsewhere).", "cats":["physical","chemical","biological","mechanical","electrical","ergonomic","psychosocial","environmental","radiological"]},
    {"hl":"administrative","name":"Pre-task safety briefing (toolbox talk)",             "desc":"Documented daily/shift briefing covering hazards + controls for the day''s work.",                  "cats":["physical","mechanical","electrical","environmental"]},
    {"hl":"administrative","name":"Permit-to-work system",                               "desc":"Written authorization for high-risk work (hot work 1910.252, confined space 1910.146, LOTO 1910.147).", "cats":["physical","chemical","mechanical","electrical"]},
    {"hl":"administrative","name":"Work rotation / exposure limits",                     "desc":"Limit exposure time per shift; required for heat illness §3395 + repetitive-motion ergonomics.",     "cats":["physical","ergonomic","biological"]},
    {"hl":"administrative","name":"Safety signage + warning labels",                     "desc":"ANSI Z535-compliant signs at hazard locations + GHS labels on chemical containers.",                "cats":["physical","chemical","electrical"]},
    {"hl":"administrative","name":"Periodic equipment inspection",                       "desc":"Documented inspection schedule with findings logged + corrective actions tracked.",                  "cats":["mechanical","electrical","physical"]},
    {"hl":"administrative","name":"Anonymous hazard-reporting channel",                  "desc":"Worker hazard reports per Cal/OSHA §3203(a)(3); anonymous + retaliation-free.",                     "cats":["physical","chemical","biological","mechanical","electrical","ergonomic","psychosocial"]},

    {"hl":"ppe",           "name":"Safety glasses / face shield",                        "desc":"ANSI Z87.1-rated eye protection. PPE hazard assessment required per 1910.132(d).",                  "cats":["physical","mechanical","chemical","radiological"]},
    {"hl":"ppe",           "name":"Hearing protection (plugs / muffs)",                  "desc":"NRR appropriate to TWA exposure; 1910.95 requires when ≥85 dBA TWA.",                                "cats":["physical"]},
    {"hl":"ppe",           "name":"Chemical-resistant gloves",                           "desc":"Selected by SDS-listed chemical compatibility; nitrile/neoprene/butyl per chemistry.",                "cats":["chemical","biological"]},
    {"hl":"ppe",           "name":"Respirator (half-face / full-face / SCBA)",           "desc":"Selected per 1910.134; medical clearance + fit-test + maintenance program required.",                "cats":["chemical","biological","radiological"]},
    {"hl":"ppe",           "name":"Hard hat (Type I / Type II)",                         "desc":"ANSI Z89.1; required where head-impact / falling-object hazards exist.",                            "cats":["mechanical","physical"]},
    {"hl":"ppe",           "name":"Safety footwear (steel-toe / metatarsal)",            "desc":"ASTM F2413; required where impact / compression / electrical hazards exist.",                       "cats":["mechanical","electrical","physical"]},
    {"hl":"ppe",           "name":"Arc-flash PPE (rated suit)",                          "desc":"NFPA 70E-compliant garment + face shield; selected per arc-flash incident energy calc.",            "cats":["electrical"]},
    {"hl":"ppe",           "name":"Fall-protection harness + lanyard",                   "desc":"OSHA 1910.140; required at heights ≥4 ft general industry / ≥6 ft construction.",                  "cats":["physical","mechanical"]}
  ]'::jsonb;
  item jsonb;
begin
  for t in select id from public.tenants where status != 'archived' loop
    for item in select * from jsonb_array_elements(baseline) loop
      insert into public.controls_library
        (tenant_id, hierarchy_level, name, description, applicable_categories, active)
        values (
          t.id,
          item->>'hl',
          item->>'name',
          item->>'desc',
          item->'cats',
          true
        )
      on conflict (tenant_id, hierarchy_level, name) do nothing;
    end loop;
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
