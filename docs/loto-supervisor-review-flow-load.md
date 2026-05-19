# LOTO Supervisor Review Flow — Load Testing Plan

Vitest is the wrong tool for load testing — it runs JS in a single
Node process against in-memory mocks, so it can't model concurrent
HTTP clients, real network latency, the Vercel edge runtime, or
Supabase row-level locking under contention. This file documents the
load-testing approach we'd use if a customer signal demanded it.

## Recommended tool: k6

`k6` (https://k6.io/) gives us scripted, ramped, distributed HTTP load
against the deployed Vercel preview. Install via Homebrew or the
official binary; no infra change required.

## Scenarios

### 1. Photo-replace storm

The single hottest path: a supervisor flips through 20 placards
rapidly during a floor walk and replaces 5 photos. The interesting
question is how the inline placard regen (pdf-lib + Supabase Storage
upload) scales when a few supervisors do this in parallel.

```js
// k6/photo-replace.js
import http from 'k6/http'
import { sleep } from 'k6'

export const options = {
  stages: [
    { duration: '30s', target: 5  },   // ramp to 5 supervisors
    { duration: '2m',  target: 5  },   // hold 5 for 2m
    { duration: '30s', target: 20 },   // burst to 20 (multi-tenant spike)
    { duration: '2m',  target: 20 },   // hold the burst
    { duration: '30s', target: 0  },
  ],
  thresholds: {
    http_req_failed:    ['rate<0.01'],           // <1% failures
    http_req_duration:  ['p(95)<3000'],          // 95% under 3s
  },
}

const TOKEN = __ENV.REVIEW_TOKEN          // mint via /api/admin/review-links and stash
const SLOT  = 'EQUIP'

export default function () {
  const photo = open(`./fixtures/photo-${Math.floor(Math.random()*5)+1}.jpg`, 'b')
  const body = {
    action:        'replace-photo',
    equipment_id:  `EQ-${1 + Math.floor(Math.random()*20)}`,
    slot:          SLOT,
    reviewer_name: `Load test ${__VU}`,
    photo:         http.file(photo, `photo-${__VU}.jpg`, 'image/jpeg'),
  }
  http.post(`${__ENV.BASE_URL}/api/review/${TOKEN}`, body)
  sleep(2)
}
```

**What we'd watch:**
- p95 latency. The regen step is the biggest unknown — pdf-lib +
  Supabase Storage upload happens inline. Acceptable: < 3s.
- Error rate. RLS contention or Supabase storage rate-limits would
  show up as 5xx.
- Supabase advisor warnings on the bucket (rate, bandwidth).

### 2. Mark-for-review torrent

Flagging is just a row update — cheap compared to photo replace. The
risk is the `loto_equipment` audit trigger fanning out. We'd run a
50-VU ramp for 5 minutes and verify the `audit_logs` table doesn't
back up.

### 3. Admin queue read

The queue page reads `loto_equipment WHERE flagged_for_review_at IS
NOT NULL` and there's a partial index on it. Worst-case scan size is
proportional to flagged rows (bounded by tenant size). We'd
intentionally seed 10k flagged rows and confirm the page renders in
< 500ms at p95.

## Pre-flight before running

- Use a non-production Supabase project (Soteria_LMS or a fresh
  branch project).
- Seed at least 100 equipment rows per test tenant.
- Mint a long-expiry link (`POST /api/admin/review-links/<id>/extend
  { hours: 168 }`) before kicking off the test so the public route
  doesn't 410.
- Configure k6 with sane VUs (≤ 50 for the local Mac, ≤ 200 if
  running from k6 cloud) — we're not load-testing Vercel's edge, we're
  load-testing our own DB writes.

## Not in scope

- Browser-side load (concurrent supervisors on the public page) —
  Playwright/Cypress at 100+ concurrent runners would test the React
  client; not justified by current usage patterns.
- Storage bucket fan-out at >1000 photos/min — Supabase Storage
  publishes its own limits and we're nowhere near them.

## Verdict

This is a documented plan, not a CI-gated test. Run on demand when:
- A customer signals slowness on the public link
- A new region/database goes live and we want a baseline
- The placard regen path changes materially (new pdf-lib version,
  different storage backend)
