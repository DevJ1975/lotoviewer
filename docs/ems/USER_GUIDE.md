# Environmental (ISO 14001) user guide

For the site environmental lead. One section per screen, in the order you would set up
an environmental management system (EMS): context first, then aspects, then
obligations. Clause numbers are ISO 14001:2015 with Amendment 1:2024.

The screens appear under **Environmental** when an administrator has switched the
Environmental module on for your organization. Anyone in the organization can read
every register. Only owners and admins can change them. The one exception is
recording an evaluation result, which the assigned evaluator may also do.

## The hub: `/environmental`

The **Context, scope & policy**, **Processes & responsibilities**, **Aspects & impacts**,
**Compliance obligations** and **Permits** cards on the hub each carry a traffic light. The Context card
shows the worse of its two registers: context, and scope and policy.

| Light | Meaning |
| --- | --- |
| Red | The register is empty, a required record (scope or policy) is missing, or no one holds one of the two roles clause 5.3 names. For Permits: a renewal deadline has passed with no renewal submitted, or a permit is held by someone other than the legal entity in the scope. |
| Amber | Something needs attention: a review is overdue, an aspect is unscored, a compliance deadline has passed with the obligation still open, an evaluation is overdue, an obligation has no evaluation frequency, the policy is incomplete or has not been communicated within the organization, the scope does not say what the organization controls and influences, no climate-change determination is recorded, or an EMS process has no owner. For Permits: nothing is recorded yet, a renewal is due within 90 days or was submitted and is pending, a permit condition is overdue, or a permit review is overdue. |
| Green | Every record is in date and complete. |

A light changes as soon as the underlying record does, and each card opens the
register behind it. The ISO 14001 report card (`/environmental/report-card`) uses the
same records, and its "fix" links open the right tab of the right screen.

The report card grades clause 5.3 from the Processes page. It marks seven clauses
**Not assessed**, because the platform holds no environmental record for them yet:

- **7.5 documented information and 9.2 internal audit.** The platform has no
  controlled-document register or internal-audit programme yet. Keep that evidence in
  your own document system and reference it from the management review.
- **7.2 competence, 7.3 awareness, 7.4 communication, 8.1 operational control and 8.2
  emergency preparedness.** Safety training, toolbox talks and safety inspections are
  not evidence of these clauses unless they cover environmental work, and the platform
  cannot yet tell which ones do, so the card does not grade them from those records.

A clause that is not assessed never blocks, and it never counts as evidence. Check these
clauses against your own records before an audit. While any clause is not assessed, the
card says *Ready with gaps* at best.

---

## Context, scope and policy: `/environmental/context`

Clauses 4.1, 4.2, 4.3 and 5.2, on three tabs. Each tab has its own address
(`?tab=parties`, `?tab=scope`), so you can bookmark or share a tab.

### Issues (4.1)

The internal and external issues that affect what your EMS can achieve.

- **Record an issue.** Choose a **Kind of issue**: *Internal*, *External* or
  *Climate change*. Describe it in **The issue**, and optionally say **Why it matters
  to the EMS** and whether it is a **Risk**, an **Opportunity** or both (clause 6.1.1).
- **Climate change.** Amendment 1:2024 requires every organization to determine
  whether climate change is a relevant issue (clause 4.1). Record that determination
  as a *Climate change* issue whether the answer is yes or no, and say why. Until one
  is recorded, the strip at the top shows the climate decision as *missing*, and the
  Context light stays amber.
- **Mark reviewed** confirms that an issue still holds. Its next review moves a year
  out.
- **Retire** removes an issue that no longer applies. You must give a reason, and the
  issue stays on record with that reason.

### Interested parties (4.2)

Who has a stake in your EMS, and what they need from you.

- **Record a party**, then describe **Their needs and expectations**.
- If you adopt a need as a compliance obligation (clause 4.2 c), tick **We adopt
  this need as a compliance obligation**. You can then pick **The obligation it became**
  from the obligations register.
- **Retire** and **Reinstate** work as they do for issues.

### Scope and policy (4.3 and 5.2)

- **Document the scope**: the **Legal entity**, the **Physical boundary**, the
  **Activities**, the **Products and services**, and **What we control, and what we can
  only influence**, which records how clause 4.3 e) was considered. If the scope leaves
  any site or activity out, say what and why under **Exclusions, and why**. The
  standard warns that a scope should not leave out activities with significant aspects,
  or be drawn to avoid compliance obligations. Each save creates a new version, and earlier versions
  stay listed. A version saved before this field existed is flagged until a new version
  states it.
- **Record the policy**: the **Policy text**, who it is **Signed by**, and the date
  **Signed on**. You cannot save it until you tick all three commitments that clause
  5.2 requires:
  - protect the environment, including preventing pollution and any other
    commitments relevant to your context;
  - fulfil your compliance obligations;
  - continually improve the EMS to enhance environmental performance.
- If the scope's legal entity changes after the policy was signed, the page warns
  that the policy *carries a prior owner's signature*. The light stays amber until top
  management signs a new version.
- **Record a communication** each time the policy reaches people: choose *Within the
  organization* or *To interested parties outside it*, say **How, and to whom**, and give
  the date. Clause 5.2 requires the policy to be communicated within the organization,
  so the light stays amber until a communication of the version in force within the
  organization is recorded. A record can't be dated before the version was signed.
  Communications are never edited or deleted. To correct one, record the right one.
- **Download for interested parties** saves the policy and the scope as one PDF, ready
  to send to a customer, a regulator or a neighbour. It contains only what the two
  documents state: no review dates and no names other than the policy's signatory. It
  is not available while the policy carries a prior owner's signature.

---

## Processes and responsibilities: `/environmental/processes`

Clauses 4.4 and 5.3. The page maps the processes an EMS needs and how each one's
outputs feed the others, with an owner for each.

- The two roles clause 5.3 names come first: **Ensuring the EMS conforms to ISO 14001**
  and **Reporting EMS performance to top management**. Until both have an owner, the
  light is red.
- Every process is listed, risks and opportunities (6.1.1, 6.1.4) among them, including
  those the platform does not keep records for yet
  (competence, communication, documented information, operational control, emergency
  preparedness and internal audit). The organization runs them on its own records, but
  each still needs an owner. Until each has one, the light is amber.
- An admin picks the owner from the organization's members, and the clear button
  removes it. Every member with access to the module can see who owns what. That is a
  record, not the communication clause 5.3 asks for: tell the workforce who holds each
  responsibility, and keep evidence that you did.
- An owner must be a member. When someone leaves the organization, their processes and
  roles go back to having no owner, and the light shows it.

---

## Environmental aspects: `/environmental/aspects`

Clause 6.1.2. These are the ways your activities, products and services interact with
the environment, and which of those interactions are significant.

### Recording aspects

- **Record aspect.** Name the **Activity, product or service**, the **Environmental
  aspect** and the **Environmental impact**, plus its **Process area**. Optionally add
  the **Life-cycle stage**, the **Flow** (*Input* for resource use, *Output* for
  emissions, discharges and waste), the **Control status**, **Existing or planned
  controls**, a **Source reference** and **Notes**.
- **Control or influence.** Clause 6.1.2 asks which aspects the organization can
  control and which it can only influence. The second kind includes a supplier's
  emissions, a carrier's trucks, and how customers use and dispose of what you make. The
  register marks the second kind *Influence only*. Until each aspect is decided, the
  report card lists the undecided ones under 6.1.2.
- **Import CSV** loads many aspects at once. Use **Download template** for the
  columns. `activity`, `aspect`, `impact` and `process_area` are required.
  `control_level` takes `control` or `influence`. A row can also carry one score (`operating_condition`, `severity`, `likelihood` and
  `rationale`). The import reports each row it could not load.

### Scoring

Each aspect is scored separately under each operating condition: **Normal**,
**Abnormal** (start-up, shutdown, faults) and **Emergency**. Open an aspect and use
**Add score** to choose the **Condition**, **Severity** and **Likelihood**, and say
**Why this score**.

- An aspect is **Significant** when any condition's score reaches your organization's
  significance threshold. With the default method (severity × likelihood, each 1 to 5)
  that threshold is 12.
- The **Conditions** chips (N, A, E) show which conditions have been scored. A dashed
  chip means that condition has not been scored yet.
- Scores are never edited. A new score replaces the old one as the current score, and
  the **Scoring history** keeps every score with its reason and date.
- An aspect with no score at all keeps the Aspects light amber.

### Keeping the register current

- **Link obligations** records which compliance obligations an aspect answers to. The
  links also appear on each obligation.
- **Mark reviewed** confirms the aspect and its scores still hold, and moves the next
  review a year out. The **Next review** column shows when each aspect is due.
- **Mark obsolete** retires an aspect that no longer applies, for example after a
  process change. It needs a reason. Obsolete aspects keep their history, and you can
  show them with the **Show** filter.

### On the floor: the mobile walk-down

The mobile app has a read-only **Environmental aspects** list, which opens from a
card on the Home tab. It groups aspects by process area, puts significant aspects
first, and shows the same N, A and E chips. Use it on a walk-down to check that the
controls listed are the controls in place.

---

## Compliance obligations: `/environmental/obligations`

Clauses 6.1.3 and 9.1.2. These are the legal and other requirements you must or
choose to meet, and the periodic evaluation of whether you meet them.

### Recording obligations

- **Add obligation.** Give it a title, then choose its **Source**: *Law or
  regulation*, *Permit*, *Contract*, *Voluntary commitment* or *Internal requirement*.
  - Add a **Citation** to the public rule or the permit.
  - Set the **Jurisdiction**: *Federal*, a *State* (two-letter code) or a *Local*
    authority.
  - Say **Why it applies** to your site.
- **Next deadline** and **Deadline repeats** put the obligation's due dates in the
  compliance calendar. A deadline that passes with the obligation still open turns the
  Obligations light amber until it is met in the calendar.
- **Evaluate compliance every (days)** records how often you have decided to evaluate
  compliance with this obligation (clause 9.1.2 a). Every obligation needs one,
  including the contract, voluntary and internal requirements you have adopted; one
  left blank keeps the Obligations light amber until it is set.
- An obligation that has been evaluated cannot be deleted from the compliance
  calendar, because its evaluations are part of the record. Dismiss it instead.

### Evaluating compliance

Each night the system opens an evaluation for every obligation that comes due within
the next 30 days. An obligation that has never been evaluated comes due straight
away. The evaluation is assigned to the obligation's owner if they are still a member,
and is otherwise left for an admin to pick up. Whoever is responsible gets an email
reminder. An admin can also **Start an evaluation now**.

On the obligation's page, under **Evaluation of compliance**:

1. **Attach evidence**: a PDF, JPEG, PNG or WebP file of up to 25 MB, filed as a
   *Document*, *Photo*, *Sample result* or *Signature*. The server checks the file's
   real type from its contents, names it for that type, and records a SHA-256
   fingerprint of it. A file over 4 MB goes straight to storage and is checked and
   filed from there, so a large scan needs no compressing.
2. **Record result**:
   - *Compliant* or *Noncompliant* needs at least one current evidence file.
   - *Noncompliant* also opens a nonconformity. Name the **Nonconformity to open** and
     choose its **Classification** (*Observation*, *Minor* or *Major*). The
     evaluation links to the nonconformity.
   - *Not applicable* needs notes saying why.
   - *Undetermined* records that compliance could not be established. It does not
     count as an evaluation: the obligation falls due again straight away, until a
     compliant, noncompliant or not-applicable result is recorded.

Once recorded, an evaluation is sealed and cannot be changed. The next evaluation is
scheduled from it. An evaluation still open after its due date keeps the Obligations
light amber.

### Evidence is never deleted

Evidence files are kept in private storage. Every download is checked against the
fingerprint recorded when the file was filed, and a file that no longer matches is
refused. To correct a file, attach the new one and choose which file it **Replaces**.
The old file stays on record, marked as superseded.

### Keeping the register current

- The **Last result** and **Evaluation due** columns show where each obligation
  stands.
- **Mark reviewed** confirms the obligation still applies as recorded, and moves its
  next review a year out.

---

## Permits: `/environmental/permits`

Clause 6.1.3. The permits, registrations and plans each site holds, when each must be
renewed, and whether each is held by the organization that runs the site. (This is not
the permit-to-work screens; those are for hot work and confined spaces.)

### Recording a permit

An admin chooses a facility in the header and selects **Add permit**. A permit belongs
to one site.

- **Program** (air, waste, wastewater, stormwater, spill prevention, community
  right-to-know or other) and **Kind of paper** (*Permit*, *Registration* or *Plan*).
- **Issuing agency**, **Number** and **Jurisdiction**.
- **Holder of record**: the name printed on the permit itself, not who you wish it
  said. It starts as the legal entity in the scope.
- **Issued on**, **Expires on** (leave blank for a permit with no fixed term, such as
  a permit by rule) and **Renewal application due**. Enter that last date from the
  permit's own terms. The platform never works out a regulatory lead time.
- **Business-critical** marks a permit operations cannot run without.

### The renewal countdown

The countdown runs to the renewal application date when the permit gives one, and to
its expiry otherwise. The card says which: *Renewal application due* or *Expires*. It
escalates at 180, 90 and 30 days, then once the date has passed. Those intervals are
this product's own; the permit says what it actually requires.

- **Record renewal application submitted** stops the countdown and its notices.
- **Record the renewed term** takes the new dates from the agency's renewal and starts
  the countdown again.
- An expired permit with a renewal pending shows *confirm its status with the agency*.
  Whether it stays in force while the agency reviews depends on the program and the
  agency, so the screen does not say.

Each night the owner is emailed at each stage. With no owner, or an owner who has left,
the email goes to the owners and admins. A business-critical permit also reaches the
holder of the Compliance obligations process, and reaches every owner and admin at 30
days and once the date has passed.

### Holder of record

When the holder differs from the legal entity in the scope, the permit shows a red
**Holder mismatch** badge. The two names are compared without regard to capital
letters, full stops, commas or extra spaces. Anything else counts as a difference,
*Inc* and *LLC* and *&* versus *and* included, so write the holder as the permit does.
The Permits light turns red too. Fix it by recording a change of owner or legal name,
below, so each permit is transferred and confirmed. The badge is absent when the scope
is not recorded yet, because there is nothing to compare with.

### Conditions and documents

- **Add a condition** gives the permit a duty with a deadline and a repeat, such as a
  quarterly monitoring report. A condition is an obligation linked to its permit, so it
  also appears in the compliance obligations register and the Compliance Calendar. To
  link an obligation that already exists, edit it and choose its **Linked permit**; only
  an obligation whose source is a permit can be linked.
- **Mark done** records that the condition was done for the deadline shown, with an
  optional note, and moves the deadline on by its repeat. The condition's owner or an
  admin can do it. Attach the evidence to that occurrence straight afterwards, so the
  file proves that instance.
- **Documents** holds the permit itself and anything issued under it. Tick
  **Export-controlled** for a file that is subject to ITAR or EAR: only owners and admins
  can then download it. A file is replaced, not deleted.
- **Retire** takes a permit out of every countdown and notice, with a reason. It is kept
  as history, with its documents.
- **Mark reviewed** confirms the record is still right and moves its next review out.

The hazardous-waste EPA ID is also held in the site's hazardous-waste profile. Until a
later phase links the two, enter the number in both places.

---

## Management of change: `/environmental/changes`

Clauses 6.1.4 and 8.1. When something changes, the records it touches are listed so
none is forgotten, and the change closes only when each has been dealt with.

- **New change** (admins) takes a kind: *New or changed equipment*, *New or changed
  chemical*, *Process change*, *Change of owner or legal name*, *Personnel change* or
  *Other change*. **Preview impacts** says how many impacts opening it will create
  before anything is created.
- An equipment or process change lists the active aspects in the process area it names.
  A chemical change lists the open air and waste obligations. A personnel or other
  change lists nothing automatically, so its checklist starts empty. The list is worked
  out when the change opens; a record added later is not on it.
- A **change of owner or legal name** covers every site, so open it with *All
  facilities* chosen in the header. It lists three steps for each active permit, *Notify
  the agency*, *Submit the transfer or update* and *Confirm the holder of record is
  updated*, then the scope and the policy.

Each impact is **Resolved**, and the screen says what is holding one back. Each of a
permit's three transfer steps needs a file that shows it was done, and **Confirm the
holder** is also refused until the permit's holder of record has been edited to match
the new legal entity. The scope is resolved once a new scope version names the new
entity, and the policy once it has been signed again after that. Any other impact
needs a note saying what was done. If the database still refuses, the screen shows its
reason. **Close change** is available once every impact is resolved. **Cancel change**
needs a reason and keeps the impacts as history. Once a change has ended, its impacts
and their evidence no longer change.

---

## The demo organization

`Northfield Forge & Finish` (Northfield, TX) is a fictional demo organization. Every
record in it is invented. To load it into a development or demo database:

1. Run `apps/web/migrations/seed_ems_northfield_demo.sql` in the SQL editor. This
   loads every register, two open evaluations (one overdue), and a deliberately
   overdue obligation review. Process owners must be real members, so the seed assigns
   none. Assigning them on the Processes page makes a good live step in a demo.
2. Optionally, to add the completed evaluations, run
   `node apps/web/scripts/seed-ems-northfield-evidence.mjs --as <your email>`, with
   `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set. This adds:
   - two compliant evaluations;
   - a noncompliant one with its nonconformity;
   - a not-applicable one.

   Each evidence file it uploads says on its face that it is invented.

Both steps are safe to re-run.
