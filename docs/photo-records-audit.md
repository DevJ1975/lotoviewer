# Photo-Records Audit — where to capture user photos "like LOTO"

**Date:** 2026-05-24
**Scope:** Soteria Field (`apps/web`). Audits every domain module against the
question: *should a user be able to attach field photos to this record, the
way LOTO equipment carries placard photos?* Lists what already exists, the
gaps worth closing, and the reusable building blocks so any new photo surface
is one small wiring job — not a fresh pipeline.

---

## 1. The LOTO photo pattern (the bar to clear)

LOTO equipment is the gold standard. Anything we add should reuse these
pieces rather than reinvent them:

| Concern | Where it lives | Reuse note |
| --- | --- | --- |
| Storage layout | `packages/core/src/storagePaths.ts` | One `loto-photos` bucket, **tenant-UUID first segment** so RLS (migration 033) scopes writes. Add a `*PhotoPath()` builder per new entity here. |
| Upload pipeline | `packages/core/src/photoUpload.ts` + `hooks/usePhotoUpload.ts` | `equipment`-specific today (writes `loto_equipment` URL columns). Needs a small generalization to target other tables — see §4. |
| Compression / HEIC / EXIF | `lib/imageUtils.ts`, `lib/imageCompression.worker.ts` | Entity-agnostic. Call before upload (the `SpacePhotoSlot` already does). |
| Offline capture queue | `components/UploadQueueProvider.tsx` | Field crews on tablets lose signal; queue drains on reconnect. Tied to equipment today. |
| Annotation overlay | `lib/photoAnnotations.ts`, `components/AnnotatedPhoto.tsx` | "this valve / that disconnect" overlays. Schema is generic; column is per-entity. |
| AI vision | `app/api/assistant/scan-photo/route.ts`, `lib/ai/*` | Claude vision extracts nameplate fields; rate-limited per user/tenant. Reusable for any "read this label" or "does the photo match the subject" check. |
| URL-as-truth status | `packages/core/src/photoStatus.ts` | Derives completeness from URL presence, not stale booleans. |
| Capture UX | `components/confined/SpacePhotoSlot.tsx`, `components/placard/PlacardPhotoSlot.tsx` | Camera + browse, compress, progress phases. Best starting point to copy. |

**DRY note:** `SpacePhotoSlot` re-implements the upload (compress → storage →
write URL column) instead of going through `usePhotoUpload`/`uploadPhotoForEquipment`,
because that pipeline is hard-coded to `loto_equipment`. Before adding a third
photo surface, generalize the pipeline (§4) so the slot component and the
pipeline stay in one place.

---

## 2. Already covered — no action needed

These records already accept user photos (or typed attachments) on the same
bucket + tenant-scoping pattern:

| Module | Entity / column | Source |
| --- | --- | --- |
| LOTO equipment | `equip_photo_url`, `iso_photo_url` + annotations | 001/015/022, full pipeline + AI |
| Confined spaces | `equip_photo_url`, `interior_photo_url` | 009, `SpacePhotoSlot` |
| LOTO walkdown checklists | per-item `photo_url` (§147(c)(6) evidence) | 146, `walkdownPhotoPath` |
| LOTO review portal | photo replacements (`old/new_photo_url`) | 134 |
| Prop 65 warnings | `photo_url` of the posted sign (anon-readable) | 174/178, `prop65WarningPhotoPath` |
| BBS observations | `bbs_observation_photos`, `bbs_observations_v2.photo_url` | 081/162 |
| Incidents | `incident_attachments` (typed) + witness statements | 061 |
| Working at Heights | component `status_photo_url`, rescue route photo, inspection `photo_urls[]` | 188 |
| Safety boards | `safety_board_attachments` (+ dedicated bucket) | 077 |
| Internal chat | `chat_message_attachments` | 073 |
| Risk assessments | `risk_attachments` (typed) | 037 |
| Equipment readiness | defect + inspection photos (`equipment-evidence` bucket) | 118 |
| Inspections (generic) | template `item_type = 'photo'` / `'signature'` | 193 |
| Profile | avatars (`profile-pictures` bucket) | 071 |
| Anonymous hazard reports | photo attach endpoint | `api/anonymous-report/attach` |
| Chemicals | SDS docs (`chemical-sds` bucket) — documents, not field photos | 089+ |
| ISO 45001 | clause-evidence index pointing at the artifacts above | 154 |

---

## 3. Gaps — where photos make sense but are missing

Ranked by compliance value × field-capture fit (i.e. how naturally a worker
already has a phone out at that moment).

### HIGH

1. **Hot Work Permits** (`loto_hot_work_permits`, migration 019 — no photo column)
   - **Why:** OSHA 1910.252 / NFPA 51B fire-watch permits hinge on *area
     condition*. The defensible record is a photo: combustibles cleared,
     extinguisher staged, fire blanket/shield in place, the 35 ft perimeter.
   - **Shape:** before/after photos on the permit; optionally a fire-watch
     close-out photo. Direct analog to confined-space entry photos.

2. **Hazardous Waste** (`hazardous_waste_containers`, `hazardous_waste_areas`,
   `hazardous_waste_inspections`, migrations 140/142 — no photo column)
   - **Why:** RCRA satellite/90-day accumulation areas are inspected weekly
     and citations turn on what an inspector *sees*: lids closed, labels
     legible & dated, container integrity, secondary containment, aisle space,
     signage. This is the closest non-LOTO match to "inspector with a phone."
   - **Shape:** per-container condition photo + per-inspection evidence photos
     (mirror the WAH `photo_urls[]` and equipment-readiness inspection pattern).

3. **JHA / Job steps** (`jha_steps`, `jha_hazards`, migration 043 — no photo column)
   - **Why:** A JHA is far more concrete with a picture of the actual pinch
     point, the missing guard, the correct PPE. Teaches the next reader (the
     stated engineering value of this repo) better than prose.
   - **Shape:** optional `photo_url` per step or per hazard.

### MEDIUM

4. **Vendor / Contractor Prequalification** (`vendor_prequalifications`, 163 — no upload column)
   - **Why:** prequal needs proof artifacts — COI, EMR letter, written safety
     program. Document upload, not a camera capture, but the *same* bucket +
     tenant-scope plumbing.
   - **Shape:** typed `prequal_documents` rows (reuse the `incident_attachments`
     / `risk_attachments` shape), not a single `photo_url`.

5. **Near-miss standalone intake** (`near-miss` route — no in-app photo capture)
   - **Why:** the *anonymous* report path takes a photo, but the authenticated
     near-miss form does not. A near-miss is often "look what almost happened"
     — a photo is the payload. Note near-miss now feeds incidents (059b), so
     confirm whether to add capture here or route users into the incident
     attachment flow.

### LOW

6. **Toolbox Talks** (`toolbox_talk_signatures`, 069 — inline base64 signatures only)
   - **Why:** crews that sign a paper roster could photograph the sheet; a
     photo of the demo/topic enriches the record. Marginal — digital sign-in
     already exists.

**Out of scope / N/A:** CMMS work-order links (integration), permit sign-on
tokens, manuals (`module-manuals` bucket already documents), strike media
(already has `media_kind='photo'`).

---

## 4. Recommended enabling work (do this first if we proceed)

Before wiring any single module, make the pipeline reusable so we don't grow a
third bespoke uploader:

1. **Generalize `uploadPhotoForEquipment`** into a table-agnostic
   `uploadEntityPhoto({ bucketPath, table, idColumn, urlColumn, … })`, keeping
   the retry + reconcile semantics. Have the LOTO equipment path and
   `SpacePhotoSlot` both call it.
2. **One `*PhotoPath()` builder per new entity** in `storagePaths.ts`
   (`hotWorkPhotoPath`, `hazWastePhotoPath`, …) — tenant UUID first, always.
3. **Extend storage RLS** (migration 033 family) so the new path prefixes are
   tenant-gated.
4. **Reuse `AnnotatedPhoto` + `photoAnnotations`** for any record where "point
   at the thing" matters (hot work, hazwaste, JHA).
5. **Consider the AI hook** only where it pays: a "does this photo show a
   cleared hot-work area / a closed waste container" check is plausible but
   should be rate-limited and optional, exactly like `scan-photo`.

Each module then becomes: one path builder + one DB column (or attachments
table) + one `SpacePhotoSlot`-style component on the detail page.

---

## 5. Suggested sequencing

1. §4.1 pipeline generalization (small, unblocks everything, removes the
   `SpacePhotoSlot` duplication).
2. Hot Work photos (highest compliance payoff, smallest surface).
3. Hazardous Waste inspection/container photos.
4. JHA step photos.
5. Vendor prequal document uploads (different shape — schedule separately).

No code has been changed by this audit; it is analysis only.
