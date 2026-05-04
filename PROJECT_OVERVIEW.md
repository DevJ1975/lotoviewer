# Soteria Field — Overview

## Tech Stack

### Framework & Runtime
- Next.js 16.2.4 (App Router)
- React 19.2.4
- TypeScript 5

### Styling & UI
- Tailwind CSS v4
- shadcn/ui (Base-UI + class-variance-authority)
- Recharts — department charts
- Lucide icons

### Data & Storage
- Supabase JS v2 — Postgres, Storage (`loto-photos`, `tenant-logos` buckets), Realtime
- Multi-tenant: `tenants`, `tenant_memberships`, `tenant_id` on every domain table; RLS-enforced

### AI & PDF
- Anthropic SDK — Claude Haiku for photo validation, Claude Sonnet for LOTO content
- pdf-lib — signature stamping + PDF merging (client-side)

### Testing
- Vitest 4 + Testing Library + jsdom — **153 tests passing**

---

## Structure

> Monorepo layout — the web app now lives at `apps/web/`. All paths
> below are relative to `apps/web/`. See [README.md](./README.md).

```
app/
├── page.tsx                   Dashboard (live stats, realtime)
├── layout.tsx                 Root layout + PWA manifest
├── departments/
│   ├── page.tsx               Department list with review status
│   └── [dept]/page.tsx        Department detail + Sign Off workflow
├── equipment/[id]/page.tsx    Equipment detail with prev/next nav
├── print/page.tsx             Print queue (flat + grouped by dept)
└── api/
    └── validate-photo/        Claude Haiku photo validation

components/    11 components — EquipmentTable, PhotoUploadZone,
               SignaturePad, ReviewModal, OfflineBanner, etc.

hooks/         useDebounce, useNetworkStatus, usePhotoUpload,
               useReviews, useToast

lib/           supabase client, types, photoStatus, imageUtils,
               pdfUtils, utils

migrations/    001_loto_reviews.sql
```

---

## Current Status — shipped & on `main`

1. **Dashboard** — realtime stats, department chart, status cards
2. **Equipment detail** — editable, prev/next navigation within dept, photo uploads with AI validation
3. **Photo uploads** — compression, exponential retry, offline guard, camera + browse, Claude Haiku validates the image matches the subject. Tenant-prefixed storage paths (Phase 5).
4. **Photo status** — URL-based ground truth (not stale booleans); 24 edge cases covered
5. **Department review** — signature pad, review modal, history
6. **PDF signing** — signature + auto-date stamped on placards via pdf-lib; signed PDFs stored in Supabase, merged department PDF auto-downloads
7. **Print queue** — flat or grouped-by-dept, CSV export, pagination, merge-and-download
8. **Offline** — network detection, sticky banner, upload guard
9. **PWA** — manifest, icons, iOS web-app capable
10. **Multi-tenancy** — Snak King (#0001) holds all production data; WLS Demo (#0002) seeded for client walkthroughs. Per-tenant module toggles, tenant logos, header switcher, superadmin onboarding (`/superadmin/*`). Header-scoped RLS so superadmin's active tenant filters every read. See `docs/multi-tenancy-saas-plan.md`.
11. **Tests** — 17 files including multi-tenant module-resolver + guard tests

---

## Not yet

- LOTO energy fields (reverted — waiting on real column names)
- Spanish placard translation
- Placard migration (awaiting data import)
