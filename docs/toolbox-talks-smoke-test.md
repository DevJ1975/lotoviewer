# Toolbox Talks — smoke test checklist

The toolbox-talks module landed on `claude/toolbox-talks-signin-module-vGU46`.
Static checks are green (tsc, eslint, 1911-test vitest, production
build), but the surfaces below need real human eyes on a browser /
tablet before TestFlight or prod.

## Prereqs

- [ ] Migration `069_toolbox_talks.sql` applied to the target Supabase
      project. Verify with: `select count(*) from public.toolbox_topics
      where industry='general' and active = true;` → expect 100.
- [ ] On the tenant you're testing as: `tenants.modules->>'toolbox-talks'
      = 'true'` (or `null`, since the module's static default is
      enabled).
- [ ] At least one toolbox talk exists for today. To force the two-week
      schedule without
      waiting for the Sunday cron, curl the cron with `CRON_SECRET`:

      ```
      curl -X POST https://<host>/api/cron/generate-toolbox-talks \
        -H "Authorization: Bearer $CRON_SECRET"
      ```

      Expect `{"tenants_scanned": N, "talks_generated": M, …}`.

## Cron generation

- [ ] First curl after migration: `talks_generated` ≈ `tenants_scanned * 7`.
- [ ] Second curl immediately after: `talks_generated` = 0 (idempotent).
- [ ] DB row check: `select talk_date, title, length(body_markdown)
      from toolbox_talks where tenant_id = '<id>' order by talk_date;`
      — expect 7 distinct dates from today forward, titles non-empty,
      body lengths between 1500 and 8000 chars.
- [ ] Topic rotation: run a SECOND week of generation (advance system
      date or wait), then check that the new week's topics don't
      overlap the previous week's: `select count(distinct topic_id)
      from toolbox_talks where tenant_id = '<id>'` should equal the
      total talks count up to ~the topic-pool size.
- [ ] Sentry sanity: no errors tagged
      `route:/api/cron/generate-toolbox-talks` in the run.

## /toolbox-talks (list page)

- [ ] Loads without console errors, shows the "Today's Talk" card
      with a real title.
- [ ] "Coming up" grid shows the next 13 days.
- [ ] "Recent" table is empty on day 1 (correct) — verify it
      populates the morning after the first talk's `talk_date` passes.
- [ ] Click "Today's talk" → navigates to `/toolbox-talks/<id>`.
- [ ] As a tenant where the module is **disabled**: navigating to
      `/toolbox-talks` shows the "module not enabled" guard screen,
      not a half-rendered list.

## /toolbox-talks/[id] (detail page)

- [ ] Renders title, key points list (4-6 items), body paragraphs,
      supervisor cue card.
- [ ] If the AI emitted `### Section`, it renders as an h3 (not
      raw `### Section` text).
- [ ] If the AI emitted `**bold**`, it renders bold (not literal
      asterisks).
- [ ] No raw HTML / scripts in the body — paste a known-injection
      string into one row's `body_markdown` via SQL and confirm it
      escapes.

## Sign-in flow — self

- [ ] Click "Sign in" — modal opens with your name pre-filled from
      profile/email.
- [ ] Try to submit with an empty signature — error: "Please sign in
      the box above."
- [ ] Try to submit with a 1-char name — error.
- [ ] Sign successfully — modal closes, your row appears in the
      roster, "Sign in" button hides, the green "You signed this
      talk on …" pill shows your sign time (NOT another user's).
- [ ] Reload the page — "already signed" state persists.
- [ ] Try to sign again via the API directly (curl POST to
      `/api/toolbox-talks/<id>/sign`) — expect 409 "You have already
      signed this talk."

## Sign-in flow — coworker

- [ ] Click "Add coworker" — modal opens with empty name.
- [ ] Fill name + employee ID + signature → save → row appears with
      the typed name and `#<id>` chip, no green pill (because the
      logged-in user hasn't signed via this path).
- [ ] Add a SECOND coworker with the same name+sig → both rows
      persist (the unique constraint allows multiple NULL user_ids).
- [ ] Inspect the DB: `signed_ip` is captured on Vercel (it's null
      on local dev — that's fine).

## Cross-tenant isolation

- [ ] Switch tenants in the header. The list page should reload and
      show ZERO talks (different tenant) until the cron runs there.
- [ ] Try to GET `/api/toolbox-talks/<id-from-other-tenant>` — expect
      404 (the talk row isn't visible to this tenant).
- [ ] Try to POST a sign request for an other-tenant talk id → 404.

## Module gating

- [ ] On a tenant with `modules->>'toolbox-talks' = 'false'`:
      navigating to `/toolbox-talks` shows the guard screen.
- [ ] The cron skips that tenant entirely (`per_tenant` array in
      response excludes it).
- [ ] The drawer doesn't list "Toolbox Talks" for that tenant.

## Mobile / tablet

- [ ] Open `/toolbox-talks/<id>` on an iPad in portrait. Tap "Sign
      in" — the SignaturePad accepts touch input cleanly. No bounce
      scrolling while drawing.
- [ ] Sign with a finger, save — image survives the round-trip and
      renders as a roster row (currently we don't display the
      signature image inline; verify by re-encoding the data url
      from the DB and viewing it).
- [ ] Hand the tablet to a "coworker" — switch to "Add coworker"
      flow. Submit. Repeat 5+ times in a row. No state leakage
      between submissions (name + sig pad both reset).

## What's NOT covered by automated tests (manual-verify only)

- The actual Anthropic API call shape and Sonnet's JSON adherence —
  schema is enforced via the SDK's `output_config` but only
  prod traffic confirms.
- SignaturePad on real touch devices (mobile Safari, mobile Chrome,
  iPad).
- Sentry error attribution under failure (kill the Anthropic key,
  curl the cron, confirm errors land with the right tags).
- Storage bloat — at 100 tenants × 365 talks/year × ~5KB body +
  10 signatures × ~10KB = ~5GB/yr per 100 tenants. Confirm row
  size assumptions hold after the first month.

## What was tested by automation

- `lib/markdown.ts:renderTalkMd` — 18 cases incl. XSS escapes,
  unicode, h3, bullets, links, edge cases (`__tests__/lib/markdown.test.ts`).
- `lib/toolboxRotation.ts` — 18 cases incl. never-used precedence,
  date sorting, tie-breaking, idempotency, cycling
  (`__tests__/lib/toolboxRotation.test.ts`).
- Module registration — `__tests__/lib/features.test.ts`,
  `__tests__/lib/landing.test.ts`,
  `__tests__/app/_components/ModulesGrid.test.tsx`.
- Production build — `npm run build` produces all 6 toolbox routes.
