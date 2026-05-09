# SoteriaField marketing brochure — Claude Design prompt

Paste the section below into Claude (or any LLM with PDF / design
generation) to produce a 6-page A4 brochure mockup. Edit the
roadmap quarters and the customer pull quote before you ship —
both are placeholders flagged at the bottom.

---

## PROMPT

Design a **6-page A4 PDF marketing brochure** for **SoteriaField** —
a multi-tenant SaaS platform for industrial safety teams in **food
production and manufacturing**. The deliverable is print-ready,
full-color, and designed for trade-show handouts plus digital
lead-gen.

### Brand identity

- **Wordmark:** "SoteriaField" — single word, bold sans-serif
  (Inter or Söhne), letter-spacing -0.02em.
- **Primary palette:**
  - Indigo `#4F46E5` (primary actions, headlines)
  - Slate `#0F172A` (body, headers)
  - Cool slate `#475569` (secondary text)
  - Amber `#F59E0B` (warnings, attention pulls)
  - Emerald `#10B981` (verified / signed-off states)
  - Off-white `#F8FAFC` (backgrounds)
- **Voice:** Direct, plainspoken, respectful. No corporate
  buzzwords. No "synergy," "leverage," "empower."
- **Reading level:** 8th grade. Short sentences. Active voice.
- **Tagline:** *"Safety where the work happens."*

### Page 1 — Cover (full bleed)

A photorealistic hero image: a **45-year-old maintenance
technician in safety glasses, hard hat, hi-vis vest, and
arc-rated gloves**, standing at a 480 V motor control panel
inside a **stainless-steel food production facility** (mixers
and a CIP station visible in soft focus behind him). He is
holding a **rugged-cased 12.9" iPad in landscape orientation**
at chest height, looking down at the screen. Lighting: cool
industrial overheads with a warm key from the iPad screen on
his face.

The iPad's screen shows the **SoteriaField hazard report view**
for "MIX-04 — Industrial Stand Mixer":
- Top: equipment ID + description, dark-text on white
- A red severity chip ("CRITICAL")
- Three hazard cards: Electrical (480 V 3φ), Mechanical
  (stored kinetic energy in agitator), Thermal (CIP residual
  steam)
- Below: an "Isolation steps" ordered list
- Bottom: a "Sources" list with OSHA 29 CFR 1910.147 and a
  company policy link

Overlay copy (top-left):
> **SoteriaField**
> Safety where the work happens.

Overlay copy (bottom-right, small): `soteriafield.app`

### Page 2 — The problem (left page of spread)

Headline (40 pt indigo): **"Compliance is a binder. Work
happens on the floor."**

Body (3 short paragraphs, ~120 words total):
- The procedure binders haven't moved in a decade. The line
  has changed three times.
- A technician at a 480 V disconnect doesn't have time to flip
  to page 47. They need the right step, on the right machine,
  in their hands, right now.
- SoteriaField puts every LOTO procedure, every SDS, every
  hazard analysis, and every regulation reference one scan
  away from where the work is done.

Visual: a single photo at the bottom — a worker's gloved hand
holding a phone showing a red QR-code placard on a piece of
equipment.

### Page 3 — What's shipped today (right page of spread)

Headline: **"Today, SoteriaField does this."**

A grid of 8 feature tiles, each with a small line icon (lucide
style — `Zap`, `Wrench`, `FlaskConical`, `Bot`, `ScanLine`,
`BookOpen`, `Bell`, `Shield`), one-sentence description:

1. **AI-drafted LOTO procedures** — Generate energy-isolation
   steps for any equipment in 15 seconds. A qualified person
   reviews and signs off.
2. **Scan a placard, get the hazards** — QR or photo-scan a
   nameplate. SoteriaField returns hazards, energy sources,
   isolation steps, and required PPE — grounded in OSHA, your
   company policies, and state regulations.
3. **Chemical inventory + SDS parsing** — Upload an SDS PDF;
   SoteriaField extracts hazards, transport class, and storage
   requirements automatically.
4. **Incident classification** — Wizard-style recordability
   check against OSHA 1904. Captures the why, not just the
   what.
5. **Confined space hazard generator** — Pre-entry hazard list
   grounded in §1910.146.
6. **Toolbox talks, every Monday morning** — A 5-minute
   pre-shift safety brief written for your industry,
   citation-grounded, ready to hand to the foreman.
7. **Cross-module assistant** — Ask "What does OSHA say about
   lockout for hydraulic systems?" and get a cited answer.
   Ask "Show me incidents from the last 7 days" and get a list.
8. **Inspector review links** — Send a one-click signed-off
   LOTO to an external inspector. Time-bound, audit-logged.

Below the grid, a small typeset note:
> Every AI draft is a starting point. A qualified person
> verifies, signs, and authorizes the work. SoteriaField is a
> drafting and reference tool — never the authority.

### Page 4 — Visual proof (left page of spread)

Three iPad screen mockups arranged at slight angles,
drop-shadowed:

1. **Home assistant** — Chat panel with a query "What does
   OSHA say about lockout for hydraulic accumulators?" and a
   partial assistant reply citing 29 CFR 1910.147(c)(4) with a
   "Sources" list.
2. **Equipment scan result** — A photo of a nameplate on the
   left, extracted fields on the right (`MIX-04`, brand,
   model, voltage), with a confidence chip ("high") and a
   "View hazards" button.
3. **Toolbox talk** — A Monday-morning briefing titled
   "Stored Energy in CIP Lines — What Killed Workers Last
   Year," with a 4-bullet "Today's commitment" callout.

### Page 5 — What's coming (right page of spread)

Headline: **"Shipping next."**

A horizontal timeline with 4 milestones, each with a quarter
label and a 1-sentence description:

- **Q3 2026 — Streaming responses.** The assistant types its
  answer as it thinks, with citations attaching live.
- **Q3 2026 — Per-tenant industry packs.** Toolbox talks tuned
  for dairy, baking, beverage, meat processing, frozen,
  packaging.
- **Q4 2026 — Real-time alerting + automation.** "If a hazard
  report flags 'critical', notify the safety lead within 5
  minutes" — configurable per tenant.
- **Q4 2026 — Department-scoped views.** Foremen see their
  crew. Plant safety leads see the whole site. Corporate sees
  the network.

Below the timeline, a footnote:
> Roadmap reflects current planning and may shift based on
> customer signal.

### Page 6 — Back cover

Top half: a single hero quote in 36-pt slate, centered:

> *"The morning huddle used to take 25 minutes and end with
> people on their phones. Now it's a 5-minute talk on the
> actual hazard for the actual line we're running today."*
> — Plant Safety Lead, midwest baked-goods manufacturer

Bottom half: a clean **"Get a demo"** call-to-action card on
indigo:
- Headline: **See SoteriaField on your line.**
- Bullet: 30-minute demo • your equipment list • your SDS library
- CTA button: **Book a demo →**
- URL: `soteriafield.app/demo`
- Email: `hello@soteriafield.app`

Footer (small, slate-500): SoteriaField is a drafting and
reference tool. A qualified person must verify isolation and
authorize the work in accordance with 29 CFR 1910.147 and your
company's written program. © 2026 SoteriaField, Inc.

### Imagery rules

- **Photography:** photorealistic, not stock-y. Real
  production environments — stainless mixers, conveyors,
  palletizers, CIP stations. Avoid generic "guy in a hard hat
  at a factory" stock.
- **PPE accuracy:** ANSI Z89 hard hat, ANSI Z87.1 safety
  glasses, hi-vis Class 2 vest, voltage-rated gloves at the
  electrical panel. Workers should look credible to a real
  safety professional.
- **iPad:** 12.9" Pro in a rugged case (OtterBox-like).
  Landscape orientation when held two-handed; portrait when
  stowed one-handed.
- **No emojis. No stock-photo handshakes. No "team in a
  meeting room with a whiteboard."**
- **Diversity:** Show a range of ages, races, and genders
  across the brochure's people — but every person should look
  like they actually work in production, not a model in
  costume.

### Typography

- **Headlines:** Inter Display 36–48 pt, weight 700, tight
  tracking
- **Body:** Inter 11–13 pt, weight 400, line-height 1.55
- **Captions / footnotes:** Inter 9 pt, weight 400, slate-500
- **Numbers and metrics:** Tabular figures

### Output

A single PDF, 6 pages, A4 (210 × 297 mm), 300 dpi, CMYK, 3 mm
bleed on all edges, with crop marks. Embed all fonts. Provide
a separate web-resolution version (sRGB, 144 dpi, no bleed)
for the digital download.

---

## Things to confirm before you ship

- **Roadmap quarters (Q3 / Q4 2026)** are inferred from
  PR1–PR3 docstrings (streaming SSE, per-equipment hazard
  cache, department targeting, industry packs). Confirm
  timing with whoever owns the roadmap.
- **Customer pull quote on page 6** is a placeholder. Replace
  with a real attributed quote, or remove the quote and
  re-balance the page.
- **Domain `soteriafield.app` and email `hello@soteriafield.app`**
  are placeholders — swap for live URLs.
