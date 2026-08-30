# Events & Causal Factors (ECFA) — manual smoke test

Drive this against a real browser (and an iPad for the drag interactions) after
deploying the `claude/devjr-skill-pim71f` preview. It covers what the automated
suite can't: real pointer + keyboard drag-and-drop, RLS across tenants, the AI
co-pilot round-trip, the CAPA cross-link, and the PDF download.

**Prereqts:** a tenant with the incidents module enabled; one **admin** user and
one **member** (non-admin) user on the investigation team; a second tenant for
the isolation check; an incident with an **investigation started** (so the ECFA
sub-view renders).

## 1. Navigation & legacy redirect
- [ ] `/incidents/[id]/investigate` shows the **Root Cause Analysis** /
      **Events & Causal Factors** sub-switch.
- [ ] Visiting the old `/incidents/[id]/ecfa` route **redirects** to
      `/incidents/[id]/investigate?view=ecfa` and opens on the ECFA sub-view.
- [ ] The "How to use" link (ECFA sub-view) opens `/wiki/ecfa`.

## 2. Build the chart (admin or team member)
- [ ] Add an event with a blank title → the Add button stays disabled (no request).
- [ ] Add two events → both render on the chart's centre line, left→right, with a
      sequence arrow between them.
- [ ] Add a condition **above** and one **below** an event → ovals stack in the
      correct lane with connectors; the canvas grows.
- [ ] Add the terminal **loss / incident** node → a diamond appears at the right end.
- [ ] A symptom-language title (e.g. "operator was careless") shows the amber
      anti-blame hint.

## 3. Drag-and-drop reorder (the v1.16.0 feature) — **pointer + keyboard**
- [ ] Drag an event by its grip handle to a new position → the numbered list **and**
      the chart reorder together, instantly (optimistic), then settle.
- [ ] Reorder is minimal: only the moved span renumbers (verify via network tab —
      the `PATCH { updates }` body contains only the changed nodes, not all).
- [ ] Drag a condition to a **different lane** on the same event (above↔below) → its
      `(above/below)` tag and chart position flip.
- [ ] Drag a condition to a **different event** → it re-parents; the source lane
      compacts (no sequence gaps) and the destination lane renumbers.
- [ ] Drop a condition into an **empty** lane (the "Drop a condition here" target).
- [ ] **Keyboard:** focus a grip handle, press Enter/Space to lift, arrow to a new
      slot, Enter to drop — same result as a pointer drag.
- [ ] Drop a node back exactly where it started → **no** network request fires (no-op).

## 4. Optimistic update + error recovery (C1 regression check)
- [ ] With devtools throttling/offline, perform a drag → the move shows optimistically,
      then an **error banner** appears and the board **re-reads server state** (it does
      NOT silently snap back to a stale pre-move picture).
- [ ] Re-enable network, repeat the drag → it persists; refreshing the page shows the
      same order (server + client agree).

## 5. Causal-factor coding → corrective action (CAPA)
- [ ] Flag a node as a causal factor → the ★ chip + coding panel (category, control
      level, failed barrier) appear.
- [ ] Set a category and control level → chips update; the completeness pill's
      "N/M causal factors actioned" and score move.
- [ ] Click **Create corrective action** → a toast confirms; the Actions tab shows the
      new action linked to this node; the button flips to "Action created" (disabled).
- [ ] Re-open ECFA → the node shows the **CAPA** chip (round-trips via
      `source_ecfa_node_id`).

## 6. AI co-pilot (admin only)
- [ ] As a **member**, the "Draft sequence" / "Suggest causal factors" buttons are
      **absent**.
- [ ] As an **admin**, "Draft sequence" returns a panel; "Add event" adds each event
      (with an `AI` provenance chip) and is idempotent (button flips to "Added").
- [ ] "Suggest causal factors" (needs ≥1 node) returns a panel scoped to existing
      nodes; "Flag as causal factor" applies the flag + category.

## 7. PDF export (C2 regression check)
- [ ] "Download PDF" produces a one-page landscape chart matching the on-screen
      geometry (same shapes, dashed = presumptive, amber = causal factor).
- [ ] Titles with unicode subscripts (e.g. "Released H₂S") render without breaking the
      PDF (WinAnsi sanitization).
- [ ] Simulate a chunk-load failure (throttle + reload mid-import) → an **error banner**
      appears instead of a dead button.

## 8. Read-only (completed investigation)
- [ ] Complete the investigation → the ECFA sub-view renders the chart but **hides**
      all drag handles, add forms, delete buttons, and coding controls.
- [ ] "Download PDF" still works read-only.

## 9. Tenant isolation (RLS)
- [ ] As a user of **tenant B**, calling `GET /api/incidents/{tenant-A-incident}/ecfa`
      returns no nodes (RLS scopes to the caller's tenant).
- [ ] A `PATCH`/`DELETE` against a tenant-A node id from tenant B is rejected
      (investigation resolve fails → 404/403; the write is tenant-scoped regardless).
- [ ] A non-team **member** editing attempt returns 403 ("Only the investigation team
      can edit the ECFA chart").
