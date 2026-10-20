# LOTO 101 en español for WLS Demo: manual install

Adds the Spanish version of LOTO 101 to the **WLS Demo** tenant, alongside the
English one already installed. Workers then pick **English | Español** at
the top of the module (and on "Train now" links). A Spanish completion
counts for every requirement an English one does, including the hot-work
permit gate, because both are versions of the same module.

Two steps, like the English install: upload the Spanish narration, then run
one SQL file. The SQL file is
`docs/handoffs/2026-10-20-loto-101-spanish-wls-demo-install.sql`, generated
by `scripts/strike-seed-sql.mjs --module module.es.json --add-locale`.

## Before you start: listen to the narration

The Spanish narration was generated with ElevenLabs (voice **KIKO HDZ**,
Mexican Spanish, model `eleven_multilingual_v2`) and checked by transcribing
every take back with ElevenLabs Scribe: all eight matched the script word
for word. Running the SQL records **jamil@trainovations.com** as the
reviewer of that narration, exactly as the English install did, so listen
first. All eight takes are in the ElevenLabs flow "LOTO 101 · Spanish
narration (KIKO HDZ)", and the files are in the repo. A native speaker's read
of the translation (`module.es.json`) is worth having before rollout to
other tenants.

## 1. Upload the 16 Spanish files

From `services/learning-studio/seed/loto-101/`, upload into the
**strike-media** bucket, folder
`ddddbce8-c7ab-4855-8bcd-821d080617ee/loto-101/v1/` (the same folder as the
English files):

- `s1-why.es.mp3` … `s8-restart.es.mp3` (8 narration tracks)
- `s1-why.es.vtt` … `s8-restart.es.vtt` (8 caption files)

The images are shared with the English version and are already there. The
SQL checks all 25 paths it uses and refuses to run until every one exists.

## 2. Run the SQL

1. Open the `.sql` file on GitHub, press **Raw**, and copy everything.
2. Supabase dashboard → **SQL Editor** → new query → paste → **Run**.
3. The result pane shows `Installed loto-101-control-hazardous-energy (es) for tenant … (10 questions)`.

It is all-or-nothing. It refuses to run if LOTO 101 isn't installed for the
tenant yet, or if a Spanish version is already published, so it can't
create duplicates. It publishes only the new Spanish version: the English
version, the module, and the hot-work training requirement are untouched.

## 3. See it

Open `/strike/loto-101-control-hazardous-energy` as a WLS Demo user and pick
**Español**. The same switch appears on "Train now" links from a permit.

## Also new on this page

- **Assisted (ADA)**: for a worker who can't read or write. Pick
  **Asistida (ADA)** / **Assisted (ADA)** at the top. The worker watches only
  the videos; then a supervisor signs in on the same device (without signing
  the worker out), ticks the checklist, reads the safety warning aloud, and
  signs with a finger or mouse. That signed record is the completion.
- **Certificates**: after passing (or a supervisor sign-off) the worker can
  download the certificate or email it to any address. The signature on it
  is the one you draw once in **Superadmin → STRIKE → Certificate
  signature**. Until you do, certificates print a blank signature line.
