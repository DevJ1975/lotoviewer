import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-07-17'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-07-17', changes: ['Initial incident-reporting wiki page.'] },
]

export default function WikiIncidentReportingPage() {
  return (
    <WikiPage
      title="Incident Reporting"
      subtitle="File incidents, triage by severity, notify the right people, and hand off to investigation."
      modulePath="/incidents"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',   label: 'What it\'s for' },
        { id: 'report',     label: 'Filing a report' },
        { id: 'lifecycle',  label: 'Status lifecycle' },
        { id: 'detail',     label: 'The incident page' },
        { id: 'anonymous',  label: 'Anonymous QR reporting' },
        { id: 'compliance', label: 'OSHA & regulatory' },
        { id: 'ai',         label: 'AI assists (advisory)' },
        { id: 'faq',        label: 'FAQ' },
        { id: 'dodonts',    label: 'Do\'s & Don\'ts' },
        { id: 'related',    label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          One log for everything that goes wrong on site: injuries and
          illnesses, near misses, property damage, and environmental spills.
          A report captures the facts while they&apos;re fresh, fans out
          notifications to the people your rules name, and becomes the anchor
          for everything downstream — investigation, corrective actions, care
          management, and OSHA paperwork. The triage list at{' '}
          <Link href="/incidents">/incidents</Link> counts open reports by
          severity (Catastrophic, Fatality, Lost-time, Medical, First-aid,
          No injury) and hides closed reports by default.
        </p>
      </Section>

      <Section id="report" title="Filing a report">
        <p>
          Any signed-in member can file — press <strong>Report incident</strong>{' '}
          on the list, fill the form, then <strong>File incident</strong>. Three
          fields are required: the <strong>incident type</strong>, <strong>when
          it happened</strong> (can&apos;t be in the future), and <strong>what
          happened</strong>. Everything else strengthens the report:
        </p>
        <ul>
          <li><strong>Type</strong> — Injury / illness, Near miss, Property
            damage, or Environmental spill. Injury/illness unlocks the Care and
            Classify tabs; environmental spills get a substance / quantity /
            unit fieldset.</li>
          <li><strong>Severity (actual)</strong> — from No injury up to
            Catastrophic. It&apos;s your best guess at intake; admins refine it
            later (injuries: on the Classify tab). A near-miss must stay at
            &quot;No injury&quot; — if anyone was hurt, it&apos;s an
            injury/illness report.</li>
          <li><strong>Severity potential &amp; probability</strong> — the
            worst credible outcome and how likely a repeat is. These drive
            triage order.</li>
          <li><strong>Location + Tag GPS</strong> — free text plus a one-tap
            coordinate capture from your phone.</li>
          <li><strong>Immediate action taken</strong> — what you did on the
            spot to make the area safe.</li>
        </ul>
        <p>
          On submit the report gets a number (INC-YYYY-NNNN), raises a Command
          Center safety alert, and sends the notifications your admin&apos;s
          rules match — the report&apos;s Overview shows exactly who was
          notified and when.
        </p>
      </Section>

      <Section id="lifecycle" title="Status lifecycle">
        <ul>
          <li><strong>Reported</strong> — just filed, awaiting triage.</li>
          <li><strong>Triaged</strong> — severity confirmed, investigator assigned.</li>
          <li><strong>Investigating</strong> — set automatically when an
            investigation is started.</li>
          <li><strong>Pending review</strong> — set automatically when the
            investigation is signed off.</li>
          <li><strong>Closed</strong> — actions complete; the closing user and
            time are stamped.</li>
          <li><strong>Reopened</strong> — new information after closure.</li>
        </ul>
        <p>
          Members can edit the description and immediate-action fields of a
          report. Status, severity, and investigator assignment are
          admin/owner-only, so the triage record holds up to audit.
        </p>
      </Section>

      <Section id="detail" title="The incident page">
        <p>
          Each report has tabs: <strong>Overview</strong>,{' '}
          <strong>Investigate &amp; RCA</strong> (see the{' '}
          <Link href="/wiki/incident-investigation">investigation wiki</Link>{' '}
          and the <Link href="/wiki/ecfa">ECFA wiki</Link>), and{' '}
          <strong>Actions</strong> for corrective/preventive actions with
          owners, due dates, and independent verification. Injury/illness
          reports add <strong>Care</strong> (case management, restricted to
          authorized users) and <strong>Classify</strong> (OSHA recordability,
          admin-only).
        </p>
        <p>
          The Overview also surfaces: people involved and witness statements
          (admins can send witnesses a tokenized link — no login needed), a
          repeat-incident banner when similar reports exist, the AI
          escalation-prediction panel, chemical exposures, and — for
          environmental spills — EPA reportable-quantity and Prop 65 banners.
        </p>
      </Section>

      <Section id="anonymous" title="Anonymous QR reporting">
        <p>
          Admins can print QR posters from{' '}
          <Link href="/incidents/qr">/incidents/qr</Link>. Scanning one opens a
          public form — no account, no login — with a three-tap severity
          picker, optional photos (up to 3) and a voice note, and English /
          Spanish text. Reporters can take a receipt PIN to check the status of
          their report later. Per-poster settings cover rate limits, captcha,
          geofencing, and auto-routing to an investigator. Anonymous reporting
          exists to satisfy OSHA&apos;s anti-retaliation rule — treat every
          submission as a gift, not a nuisance.
        </p>
      </Section>

      <Section id="compliance" title="OSHA & regulatory">
        <ul>
          <li><strong>Recordability (1904.7)</strong> — the Classify tab walks
            admins through work-relatedness, new-case, and outcome questions,
            with a live &quot;Recordable / Not recordable&quot; preview.
            Recordable cases land on the OSHA 300 log automatically; privacy
            cases are redacted per 1904.29(b)(7).</li>
          <li><strong>Severe-injury clock (1904.39)</strong> — flag a
            fatality (8-hour deadline) or an in-patient hospitalization,
            amputation, or loss of an eye (24 hours) and the Overview shows a
            live countdown until you record the OSHA filing.</li>
          <li><strong>Year-end paperwork</strong> — the OSHA hub handles the
            300 / 300A / ITA exports and 300A certification.</li>
        </ul>
      </Section>

      <Section id="ai" title="AI assists (advisory)">
        <p>
          Two AI helpers ride along, both admin-only and advisory —
          nothing the AI proposes is saved until a person accepts it:
        </p>
        <ul>
          <li><strong>Escalation prediction</strong> — &quot;Run
            prediction&quot; asks whether the report looks under-classified
            and shows an amber banner if so. The reporter&apos;s severity is
            never changed automatically.</li>
          <li><strong>Classify suggestion</strong> — &quot;Get AI
            suggestion&quot; drafts a recordability call with its reasoning;
            your classification is the final word, and the record notes when
            a human overrode the AI.</li>
        </ul>
        <p>
          AI calls are rate-limited per user and capped by a tenant budget. If
          you see &quot;AI rate limit reached&quot; or &quot;Daily AI budget
          exceeded&quot;, the form still works — only the assist is paused.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Who can file an incident?',
            a: <>Any signed-in member of the tenant. People without an account
              can report through an anonymous QR poster, and witnesses can
              submit statements through a tokenized link.</>,
          },
          {
            q: 'Near-miss incident type vs. the Near-Miss module — which do I use?',
            a: <>They&apos;re different tools. A <em>near-miss incident</em>{' '}
              (filed here) goes through the full incident workflow —
              investigation, RCA, corrective actions. The standalone{' '}
              <Link href="/near-miss">Near-Miss module</Link> is the
              lightweight channel for &quot;almost happened&quot; observations:
              quick triage, AI theme tagging, and one-click escalation to the
              risk register. Rule of thumb: if it warrants an investigation,
              file it here; if it&apos;s a frontline observation, use
              Near-Miss.</>,
          },
          {
            q: 'I picked the wrong severity — can I fix it?',
            a: <>Members can&apos;t edit severity after filing; ask an admin,
              who can update it from the Overview. For injuries the Classify
              tab is where severity gets its final, OSHA-grade answer. The
              escalation-prediction panel exists to catch under-classification
              early.</>,
          },
          {
            q: 'Why can\'t I change the status?',
            a: <>Status transitions (other than the initial Reported) are
              admin/owner-only. Statuses also move on their own: starting an
              investigation sets Investigating, and signing one off sets
              Pending review.</>,
          },
          {
            q: 'Who gets notified when I file?',
            a: <>Whatever your admin&apos;s notification rules say — matched
              by incident type, severity, and recordability, with email
              delivery today. The report&apos;s Overview lists every
              notification sent. Unacknowledged high-severity reports also
              trigger SLA escalation emails on a timer.</>,
          },
          {
            q: 'When is an injury OSHA-recordable?',
            a: <>When it&apos;s work-related, a new case, and involves death,
              days away, restricted work / job transfer, or medical treatment
              beyond first aid (1904.7). The Classify wizard walks you through
              exactly those questions — you don&apos;t need the regulation
              memorized.</>,
          },
          {
            q: 'What\'s the deadline for reporting a severe injury to OSHA?',
            a: <>8 hours for a fatality; 24 hours for an in-patient
              hospitalization, amputation, or loss of an eye. Flag the event
              on the report&apos;s Overview and the countdown starts — record
              the filing method and case number once you&apos;ve called it
              in.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'File within the shift, with the real occurrence time — the form won\'t accept future times, and the SLA clocks run from what you enter.',
            'Pick the worst credible actual severity at intake and let the Classify tab refine it. Under-calling severity delays the response.',
            'Use Tag GPS and name the exact spot ("mezzanine stairs, east end") — the next reader wasn\'t there.',
            'Describe conditions and facts, not conclusions. "Oil film below press 4, drip tray missing" beats "operator was careless".',
            'Start the severe-injury clock immediately for a fatality or hospitalization — the 8/24-hour window is unforgiving.',
          ]}
          donts={[
            'Don\'t file a near-miss if anyone was hurt — the form will reject it. That\'s an injury/illness report.',
            'Don\'t wait for complete information to file. Submit what you know; the description stays editable.',
            'Don\'t open a duplicate for the same event — the repeat-incident banner will tell you if a sibling report exists.',
            'Don\'t assign blame in the description. The investigation looks for systemic causes, and the report is discoverable.',
            'Don\'t track OSHA paperwork on the side — classify in the app so the 300 log, 300A, and ITA export stay authoritative.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/incident-investigation', label: 'Incident Investigation & RCA' },
          { href: '/wiki/ecfa',                   label: 'Events & Causal Factors Analysis' },
          { href: '/wiki/near-miss',              label: 'Near-Miss Reporting' },
          { href: '/wiki/scorecard',              label: 'EHS Scorecard' },
          { href: '/wiki/notifications',          label: 'Notifications' },
        ]} />
      </Section>
    </WikiPage>
  )
}
