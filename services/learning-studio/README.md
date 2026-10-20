# STRIKE Media Studio

A Django service that produces and reviews the media for STRIKE microlearning
modules: ElevenLabs narration with WebVTT captions, an ffmpeg render of the
whole module to a downloadable 1080p MP4, and a review board where a person
approves every AI-generated image and narration before the module can publish.

The learner experience, quizzes, permit gating and scheduling live in the
Next.js app (`apps/web`). This service only prepares content for it, writing
to Supabase (`strike_modules`, `strike_module_versions`, `strike_quiz_*`, and
the private `strike-media` bucket) with the service-role key.

## OrbStack preview

Run the web app and the studio together on your Mac before anything ships:

```sh
cp .env.orb.example .env.orb          # at the repo root; fill in Supabase + keys
docker compose --env-file .env.orb -f docker-compose.orb.yml up --build
```

Then open:

- https://web.soteria.orb.local: Soteria Field (learner player, admin, permits)
- https://studio.soteria.orb.local: this Media Studio

OrbStack reads each service's `dev.orbstack.domains` label and serves it over
HTTPS. Plain Docker works too, at http://localhost:3000 and http://localhost:8000
(for the studio over plain HTTP set `DJANGO_DEBUG=1` in `.env.orb` so the
session cookie is not HTTPS-only).

`--env-file .env.orb` is required. The browser bundle has the `NEXT_PUBLIC_*`
values compiled in at build time, and compose only reads them from `.env.orb`
when you pass this flag. Point `.env.orb` at a Supabase branch or staging
project while you preview unreleased migrations.

## Content workflow

Each module lives in `seed/<module>/module.json`. That one file is the script,
interactions and quiz, and the seed directory is mounted read-write into the
container. Run commands with
`docker compose --env-file .env.orb -f docker-compose.orb.yml exec studio …`
(or `python manage.py …` in a local venv):

1. **Narrate.** `python manage.py narrate seed/loto-101 --voice <ELEVENLABS_VOICE_ID>`
   writes `<scene>.mp3` and `<scene>.vtt` per scene, then sets each scene's
   `narration` in module.json, with beat cues rescaled to the real audio length.
   Use `--scene s3-roles` to redo a single scene.
2. **Images.** Put each scene's image beside module.json, named as its
   `image.path`. AI images keep `ai_generated: true`.
3. **Render.** `python manage.py render_module seed/loto-101` writes
   `seed/loto-101/module.mp4`. Add `--burn-captions` for open captions, and
   `--upload` to publish it as the draft's download once it has been imported.
4. **Import.** `python manage.py import_seed_module seed/loto-101` uploads the media
   to `strike-media/<media_prefix>/` and saves the module as a **draft** in the
   global library, with its 10-question quiz. Re-running updates that same draft.
   It refuses to touch a published version.

   **Or drag and drop.** The STRIKE Studio page in the web app
   (`/superadmin/strike`) accepts the seed folder, or a zip of it, as a
   *STRIKE package*: `module.json` (plus `module.es.json` for the translation),
   the images, narration and captions they reference, and the rendered
   `module.mp4` / `module.es.mp4` downloads. The browser validates the
   documents, uploads the media to `strike-media/<media_prefix>/` as the
   signed-in superadmin, and the web app writes the same draft rows as
   `import_seed_module` (`apps/web/lib/strike/package.ts`,
   `packageImport.ts`). Every AI approval in the package is cleared on
   import; a person approves in the studio as before. Media files over the
   project's Storage upload limit fail with a clear message — raise the
   limit in Supabase → Storage settings or import that module from the shell.
5. **Approve.** In the studio, open the module, listen to each narration, check
   each image for hazard accuracy (lock placement, PPE, isolation points), then
   approve it, or reject it with a note.
6. **Publish** in the Soteria web app. Its publish check blocks while any AI
   asset is unapproved.

## Access

- **Global library** modules: superadmins only. You need both the
  `SUPERADMIN_EMAILS` list and `profiles.is_superadmin`, the same check the web app makes.
- **Tenant modules**: owners and admins of the tenants listed in `STUDIO_TENANT_IDS`.

Access is checked again every hour, so removing someone's role ends their studio session.

## Development

```sh
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest          # includes a real ffmpeg render when ffmpeg is installed
.venv/bin/ruff check .
```
