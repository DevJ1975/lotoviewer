# Smoke test — SDS discovery + facsimile

Manual checks to run against a real browser (the sandbox can't drive the UI or
the live web-search path). Routes live on a chemical's detail page:
`/chemicals/<productId>`.

## Facsimile (regenerate)

1. **Approved parse → facsimile shows.** Open a chemical that has an SDS whose
   parse is approved (`parse_review_status='approved'` and a `parse_model`).
   The revision row shows a **Facsimile** action.
   - Click it → modal renders **16 numbered sections** in order, a red
     **"Reformatted … not the original document of record"** banner, and a
     provenance line (source URL, revision/parsed dates, model, confidence).
   - Unparsed/un-extracted sections (10–13, 15) read **"Not extracted from the
     source SDS"** — not blank.
   - **View original PDF** opens the manufacturer PDF (signed URL).
   - **Download PDF** produces a PDF whose content matches the on-screen view,
     including the banner + per-page footer legend. Chemical formulae with
     subscripts (CO₂, H₂S) render without crashing.
2. **Pending/never-parsed → no facsimile.** A revision that is only uploaded or
   is `pending` shows **no** Facsimile button. Hitting
   `GET …/sds/<sdsId>/facsimile` directly returns **409**.

## Discovery (find online) — needs a live `ANTHROPIC_API_KEY`

3. **Find candidates.** On a product with a name (and ideally manufacturer /
   product code), click **Find SDS online**. After the search, a candidate
   panel lists 0–5 results with confidence + reasons + source links.
4. **Confirm & fetch.** Click **Confirm & fetch** on a candidate.
   - A new revision appears **via ai_fetch**, marked **ACTIVE** (it supersedes
     any previous active revision — verify the old one shows *superseded*).
   - The header **Manufacturer source** link is now set to the fetched URL.
5. **Through the existing pipeline.** Click **Parse with AI** on the new
   revision → review on `/chemicals/review` → approve. The **Facsimile** action
   then appears for it.
6. **Rate limit.** Repeat **Find SDS online** past the cap (15/hr) → a 429 with
   a friendly message; the attempt is logged in `ai_invocations`.

## Security / tenancy

7. **SSRF guards hold.** (Best exercised by unit tests, but if you can craft a
   request:) `POST …/sds/fetch` with an `http://` URL, a private/loopback host,
   or a non-PDF response is refused (400/422) — `allowAnyHost` only relaxes the
   *host allowlist*, never the scheme/IP/content-type/size guards.
8. **Tenant scope.** A member of tenant A cannot discover/fetch/facsimile a
   product belonging to tenant B (RLS + the routes' `tenant_id` filters).

## Regression

9. **Drift unchanged.** "Check for revision" still fetches only allowlisted
   manufacturer hosts (no `allowAnyHost`).
10. **Upload unchanged.** Manual SDS upload still activates + supersedes as
    before.
