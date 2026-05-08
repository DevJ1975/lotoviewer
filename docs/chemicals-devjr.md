# Chemical Management — devjr audit report

Comprehensive audit of the Chemical Management module shipped via PR #44 (Phases A → G + follow-ups). Migrations 089-102, 28 API routes, 14 pages, 5 lib files, 1 cron, 1 email helper, 1 core module.

## Baseline

| Metric | Result |
|---|---|
| `tsc --noEmit` | 1 pre-existing error (`__tests__/api/ai/_helpers.ts`, non-chemical) |
| `vitest run` | **2146 / 2146 passing**, 129 test files |
| Prebuild guards | `[migration-numbers] OK (102/102 unique)`, `[manual-coverage] OK (22/22)` |
| `as any` in chemical surface | 0 |
| `@ts-ignore` / `@ts-expect-error` in chemical surface | 0 |
| `console.log` in chemical surface | 0 |
| `TODO` / `FIXME` / `HACK` in chemical surface | 0 |

## Findings shipped as PRs

### PR #47 — PostgREST 2-FK ambiguity ✅
Two consumers of `chemical_sds_documents` embedded `chemical_products` without disambiguating the two-FK relationship (`product_id` vs `active_sds_id`). Fixed via `chemical_products!product_id(...)` shorthand in `review-queue/route.ts` and `cron/chemicals-weekly-digest/route.ts`. Cross-checked the rest of the surface: `chemical_sds_revision_checks` has its own two-FK pair (`baseline_sds_id`, `new_sds_id` → `chemical_sds_documents`) but nothing currently embeds across that pair, so no second fix needed.

### PR #48 — SSRF redirect-bypass + state-machine PATCH ✅
**Two bugs, both real, both shipped:**

1. **SSRF: redirect-bypass in `lib/chemicalSdsFetch.ts`**. `redirect: 'follow'` walked redirect chains without revalidating each hop's host against the allowlist + private-IP guard. An allowlisted host with an open redirect (CDC and NIH have shipped these in the past) could 302 to attacker infrastructure or to a same-host internal IP. Fix: re-validate `resp.url` against the full guard chain post-fetch, before reading the body.

2. **State-machine bypass on `/api/chemicals/inventory/[id]` PATCH**. `isLegalStatusTransition` was defined and unit-tested but **never called from production code**. A regular tenant member could PATCH `requested → in_stock` directly, bypassing the admin-gated `/approve` route entirely (self-approval). Or `disposed → in_stock` (resurrect a disposed container). Fix: PATCH now reads the current row, runs `isLegalStatusTransition`, and additionally blocks `requested → in_stock | rejected` (process layer — those go through `/approve` only).

The `/approve` endpoint itself was verified solid: optimistic-concurrency guard via `.eq('status', 'requested')` on UPDATE, admin-gated, race-safe under multi-admin or admin-vs-worker contention.

## Findings NOT shipped (preference / scale / deferred)

### Tenant-policy tables accept member-level writes
`chemical_restricted_list`, `chemical_max_allowable_quantities`, and `chemical_incompatibility_overrides` are tenant-wide policy. The migrations declare `policy ... for all to authenticated using (tenant scope)` — no admin role check. The matching API routes use `requireTenantMember` then `supabaseAdmin().from(...).insert(...)` (RLS-bypass).

**Net effect:** any tenant member can ban a chemical for the entire org, set MAQ caps, or override storage incompatibility rules.

This matches the project's broader convention (incident actions, JHA, hot-work permits all let members create), but those are operational, not policy. Tenant-policy operations being admin-only would tighten the security posture without breaking the operational flow.

**Recommendation:** Switch `restricted` and `maq` POST/DELETE routes to `requireTenantAdmin`, and tighten the RLS policies to `... and current_user_role() in ('owner','admin')`. Defer `incompatibility_overrides` since it's pre-launch.

### Weekly digest N+1 (documented in code)
`cron/chemicals-weekly-digest/route.ts:247-254` calls `auth.admin.getUserById(uid)` once per recipient. Comment in code acknowledges the tradeoff: *"One round-trip per admin is fine at the scale this cron runs (handful per tenant, weekly)."*

True at current scale (2 tenants × ~3 admins). At ~50 tenants × ~10 admins = 500 sequential round-trips, this approaches the 60 s Vercel cron timeout. The fix when scale demands it: query `auth.users` directly via service role (`admin.from('users').select('id, email').in('id', uids)` against the auth schema), or use `listUsers({ perPage: 1000 })` then filter.

**Recommendation:** Revisit at ~30 tenants. Not actionable now.

### Placard hazard panel can overflow page bottom
`chemicalLabels.ts` `drawPlacard` decrements `cy` per hazard line without bounds-checking against the bottom margin. With 8 hazards × 2 wrapped lines × 16 pt + 28 pt title + 200 pt NFPA diamond + pictogram strip, an 8.5 × 11 placard fits comfortably. An 11 × 17 placard fits with room to spare. But if a tenant overrides the hazard cap (or a malformed product has 100 hazard statements injected directly), text could run below the bottom margin.

The cap at line 305 (`hazard_statements.slice(0, 8)`) prevents this in practice. Cosmetic only. **No fix needed.**

### `chemical_next_barcode` SECURITY DEFINER doesn't verify caller's tenant membership
The function takes `p_tenant uuid` and inserts/increments the barcode sequence for that tenant. It doesn't check that the caller is a member of `p_tenant`. **Mitigated** by migration 101 revoking `EXECUTE` from public/anon/authenticated — only the service-role client can call it. Single caller (`inventory/route.ts:146`) passes `gate.tenantId` from the validated auth gate.

Defense-in-depth would add the membership check inside the function. Not strictly needed given the EXECUTE revoke, but cheap insurance.

**Recommendation:** Optional. Add a `if (auth.uid() not in (select user_id from tenant_memberships where tenant_id = p_tenant)) raise exception ...` if a future migration ever exposes the function more broadly.

### DNS rebinding in `chemicalSdsFetch.ts`
The fix in PR #48 closes redirect-bypass. DNS rebinding (separate-pool DNS server returns different IPs on first vs second lookup, where the first passes our `resolvesPublicly` check and the second resolves to a private IP during `fetch`) remains theoretically possible.

Proper fix: a custom `https.Agent` that pins the resolved IP between the DNS check and the fetch. Non-trivial. The bytes-from-private-IP attack also requires the response to pass the `application/pdf` content-type filter, so the practical exposure is limited to internal services that serve PDFs (e.g. an internal document store).

**Recommendation:** Deferred. Document threat model + mitigation plan in `lib/chemicalSdsFetch.ts` JSDoc if it ever moves beyond admin-curated URLs.

## Verified solid (no findings)

- **Auth gates** match project convention. The 28 chemical routes correctly use `requireTenantMember` for operations, `requireTenantAdmin` only on the approve/reject path. Verified against the incidents module's gate posture as the reference.
- **Tenant scoping**. Every authed-client query has `.eq('tenant_id', gate.tenantId)`. Service-role queries pass tenant from the gate.
- **Approve / reject race conditions**. Optimistic-concurrency guard (`.eq('status', 'requested')` on the UPDATE) is correctly placed. Two admins racing → one wins, the other gets 409. Admin vs worker race → admin's UPDATE matches 0 rows → 409.
- **Label PDF rendering**. Pictogram input filtered against allowlist, capped at 6 (secondary container) / dynamic break (placard). Hazard statements capped. Wrap helper handles long words via character-break. WinAnsi sanitization everywhere. Empty arrays handled gracefully. NFPA values null-tolerant. Standard PDF fonts (Helvetica + Bold).
- **Pictogram drawer** returns early on unknown code (`if (!symbolPath) return`). No throw on malformed input.
- **Views**. All 5 chemical views use `with (security_invoker = true)` — RLS scoped to caller, not view owner.
- **`chemical_next_barcode` RPC**. EXECUTE revoked from authenticated/anon (migration 101). `search_path` pinned. Single caller passes validated `gate.tenantId`.
- **`fire_webhooks()`** rewritten in migration 100 to extract tenant from payload and fan out only to subscribers matching `tenant_id IS NULL OR tenant_id = payload_tenant`. Tenant A admins cannot read Tenant B webhooks.
- **Prebuild guards**. Migration numbering, manual coverage, deeplink placeholders all green.

## Things this audit could NOT verify

The sandbox I ran in has no browser, no iPad, no real Supabase backend other than the production project. The smoke-checklist below is the manual layer.

- Whether the GHS pictograms read as the canonical UN symbols at print resolution on actual Brother QL-820 / 4×6 / 8.5×11 stock
- Whether the BarcodeDetector camera flow works in real Safari iOS / Chrome on a phone
- Whether the SDS drift cron's nightly fetch survives real manufacturer redirect chains (the SSRF fix may now reject some manufacturer URLs that legitimately redirect to a different host — operators can add the redirect target to `CHEMICAL_SDS_HOST_ALLOWLIST` if so)
- Whether the weekly digest email renders correctly in Outlook + Gmail (HTML email rendering is fragile)
- Whether the laser-overlay scanner (PR #46) reads as a "this is a scanner" affordance to operators

## Smoke checklist

Run on the production deploy after PR #47, #48, #45 land. Expect ~30 minutes.

### Catalog + SDS

- [ ] `/chemicals` lists products. Search by name, CAS, manufacturer all work. Filter by GHS pictogram works.
- [ ] Click an existing product → detail page renders. Active SDS PDF link works (or "no SDS" banner if none).
- [ ] `/chemicals/new` — create a product with a CAS that's on the demo's restricted list (benzene 71-43-2). Expect 409 with `requires_override` flag.
- [ ] Create a normal product, upload a PDF SDS, click "Parse SDS". Wait for AI completion, see fields populated in `/chemicals/review`. Approve a subset of fields. Verify they land on the product detail page.

### Inventory

- [ ] `/chemicals/inventory` — list of containers. Filter by status, filter by `?expiring=true`.
- [ ] Click a container in `requested` status → detail page. As an admin, click Approve (status flips to `in_stock`). As a worker, try to PATCH a `requested` container to `in_stock` directly via the API — expect 403 (post PR #48).
- [ ] PATCH a `disposed` container back to `in_stock` via API — expect 409 illegal transition (post PR #48).
- [ ] `/chemicals/scan` — point camera at a CHEM-… barcode. Verify the red laser sweeps top→bottom. Verify resolution.
- [ ] `/chemicals/locations` — three-level tree renders. Add a sub-location. Path string updates correctly.

### Compliance + admin

- [ ] `/chemicals/restricted` — add a CAS rule, attempt to create a product matching it, refused.
- [ ] `/chemicals/maq` — add a flammable-class cap of 1 gal. Verify any inventory above 1 gal of flammables shows the cap-exceeded pill on the dashboard.
- [ ] `/chemicals/tier-two` — verify rollup. Click "Export CSV", verify RFC-4180 quoting on a name with a comma.
- [ ] `/chemicals/drift` — trigger a manual revision check on a product with a real manufacturer URL. Verify a row appears in the drift log.
- [ ] As superadmin, manually trigger the weekly digest cron (`POST /api/cron/chemicals-weekly-digest` with the secret header). Verify recipients get an email if their tenant has actionable items, else a noop.

### JHA × chemical

- [ ] On a JHA step, link a chemical. Verify the rollup PPE chips include that chemical's `ppe_required` set.
- [ ] On a chemical detail page, see the reverse "JHAs using this" panel.

### Webhook tenant scope

- [ ] As a tenant admin, add a tenant-scoped webhook subscription pointing at requestbin.
- [ ] Create a chemical product. Verify your bin received a `chemical.product_created` event.
- [ ] As a different-tenant admin with a different bin URL, verify they did NOT receive that event.

## Open PRs at the time of writing

| PR | Branch | Status |
|---|---|---|
| #44 | claude/chemical-management-system-plan-566GG | ✅ merged |
| #45 | claude/chemicals-demo-seed | demo data for WLS Demo |
| #46 | claude/chemicals-scan-laser | red laser overlay |
| #47 | claude/chemicals-sds-embed-fix | PostgREST 2-FK fix |
| #48 | claude/chemicals-devjr-fixes | this audit's fixes (SSRF + state machine) |

Merge order suggestion: #47 → #48 → #46 → #45 (lowest risk first).
