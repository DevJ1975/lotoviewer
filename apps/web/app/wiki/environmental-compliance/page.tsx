import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-10-07'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date: '2026-10-07',
    changes: [
      'Initial page for the Environmental compliance suite: per-site setup with a state dropdown (California and Texas rules layered on the federal baseline; other states show the federal baseline and say so), the compliance calendar with weekly email reminders, interactive checklists (stormwater, outfall inspections, wastewater pretreatment) that raise findings and complete their deadline, the legal register, permits with renewal deadlines, stormwater outfalls, a dashboard panel, and the assistant\'s environmental tools.',
      'The jurisdiction library is a draft: written with citations and marked for review by a Certified Safety Professional before it is treated as reviewed. Anything specific that has not been confirmed against current regulation text carries a "Verify" note.',
    ],
  },
]

export default function WikiEnvironmentalCompliancePage() {
  return (
    <WikiPage
      title="Environmental Compliance"
      subtitle="Permits, inspections, deadlines and the legal register for each site, with the state's rules on top of the federal baseline."
      modulePath="/environmental/compliance"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',   label: 'What it\'s for' },
        { id: 'draft',      label: 'Draft content' },
        { id: 'setup',      label: 'Setting up a site' },
        { id: 'jurisdiction', label: 'Federal and state rules' },
        { id: 'calendar',   label: 'The calendar' },
        { id: 'checklists', label: 'Running a checklist' },
        { id: 'legal',      label: 'The legal register' },
        { id: 'permits',    label: 'Permits and outfalls' },
        { id: 'elsewhere',  label: 'Where it shows up' },
        { id: 'roles',      label: 'Who can do what' },
        { id: 'faq',        label: 'FAQ' },
        { id: 'dodonts',    label: 'Do\'s & Don\'ts' },
        { id: 'related',    label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          One place to see, for each site, what environmental rules apply, what is due, whether you are
          meeting each requirement, and the record that shows it. A stormwater inspection done at an
          outfall on a phone becomes evidence, raises a finding if something failed, and completes the
          deadline it satisfies, without anyone re-keying it.
        </p>
        <p>
          It covers, today: industrial stormwater and outfall inspections, industrial wastewater
          pretreatment checks, and a legal register and calendar that also carry the hazardous waste, air,
          SPCC and EPCRA requirements and deadlines. Dedicated checklists for those other programs, and
          hazardous waste manifest tracking, are planned and are not in this version.
        </p>
      </Section>

      <Section id="draft" title="Draft content">
        <p>
          The checklists, deadlines and legal requirements come from a jurisdiction library. It was
          drafted from the regulations with citations, and it has <strong>not yet been reviewed and signed
          off by a Certified Safety Professional</strong>. Every screen says so with a{' '}
          <strong>Draft: pending expert review</strong> badge, and anything specific that has not been
          confirmed against current text (a permit number, a deadline date, a threshold) carries a{' '}
          <strong>Verify</strong> note saying what to check.
        </p>
        <p>
          Treat the library as a well-organized starting point, not as legal advice. Edit what does not fit
          your permit: your permit and your agency are the authority.
        </p>
      </Section>

      <Section id="setup" title="Setting up a site">
        <ol className="list-decimal space-y-2 pl-5">
          <li>Open <strong>Environmental → Compliance suite</strong> and choose a site (the site picker in the header, or <strong>Open</strong> in the all-sites table).</li>
          <li>Choose the site&apos;s <strong>State</strong>. This decides whose rules apply, and it also sets the site&apos;s OSHA reporting jurisdiction elsewhere in the product: the screen tells you when a save changed it.</li>
          <li>Answer the program questions: stormwater coverage, air permit, wastewater discharge, SPCC, Tier II. Anything left at &quot;Not evaluated yet&quot; adds nothing: the library does not guess that a site is subject to a program.</li>
          <li>Press <strong>Save and confirm</strong> once you have checked each answer against your permits. Changing an answer later withdraws the confirmation until you confirm again, so &quot;confirmed&quot; always describes what is on screen.</li>
          <li>Press <strong>Preview what would be added</strong>. You see every legal requirement, checklist and deadline the library would add for this site, and which ones need checking. Nothing is written yet. Press <strong>Add these to the site</strong> to apply them.</li>
        </ol>
        <p>
          Applying is safe to repeat. Whatever the site already has is left alone, so an owner or a date you
          changed is never overwritten; running it again only fills gaps.
        </p>
      </Section>

      <Section id="jurisdiction" title="Federal and state rules">
        <p>
          The federal baseline always applies. California and Texas add their own requirements, checklists
          and deadlines on top, and where a state replaces a federal item it says so. A state is content,
          not code: more states can be added without changing the product.
        </p>
        <p>
          For a site whose state has no rules in the library yet, or no state at all, you get the federal
          baseline only, with a banner saying exactly that. It is a reference, not that state&apos;s rule:
          confirm everything against your state permits and agency.
        </p>
      </Section>

      <Section id="calendar" title="The calendar">
        <p>
          <strong>Compliance suite → Calendar</strong> lists every environmental deadline for the site as a
          list grouped by Overdue, Due soon and Upcoming, or as a month grid. Deadlines come from three places:
          the library (monthly inspections, semiannual and annual reports), your permits (a renewal deadline
          is created for each active permit with an expiration date, ahead of expiry by the renewal lead time
          you set), and ones you add yourself, for one site or for every site.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Completing a deadline</strong> records who and when and moves it to its next date. A deadline set to fall on a period end (month, quarter, half-year) stays on period ends instead of drifting.</li>
          <li><strong>Completing it by running its checklist</strong> does the same automatically. A checklist with failures still completes the occurrence: the duty is to inspect, and what you found is recorded as findings.</li>
          <li>If the deadline has already moved on since you opened the page, completing it is refused with a message instead of skipping a period.</li>
          <li><strong>Reminders:</strong> from the day a deadline&apos;s reminder window opens, and every week while it stays open (overdue ones included), its owner gets an email. A deadline with no owner goes to the account&apos;s admins, so it is never nobody&apos;s.</li>
        </ul>
      </Section>

      <Section id="checklists" title="Running a checklist">
        <p>
          <strong>Compliance suite → Checklists</strong> lists the checklists that apply to the site, with when
          each was last done. <strong>Start</strong> opens one; checklists run against an outfall ask which
          one first. From the calendar, <strong>Run checklist</strong> on a deadline opens its checklist already
          linked to that deadline.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Each question shows what to look for and why it is asked, with its citation, one tap away.</li>
          <li>A reading (such as pH) is judged against its limits as you type. A reading outside its limits is recorded as a failure.</li>
          <li>When something fails, say what you saw and add a photo: that text goes into the finding.</li>
          <li>Required questions are marked <strong>*</strong>. Submit stays off until they are answered, and lists the ones still open.</li>
          <li>Your answers are kept on the device as you go, so a dropped signal or an accidental reload loses nothing.</li>
          <li>To submit, confirm the answers are accurate and sign with your name (you can also sign with a finger). A submitted checklist is a record and opens read-only.</li>
        </ul>
        <p>
          Every failed question that is set to raise an action becomes a finding under{' '}
          <strong>Environmental → Nonconformities</strong>, with the question, your note, the citation and
          whether a photo was attached. Findings are raised as observations, or minor if the question is
          marked critical; <strong>nothing is ever raised as major automatically</strong>, because classifying
          a nonconformity is a person&apos;s judgment.
        </p>
      </Section>

      <Section id="legal" title="The legal register">
        <p>
          The register lists the requirements that apply to each site. For each one, an admin records whether
          it <strong>applies</strong> (applicable, not applicable, under review) and, if it applies, whether you
          are <strong>meeting it</strong> (compliant, needs attention, non-compliant). A rating of needs
          attention or non-compliant must say what is wrong. A requirement marked not applicable is not rated.
        </p>
        <p>
          Each requirement is reviewed yearly. <strong>Mark reviewed</strong> records the date (set by the
          server, so it cannot be back-dated) and sets the next review. Requirements added by the library show
          their <strong>Verify</strong> note where the library has one; you can add your own requirements too.
        </p>
      </Section>

      <Section id="permits" title="Permits and outfalls">
        <p>
          <strong>Permits</strong> hold the number, agency, dates, conditions, identifiers and the permit
          document. Each shows its standing: active, expiring (inside its renewal window), expired, or not
          tracked (a draft or terminated permit). An active permit with an expiration date puts its own renewal
          deadline on the calendar and moves it if you change the date. Set the renewal lead time to your own
          safety margin: the permit itself says what your agency requires.
        </p>
        <p>
          <strong>Outfalls</strong> record each discharge point: code, receiving water, coordinates, whether it
          is a sampling point, the permit it falls under, and whether it is substantially identical to another
          outfall. An outfall&apos;s permit and its &quot;same as&quot; outfall must be at the same site.{' '}
          <strong>Inspect</strong> on an outfall opens the outfall checklists for it.
        </p>
      </Section>

      <Section id="elsewhere" title="Where it shows up">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Home dashboard:</strong> an Environmental compliance panel with overdue deadlines, permits to renew, non-compliant requirements and open findings, each linking to where it is fixed.</li>
          <li><strong>ISO 14001 audit readiness:</strong> nothing extra to set up. The deadlines count toward clause 6.1.3 (compliance obligations), completed checklists toward 8.1 (operational control), and completing a deadline is the recorded evaluation behind 9.1.2 (evaluation of compliance).</li>
          <li><strong>The assistant</strong> can answer how-to questions with citations, list what is due, and summarize where each site stands.</li>
          <li><strong>Safety analytics:</strong> environmental checklists are kept out of the injury-risk model and the leading-indicator analysis, so an oil sheen at an outfall never raises an injury-risk score.</li>
        </ul>
      </Section>

      <Section id="roles" title="Who can do what">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Anyone on the team</strong> can read everything and run and submit checklists.</li>
          <li><strong>Tenant admins</strong> change the site profile, apply the library, add and edit permits, outfalls, requirements and deadlines, and rate and review requirements.</li>
          <li><strong>A deadline&apos;s owner</strong>, or an admin, can complete it by hand. Owners must be members of the account.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why does a site say "federal baseline only"?',
            a: <>Its state is not set, or the library does not have that state&apos;s rules yet. The federal rules
              are shown as a reference and the banner says so. Set the state on the Overview page, or ask for the
              state to be added.</>,
          },
          {
            q: 'Can I change what the library gave me?',
            a: <>Yes. Edit the owner, dates and reminder window of any deadline, edit or delete a requirement, and
              add your own. Applying the library again never overwrites your changes; it only adds what is missing
              (and brings back a library item you deleted).</>,
          },
          {
            q: 'A checklist failed. Is the deadline still done?',
            a: <>Yes. The duty is to carry out the inspection; what it found is recorded as findings to follow up.</>,
          },
          {
            q: 'Why did a requirement get no rating?',
            a: <>A requirement marked not applicable is not rated, and one under review waits for a decision.</>,
          },
          {
            q: 'Is this legal advice?',
            a: <>No. The library is a draft pending expert review and your permits and agency are the authority. The
              Verify notes say what to confirm.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Check every site-profile answer against the actual permit before you confirm it.',
            'Read the Verify notes and confirm those items against the current regulation or your permit.',
            'Set an owner on each deadline so reminders go to the person who does the work.',
            'Say what you saw, and add a photo, when you fail a question: that is the evidence.',
          ]}
          donts={[
            'Don\'t treat the draft library as reviewed or as legal advice.',
            'Don\'t mark a requirement compliant without evidence you could show an inspector.',
            'Don\'t delete a deadline to silence it: complete it, dismiss it with a reason, or fix its date.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/iso-14001',          label: 'ISO 14001' },
          { href: '/wiki/compliance-calendar', label: 'Compliance Calendar' },
          { href: '/wiki/inspections',        label: 'Inspections' },
        ]} />
      </Section>
    </WikiPage>
  )
}
