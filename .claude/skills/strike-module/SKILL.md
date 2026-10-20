---
name: strike-module
description: Build a new STRIKE microlearning module (or a new language of an existing one) exactly the way LOTO 101 was built — seed module.json with scenes, hinted practice checks, a safety callout and a 10-question quiz; AI images; ElevenLabs narration through the MCP with Scribe QA and word-timed captions; a Spanish (or other) translation as its own published version; a coach KB doc; tests; and a hand-run install SQL for a tenant. Use when the user asks for "another STRIKE module", "a microlearning on <topic>", "translate <module> to Spanish", or "make more STRIKE learning like LOTO 101".
---

# strike-module — build STRIKE microlearning the LOTO 101 way

LOTO 101 (`services/learning-studio/seed/loto-101/`) is the reference
module. Everything the platform does for it — sequential gating, hints,
the coach, xAPI to the customer's LMS, Spanish, assisted (ADA) delivery
with a supervisor sign-off, and the emailed certificate — comes from the
content itself. A new module that follows this recipe gets all of it with
**no app code changes**. The one exception is the coach knowledge base for
a brand-new topic (step 6). If you find yourself editing a component to
make a module work, stop: fix the content, or the change belongs in its
own PR.

Read `services/learning-studio/README.md` and
`packages/core/src/strikeContent.ts` (the content parser and publish
check) before you start. They are the contract; this skill is the recipe.

## What you need from the user

Ask once, up front, for anything missing:

- **Topic and regulation** (e.g. "Confined space entry, 29 CFR 1910.146").
- **Audience and setting** (e.g. food plant, warehouse, construction). It
  drives every image prompt and example.
- **Languages** (English is always the base; Spanish is the usual second).
- **Tenant to install for**, and the **approver's email**. Running the
  install SQL records that person as having reviewed every AI asset, so it
  must be someone who will actually listen and look first.
- Whether completion should **gate a permit** (`--gate hot_work`) or not
  (`--gate none`).

## 1. Design the module (before any media)

Budget: **≤ 5 minutes of narration** (`estimated_minutes: 5`). The publish
check rejects a module whose narration runs longer than its estimate.

Shape, copied from LOTO 101:

| Block | Kind | Rule |
|---|---|---|
| `s1-…` … `s8-…` | `motion_scene` | 6–8 scenes, 25–40 s each, one idea per scene. |
| `i1-…` … `i4-…` | `drag_match`, `hotspot`, `drag_sort`, `scenario` | One practice check after every scene or two. Use each kind once if the topic allows. |
| `c1-…` | `callout` (`tone: danger`) | The one warning the scenes can't carry alone. Assisted learners never see callouts, so each one becomes a read-aloud item on the supervisor checklist. |
| quiz | `questions[]` | Exactly 10, mixing `multiple_choice`, `true_false`, `select_all`. Every question has an `explanation`. |

Keys are stable identifiers forever: block events, xAPI activity ids and
the assisted checklist are keyed on them. Never rename a key once a
version is published; add a new one.

Every practice check needs:

- `remediate_block_key`: the scene that teaches it.
- `hint`: the author's nudge. It must **point at the idea, not the
  answer** (LOTO 101: "Ask what would physically stop each kind of
  energy…"). The player adds a second, revealing hint on its own
  (`strikeInteractionHints`), so the authored one stays gentle.

Get the content reviewed for technical accuracy before narrating: run the
`csp-safety-expert` agent (or a CSP content-review skill, when the session
has one) on the draft `module.json`. Narration costs credits; rewrites after it cost twice.
Check every practice check is solvable from the scenes before it: the
player locks the next scene until the check is solved.

## 2. Author `seed/<slug>/module.json`

Copy `loto-101/module.json` and replace its content. Keep its top-level
fields (`slug`, `title`, `description`, `category`, `tags`,
`estimated_minutes`, `library_scope: "global"`, `locale: "en"`,
`passing_score: 80`, `retake_limit`, `validity_days`, `media_prefix:
"global/<slug>/v1"`, `content`, `questions`, `image_prompt_rules`).

Each scene: `eyebrow`, `title`, `animation` (one of
`STRIKE_SCENE_ANIMATIONS`), `image {path, alt, ai_generated: true,
approved_by: null, approved_at: null}`, `script`, `beats` (on-screen text,
`at_ms` from 0). `narration` is written by step 4; leave it out until then.

Alt text describes the safety-relevant content of the image (where the
lock is, what PPE is worn), not just "a worker".

`image_prompt_rules` is the house style every image prompt must follow
(PPE, lock placement, no readable text). Write it for the new setting.

## 3. Images

One image per scene plus any hotspot image, saved beside `module.json` as
named in `image.path`, 16:9 JPEG. For a hotspot, set each target's
`x_pct`/`y_pct` against the final image, then check on a phone that every
marker sits on its object. Look at every image for hazard accuracy (a lock
on a stop button, missing PPE) before going further: a wrong image teaches
the wrong thing.

## 4. Narration with ElevenLabs (MCP)

Use the ElevenLabs MCP tools, not the studio's `narrate` command, when the
studio isn't running.

1. `creative_create_flow` named "<Module> · <Language> narration (<voice>)".
   Record its id in `media.json`.
2. `creative_list_voices` and pick a calm, clear narrator native to the
   language (LOTO 101: "Cole - Corporate Narrator" for English, "KIKO HDZ -
   Informative & Educational" for Mexican Spanish). Say which you picked.
3. `creative_generate_speech` once per scene on that flow, model
   `eleven_multilingual_v2`, text = the scene's `script` verbatim. Poll
   `creative_get_flow_run_status` until done. **Never re-run a generation
   to retry: each call charges credits.** Pick one take per scene.
4. Download each take; encode as 64 kbps mono MP3 named
   `<scene-key>.mp3` (`<scene-key>.<locale>.mp3` for a translation) and
   measure its length with `ffprobe`.
5. **QA every take**: `creative_transcribe_audio` (Scribe) on each one and
   compare the transcript with the script word for word. A mismatch means
   the take is wrong (skipped or misread words): regenerate only that
   scene, after telling the user it costs credits.
6. **Captions** (mandatory, Section 508): build the VTT from Scribe's word
   timings with `services/learning-studio/studio/captions.py`
   (`Word` → `group_cues` → `render_vtt`). Show numbers as the digits the
   transcript uses ("29 CFR 1910.147"), not spelled out.
7. Update each scene: `narration {audio_path, captions_path, transcript,
   duration_ms, voice, ai_generated: true, approved_by: null, approved_at:
   null}` and rescale its `beats` to the real duration (same rule as
   `content.py: rescale_beats`).
8. Add every file to `media.json` with `block_key`, `locale`,
   `duration_ms`, `bytes`, `model`, and the Scribe result as
   `safety_check`.

## 5. Translations (Spanish and others)

A translation is **a second published version of the same module**, in its
own language — not a separate module. Completions in either language then
satisfy the same assignments, permit gates and certificates.

- Write `module.<locale>.json` beside `module.json`: same `slug`, same
  `media_prefix`, `locale: "<locale>"`, a translated `title` (stored on the
  version), same block **keys**, same block order, same image paths, same
  quiz answer pattern (the correct answers sit in the same positions).
- Translate for the reader: plain words, `usted` in Spanish, regulation
  numbers unchanged. Have a native speaker review before a wide rollout.
- Narrate as in step 4 into `<scene-key>.<locale>.mp3/.vtt`.
- Add the language's strings to `apps/web/components/strike/player/copy.ts`
  and the assisted checklist copy in `packages/core/src/strikeAssisted.ts`
  **only if the locale is new**; `es` already exists everywhere.

## 6. Coach knowledge base

Write a practice-checks doc (follow `kb/loto/11-practice-checks.md`): for
each practice check, the idea behind it, the hint ladder, and the right
answer with why. Include a Spanish section.

- A LOTO-family module: add it to `apps/web/lib/strike/kb/loto/` and
  register it in `LOTO_COACH_KB` in that folder's `index.ts`.
- A new topic: today the ingest route
  (`app/api/superadmin/strike/coach-kb/route.ts`) reads only
  `LOTO_COACH_KB`. Give the topic its own `kb/<topic>/` folder and teach
  the route to ingest it too, in the same PR, with a test.

After it merges, a superadmin re-ingests at
`POST /api/superadmin/strike/coach-kb`.

## 7. Tests

Extend `packages/core/src/__tests__/strikeContent.test.ts` and
`strikeAssisted.test.ts` with the new seed, as LOTO 101 does:

- it parses, and passes the publish check once approved (all captions, all
  approvals, narration within the time budget);
- every practice check has a hint and a valid `remediate_block_key`;
- a translation has the same block keys, the same answer key, its own
  audio, and shared images;
- the assisted checklist has one read-aloud item per callout, in each
  language.

Run `npm run test:core`.

## 8. Install for a tenant

Generate a hand-run SQL file for the Supabase SQL editor:

```sh
node scripts/strike-seed-sql.mjs --seed services/learning-studio/seed/<slug> \
  --tenant <tenant uuid> --approver <email> [--gate hot_work|none] \
  > docs/handoffs/<date>-<slug>-<tenant>-install.sql

# then each translation, as a new version of that module
node scripts/strike-seed-sql.mjs --seed services/learning-studio/seed/<slug> \
  --module module.es.json --add-locale --tenant <tenant uuid> --approver <email> \
  > docs/handoffs/<date>-<slug>-spanish-<tenant>-install.sql
```

Prove each against the real schema with `--dry-run` (it always rolls
back) through the Supabase MCP `execute_sql`. Never run the real install
yourself: it stamps the approver's name on assets they must review first.

Write a companion `.md` next to each `.sql` (copy
`docs/handoffs/2026-10-20-loto-101-spanish-wls-demo-install.md`): which
files to upload to `strike-media/<tenant>/<slug>/v1/`, "listen first",
how to run it, and what the user should see.

## 9. Check it on real devices

Start the dev server and drive the module with Playwright
(`/opt/node-tools/node_modules/playwright` in cloud sessions) on a phone
(Pixel 7, iPhone 14, 320 px wide), a tablet (iPad, Galaxy Tab S4) and
desktop, in each language and in assisted mode:

- every button and drag handle is at least 44 px;
- drag-sort labels don't wrap to one word per line at 320 px;
- hotspot markers sit on their objects;
- the next scene stays locked until the practice check is solved;
- captions track the narration.

## Done means

- `npm run check:repo`, `npm run lint`, `npm test`, `npm run test:core`
  and the build are green.
- The PR says, in Deployment Notes, exactly what the user must do by hand:
  upload media, listen and look, run the SQL, re-ingest the coach KB.
- You told the user how many ElevenLabs credits the narration used.
