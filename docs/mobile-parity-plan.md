# Mobile parity plan

_From the end-to-end monorepo audit (2026-05-24). Outlines what to integrate/add
to the Expo app (`apps/mobile`) to bring it toward parity with the web app
(`apps/web`), sharing `packages/core`._

## Where mobile is today

- **Stack:** Expo SDK 54 + `expo-router`. Tabs: dashboard, equipment,
  near-miss, JHA, risk, LOTO devices, hazardous-waste.
- **Auth/data:** Supabase auth via `expo-secure-store`; active tenant carried in
  the `x-active-tenant` header; reads/writes go **direct to Supabase (RLS)** —
  no calls to the web `/api/*`. Photo upload reuses the shared
  `@soteria/core/photoUpload` pipeline.
- **Shared code:** heavy, healthy reuse of `@soteria/core` (validation, types,
  queries, severity colors, training gate).
- **Notably absent:** any AI/assistant, push notifications, and server sync for
  hazardous-waste (it saves drafts to AsyncStorage but never uploads them).

## Gaps vs. web → what to add (priority order)

### Tier 1 — field-critical + strategic
1. **AI assistant on mobile.** Web just made the agent the centerpiece; mobile
   has none. Cheapest big win: a chat screen that calls the existing
   `/api/assistant/chat` — the server already holds the Anthropic key + all
   cross-module tools + RAG + the `incident_risk_score` tool, so mobile inherits
   full reach. Needs the web API base URL + bearer/tenant headers.
2. **Field permit workflows — Confined Spaces + Hot Work** (sign-on/off,
   atmospheric tests, live status). Absent on mobile; the most field-bound flows.
3. **Incidents** (full intake/investigation). Mobile only has near-miss.
4. **Inspections** + **BBS** (QR observation capture). Designed for field/offline;
   both absent.
5. **Push notifications** (`expo-notifications`) — permit/CAPA/alert delivery,
   paralleling web-push (`loto_push_subscriptions`).

### Tier 2 — sync + completeness
6. **Hazardous-waste sync** — wire the offline AsyncStorage drafts up to Supabase.
7. **Equipment-readiness pre-use checks**, **training-records view**,
   **toolbox talks (read + sign)**, **chemicals (barcode scan / SDS)**,
   **working-at-heights** — all web-present, mobile-absent.

### Tier 3 — cross-cutting platform
8. **Offline-first foundation** — generalize the hazardous-waste AsyncStorage
   draft pattern into one shared sync queue (SQLite/WatermelonDB or a
   `@soteria/core` sync lib) reused by every field-capture module.
9. **Deep-link / store config** — fill the `eas.json` + `app.json` placeholders
   (Apple Team ID, Android release SHA, App Store Connect app id; see
   `todos.md`) to enable universal links + store submission.
10. **Reuse new core logic** — `incidentRiskModel` + `scorecardWeatherReport`
    already live in `@soteria/core`, so a mobile "safety risk" card is nearly free.

## Recommended sequence
1. Mobile AI assistant (reuse `/api/assistant/chat`).
2. Field-capture cluster: confined space, hot work, incidents, inspections, BBS.
3. Offline-sync foundation + hazardous-waste sync.
4. Push notifications.
5. Deep-link / store config (unblocks distribution).

## Architecture notes
- Keep data reads **direct-to-Supabase (RLS)** as today.
- Route **AI through the web `/api/assistant/*`** so the server keeps the model
  key + tools; mobile just renders the chat.
- Continue pushing shared pure logic into `@soteria/core` for reuse across web +
  mobile (the predictor + weather-report models already are).
