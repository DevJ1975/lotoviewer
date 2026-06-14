# STRIKE (Vimeo-only) — manual smoke test

The STRIKE audit verified the code statically (tsc, eslint, 29 parser/resolver
unit tests, auth + tenant-scope review). The items below need a **real browser
and a real Vimeo video** — they can't be driven in a sandbox. Run them against a
preview deploy after a STRIKE change.

Prereqs: a superadmin login, one tenant with a member login, and a Vimeo video
you control (ideally **Unlisted + privacy hash + domain-level embed
restriction**).

## 1. Studio authoring (superadmin)

Drawer → **Superadmin** → **STRIKE**, open a module's latest version.

- [ ] Paste a **bare id** (`123456789`) → **Save link** → panel shows `Vimeo 123456789`.
- [ ] Paste `https://vimeo.com/{id}/{hash}` (unlisted) → **Replace** → panel updates; the chip link opens the right Vimeo page.
- [ ] Paste `https://player.vimeo.com/video/{id}?h={hash}` → saves the same id + hash.
- [ ] Paste a **non-Vimeo URL** (`https://youtube.com/watch?v=…`) → inline "Not a recognized Vimeo link or id." and **Save** stays disabled.
- [ ] **Remove** → panel returns to the "No video" empty state.

## 2. Learner playback

As a tenant member, open a **published** module that has a video.

- [ ] The Vimeo player renders inline (16:9, rounded, black background).
- [ ] The **identity watermark** (viewer + live clock) is visible and **cycles corners + updates the time every ~15s**.
- [ ] The embed src is `player.vimeo.com` with `dnt=1` (check DevTools → no arbitrary host).
- [ ] An **unlisted** video plays (the stored privacy hash authorizes the embed).

## 3. Watch-percent gate

In `strike_tenant_settings`, set `require_watch_percent = 80` for the tenant.

- [ ] Open the module, **do not** watch → submit the quiz → **422** "Watch at least 80% of the video before submitting the quiz."
- [ ] Watch ≥ 80% (the SDK `timeupdate` feeds progress; seeking backward must not lower it) → submit succeeds.
- [ ] Set `require_watch_percent = 0`/null → submitting without watching is allowed (gate off).
- [ ] A module **without** a video is never gated (submit works regardless).

## 4. Access control & audit

- [ ] A **non-member** (wrong tenant, or signed out) hitting `POST /api/strike/{moduleId}/media` → 401/403, never a URL.
- [ ] A tenant-scoped module is **not** reachable from another tenant (404), but a global module is.
- [ ] A **non-superadmin** hitting `POST`/`DELETE /api/superadmin/strike/video` → rejected.
- [ ] After a learner plays a video, a `strike_media_access` row exists (`provider='vimeo'`, correct `user_id`/`tenant_id`/`object_ref`) — the who-watched-what trail.
- [ ] Hammer the media endpoint > 20×/min for one user → **429** with a `retry-after` header.

## 5. Legacy / failure shapes

- [ ] A version whose `video_external_id` is a stale **Cloudflare UID** (32 hex chars) → media returns **422** "not a valid Vimeo id" and the player shows an error state, **not** a broken iframe.
- [ ] A version with no video → media returns `{ provider: null, url: null }` and the page shows the no-video state.

## 6. Quiz integrity (regression)

- [ ] Submitting passes/fails per `passing_score`; `strike_attempts` + (on pass) `strike_completions` rows are written with `tenant_id`.
- [ ] With `retake_limit` set, the (N+1)th submit → **409** "Retake limit reached." (See `pending-tasks.md` 2026-06-14 for the known non-atomic attempt+completion edge to watch for if a submit 500s mid-write.)
