# Module 3 — Platform Features Smoke Test

Goal: verify the six Module 3 subareas (SSO/SAML config, SCIM 2.0,
CMMS sync, BBS v2, vendor prequalification, multi-language i18n) work
end-to-end. Run as a tenant admin on a non-prod tenant.

## A — SAML/OIDC SSO config

1. Open `/admin/sso`. Pick provider = SAML, paste a valid IdP metadata
   URL, save. Disabled toggle should default to off.
2. Verify the form persists across reload.
3. The page should display a callout: "next step — a superadmin must
   enable SAML on this tenant in Supabase Auth before users can sign
   in via SSO." (The route persists config only; Supabase activation
   is a manual step.)

## B — SCIM 2.0 user provisioning

1. Open `/admin/scim`. Click **Issue new token**, name it
   "Okta-test". The plaintext token displays ONCE in a modal — copy
   it. Close the modal. The page should show the token in the list
   with the prefix only (e.g. `oktl_abc123...`).
2. Re-open the page; verify the plaintext is NOT shown. Only the
   hash-derived display string + revoke action.
3. Test the SCIM endpoint via curl:
   ```
   curl -X POST https://<your-app>/api/scim/v2/Users \
     -H "Authorization: Bearer <pasted-token>" \
     -H "Content-Type: application/scim+json" \
     -d '{
       "schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],
       "userName":"alice@example.com",
       "externalId":"ext-okta-1",
       "name":{"givenName":"Alice","familyName":"Test"},
       "active":true
     }'
   ```
   Expected: 201 with the created user + Location header pointing at
   `/api/scim/v2/Users/<id>`.
4. List: `curl -H "Authorization: Bearer <token>" .../api/scim/v2/Users`
   should return the SCIM list response with the new user.
5. Filter: `?filter=userName eq "alice@example.com"` should narrow
   the list to one row.
6. PATCH: `PATCH /Users/<id>` with `{"Operations":[{"op":"replace","path":"active","value":false}]}`
   should deactivate the user. Verify via the worker page.
7. **Auth probe:** call any SCIM endpoint with a revoked token, a
   wrong-prefix token, and a missing Authorization header. All must
   return 401 with `application/scim+json` content type.

## C — CMMS bidirectional sync

1. Open `/admin/cmms`. Click **Add integration**, pick `generic`,
   name = "Sandbox", base_url = `https://example.com`, generate a
   webhook secret. Save.
2. The integration detail page shows the webhook URL and the secret
   (one-time reveal pattern). Copy both.
3. Send a test webhook locally:
   ```
   BODY='{"event_type":"work_order.opened","work_order_id":"WO-100","equipment_id":"EQ-5","status":"open"}'
   SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "<secret>" | awk '{print $2}')"
   curl -X POST <webhook-url> \
     -H "X-Soteria-Signature: $SIG" \
     -H "Content-Type: application/json" \
     -d "$BODY"
   ```
   Expected: 200, event row in `cmms_sync_events`,
   `cmms_work_order_links` row created/updated.
4. **HMAC probe:** send the same body with a wrong signature → 401.
   Send with no signature header → 401. Both must reject BEFORE any
   DB write happens (verify by checking `cmms_sync_events` count).
5. Open the equipment detail page for EQ-5. Verify the
   `OpenWorkOrderCallout` shows "1 open work order".
6. Send a `work_order.closed` webhook. The callout should disappear.
7. **Disabled integration:** disable the integration, send another
   webhook. Should return 404 (same as missing — no info leak).

## D — BBS v2 observations + dashboard

1. From a phone or tablet, open `/bbs/observe`. The form should be
   mobile-first (large tap targets).
2. Submit three safe_behavior observations and one unsafe_condition.
3. Open `/admin/bbs/dashboard`. Verify:
   - Total = 4
   - Safe-to-unsafe ratio = 3.0 → yellow band
   - Breakdown tiles show the counts
4. Add a follow-up-required unsafe_act observation. Verify it appears
   in the "Follow-ups due" list.
5. Mark the follow-up complete on the dashboard. Verify it drops out
   of the due list but stays in the totals.

## E — Vendor prequalification

1. Open `/admin/contractors`. Open any contractor company, click
   **Manage prequalification**.
2. Enter the contractor email. The system generates a portal token
   (32 lowercase hex chars) and surfaces the public URL.
3. Open the public URL in an incognito browser. The form should
   render without a login. Verify the contractor sees Q1–Q8 fields,
   the boolean drug/alcohol toggle, and a submit button.
4. **Token probe:** swap any character of the token in the URL → 404.
   Use a token that doesn't match the regex → 400.
5. Fill in answers, submit. The admin page should now show status =
   `in_progress`.
6. Mark approved with an expiry 31 days out. Verify the helper
   `classifyPrequal` buckets this as `approved`.
7. Adjust expiry to 25 days out. Verify buckets as `expiring`.
8. **410 probe:** mark as `expired` or `rejected`, hit the public
   URL → 410 with friendly message, no leak of the answers.

## F — Multi-language i18n

1. Open `/admin/configuration`. The language dropdown should offer
   English / Español / Français. Pick Español, save.
2. Generate a fresh placard PDF from any equipment. Verify the
   placard title + headers are in Spanish (e.g. "PROCEDIMIENTO DE
   BLOQUEO/ETIQUETADO").
3. Switch to Français, regenerate placard. Verify French strings.
   Note: per the agent's report, the placard PDF generator is
   bilingual EN/ES today; French is dictionary-ready but the
   placard renderer hasn't wired the third language yet. This is
   the documented gap — the dictionaries are in place, the placard
   wiring follows.
4. Switch back to English. Verify default placard rendering.

## G — Cross-cutting checks

### Tenant isolation
- All Module 3 admin pages should respect the tenant pill in the
  header. Switching tenants reloads the page's data.

### Audit log
- `/admin/audit` should record every:
  - SCIM token issuance + revocation
  - CMMS integration add/edit/disable + every inbound webhook event
  - BBS observation create
  - Vendor prequal status change
  - SSO config edit

### Search-path hardening
- The only new SECURITY DEFINER function in Module 3 is
  `set_vendor_prequal_token` in migration 163; verified to use
  `search_path = pg_catalog, public, extensions` during the audit.

---

## What's NOT covered by tests and needs manual verification

- **SCIM real-IdP integration** — Okta / Azure AD / Google Workspace
  testing against the SCIM endpoint. The internal unit tests cover
  the parser + schema; only a live IdP exercises the protocol.
- **CMMS real-vendor integration** — Maximo, SAP PM, eMaint each
  have their own quirks. The HMAC + payload validator is generic;
  the per-vendor flavor needs live testing.
- **The OpenWorkOrderCallout banner** — manual verification on a
  real equipment record with an open WO.
- **Mobile capture UX on /bbs/observe** — the unit tests don't drive
  a real iPhone/iPad. Manually verify on the actual devices the
  shop floor uses.
- **Placard PDF rendering in French** — the dictionary exists but
  the placard wiring punted to French in this release. Add a small
  follow-up PR once the bilingual EN/ES code path is generalized.
