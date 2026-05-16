import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.1.0'
const LAST_UPDATED    = '2026-05-16'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date:    '2026-05-16',
    changes: [
      'ISO 45001 clause map (clauses 6.1.3 legal compliance and 7.4 ' +
      'communication) now references the prop65_* tables. See ' +
      '/wiki/prop65 for the full California Prop 65 module.',
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-05-15',
    changes: [
      'Initial publication for the Integrity & Compliance module: ' +
      'sealed PDF artifacts with SHA-256 chain-of-custody, tenant ' +
      'retention policy + legal holds, ISO 45001 §10.2 corrective-' +
      'action verification-of-effectiveness, hierarchy-of-controls ' +
      'on near-miss → risk escalation, ISO 45001:2018 clause-evidence ' +
      'map, and AI-assisted incident severity escalation.',
    ],
  },
]

export default function WikiIntegrityCompliancePage() {
  return (
    <WikiPage
      title="Integrity & Compliance"
      subtitle="Chain-of-custody, retention + legal holds, CAPA loops, hierarchy of controls, ISO 45001, AI triage."
      modulePath="/admin/iso45001"
      audience="admin"
      category="Admin"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',   label: 'What it\'s for' },
        { id: 'sealed',     label: 'Sealed PDF artifacts' },
        { id: 'retention',  label: 'Retention + legal holds' },
        { id: 'capas',      label: 'CAPA → verification of effectiveness' },
        { id: 'hierarchy',  label: 'Hierarchy of controls on escalation' },
        { id: 'iso45001',   label: 'ISO 45001 clause-evidence map' },
        { id: 'ai',         label: 'AI-assisted severity prediction' },
        { id: 'faq',        label: 'FAQ' },
        { id: 'dodonts',    label: 'Do\'s & Don\'ts' },
        { id: 'related',    label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Modules in the rest of the platform produce records — incidents,
          permits, training, placards. The Integrity & Compliance module
          is what makes those records <em>defensible</em> in a regulator's
          office: each artifact is chain-of-custody hashed, retained for
          the right window (or held indefinitely under a legal hold),
          rolls up against the ISO 45001 clauses it satisfies, and gets
          a verification-of-effectiveness loop closed before it counts
          as resolved.
        </p>
        <p>
          Six surfaces live here. Each is independent — you don&apos;t
          need ISO 45001 to use CAPAs, and you don&apos;t need legal
          holds to use sealed PDFs.
        </p>
      </Section>

      <Section id="sealed" title="Sealed PDF artifacts">
        <p>
          The review-portal signoff workflow already captured a typed
          name, drawn signature, IP, and user agent. This release adds
          a SHA-256 hash of the rendered placard PDF, stored alongside
          the signoff in <code>loto_signed_pdf_artifacts</code>. The
          hash is computed in the browser via the Web Crypto API right
          before upload, so the bytes you can download match the bytes
          the system thinks it sealed.
        </p>
        <p>
          The hash also lands on the cover sheet of any{' '}
          <Link href="/admin/compliance-bundle">compliance bundle</Link>
          {' '}generated for a window that includes the signoff. The
          read-only listing at{' '}
          <Link href="/admin/signed-artifacts">/admin/signed-artifacts</Link>
          {' '}lets you spot-check: copy the hash, download the PDF,
          run <code>openssl dgst -sha256 -hex</code> on it, confirm
          they match. A mismatch is evidence the bytes were modified
          after signoff — escalate.
        </p>
      </Section>

      <Section id="retention" title="Retention + legal holds">
        <p>
          Each tenant carries a retention policy: how many days incidents,
          permits, and training records persist, plus a per-tenant
          LOTO-artifact retention window in years (default 7).
          Defaults match OSHA 1904.33 (5 years for OSHA logs), the
          permits and training defaults map to common state-level
          requirements, and the LOTO floor aligns with a typical
          equipment-lifetime + 3 years posture.
        </p>
        <p>
          <strong>The retention module classifies; it does NOT delete.</strong>
          The actual deletion cron lives outside this release. The
          UI surface lets you see what would become eligible and place
          legal holds that <em>always</em> prevent the future cron from
          touching a row, no matter how old it is. Releasing the hold
          (with a documented reason) restores normal classification.
        </p>
        <p>
          Why this matters: under a regulatory investigation, the
          spoliation-of-evidence doctrine requires affirmative action
          to retain everything relevant. A flagged legal hold is the
          documented control that demonstrates you did exactly that.
        </p>
      </Section>

      <Section id="capas" title="CAPA → verification of effectiveness">
        <p>
          ISO 45001 §10.2 distinguishes between &quot;closing the action
          item&quot; and &quot;verifying the action was effective at
          eliminating the underlying nonconformity.&quot; The pre-
          existing <code>incident_actions</code> table tracks the
          former. The new <code>incident_capas</code> table tracks the
          latter — and adds the discipline that the verifier must be a
          different user from the completer.
        </p>
        <p>
          Open an incident detail page, scroll to the CAPAs panel.
          Each CAPA carries a hierarchy-of-controls level (eliminate,
          substitute, engineering, administrative, PPE) so the
          aggregate &quot;how PPE-heavy is our CAPA mix?&quot; question
          is answerable. The lifecycle is: <em>open → in_progress →
          completed → verified</em> (or <em>cancelled</em>). The
          different-verifier rule is enforced at the API layer (clean
          403) and at the DB trigger layer (defense in depth).
        </p>
      </Section>

      <Section id="hierarchy" title="Hierarchy of controls on escalation">
        <p>
          Escalating a near-miss to the risk register no longer creates
          a bare risk row — the modal now requires the reporter to pick
          at least one initial mitigating control with a hierarchy
          level. This is a soft-but-real management-system control: an
          organization with a healthy risk program produces escalations
          that tilt toward elimination / substitution / engineering and
          uses PPE as the last line, not the first. The aggregate is
          surfaced on the risk detail page as a stacked summary with a
          &quot;top-of-hierarchy&quot; indicator.
        </p>
      </Section>

      <Section id="iso45001" title="ISO 45001 clause-evidence map">
        <p>
          The standard reads as a set of management-system clauses
          (6.1 Risk, 7.2 Competence, 8.1 Operations, 9.1 Monitoring,
          10.2 Nonconformity). For each surveillance audit, the auditor
          asks: &quot;show me evidence that 8.1.2 is operating.&quot;
        </p>
        <p>
          The map at{' '}
          <Link href="/admin/iso45001">/admin/iso45001</Link> lists
          every clause the platform satisfies and which modules
          contribute. Click into a clause to see the evidence rows
          themselves (filtered to the tenant); export an evidence
          pack as a PDF you can hand directly to the auditor.
        </p>
      </Section>

      <Section id="ai" title="AI-assisted severity prediction">
        <p>
          Reporters routinely under-classify incident severity. A
          first-aid case turns into a lost-time case after a
          delayed-care injury surfaces; a near-miss gets recorded as
          first_aid because the reporter is downplaying. The
          prediction endpoint runs Claude Haiku over the description
          and reporter classification, returns a predicted severity
          with confidence + reasoning, and surfaces an advisory
          banner when its prediction is strictly higher than the
          reporter&apos;s with confidence ≥ 0.7.
        </p>
        <p>
          The model NEVER mutates <code>severity_actual</code>. It
          prompts the admin to reclassify. Every invocation is logged
          for cost auditing and prompt-revision tracking. Rate limit:
          30 predictions per admin per hour, 150 per day. Per-tenant
          Anthropic key resolution + structured json_schema output
          keep the surface predictable; prompt injection in the
          description text can only confuse the model into a bad
          classification, never escape the enum response.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'I have one tenant that wants 10-year retention. Can I set that?',
            a: <>Yes — open{' '}
              <Link href="/admin/retention">/admin/retention</Link>{' '}
              and change the days field for the relevant record type.
              Numbers are tenant-scoped; the default seed only applies
              to tenants that haven&apos;t edited theirs.</>,
          },
          {
            q: 'Does releasing a legal hold delete anything immediately?',
            a: <>No. Releasing the hold restores normal retention
              classification. If the record had already aged past its
              window, the future purge cron would pick it up on its
              next run. Nothing deletes today — the cron isn&apos;t
              shipped yet.</>,
          },
          {
            q: 'Why can\'t I verify-effective my own CAPA?',
            a: <>Because §10.2&apos;s value comes from a second pair
              of eyes. If the person who completed the action also
              certifies it was effective, you&apos;ve documented a
              process step, not a control. Sign out, have a
              colleague (or the safety lead) verify.</>,
          },
          {
            q: 'The AI prediction says lost_time, the reporter said first_aid. Do I have to update?',
            a: <>No — it&apos;s advisory. The banner gives you the
              model&apos;s reasoning so you can make the call. If you
              disagree, ignore it; the prediction stays in the audit
              log either way.</>,
          },
          {
            q: 'A reviewer signed off on a placard. Can I recompute the SHA-256 a year later?',
            a: <>Yes. Download the PDF from{' '}
              <Link href="/admin/signed-artifacts">/admin/signed-artifacts</Link>
              {' '}or from the compliance bundle, then run{' '}
              <code>openssl dgst -sha256 -hex</code>. Matching the
              stored hash proves the bytes weren&apos;t modified
              between signoff and inspection.</>,
          },
          {
            q: 'Are the ISO 45001 evidence packs auditor-ready?',
            a: <>They&apos;re a starting point: clause cover sheet +
              the underlying rows. An external auditor will still
              want narrative context for each piece of evidence. The
              pack saves you the &quot;which rows do I have for
              clause 10.2?&quot; problem; it doesn&apos;t replace
              the conversation.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Sample-verify the sealed-artifact hashes at least quarterly. The discipline catches storage-tier corruption + accidental client-side bugs.',
            'Place a legal hold the MOMENT you receive notice of an investigation. The hold runtime begins at placement, not at notice — being a day late is a real evidentiary risk.',
            'Use the hierarchy of controls dropdown honestly. If your near-miss escalations are 70% PPE, the program is broken; the data should reflect that, not hide it.',
            'Treat the AI prediction as a triage prompt. It surfaces incidents that need a second look; it does not adjudicate severity.',
            'Tag every evidence row to its ISO 45001 clause as the artifact is created, not retroactively. The retro pass always finds gaps the auditor will see.',
          ]}
          donts={[
            'Don\'t edit a sealed PDF after signoff. The hash will not match and the audit log will show the change. If you need a corrected placard, send a fresh review-portal link and seal the new one.',
            'Don\'t set retention windows below the regulatory floor (1904.33 is 5y for OSHA logs). The platform won\'t stop you, but you\'ll fail the next audit.',
            'Don\'t self-verify CAPAs by signing out and back in as a different admin you also control. The DB only sees user_id; the integrity of the rule depends on your honesty.',
            'Don\'t share the AI prediction with the reporter as authority. The model is advisory; treating it as &quot;the system said your incident is lost-time&quot; is a chilling-effect problem.',
            'Don\'t batch-create CAPAs from a spreadsheet without hierarchy levels. A bare action item without a hierarchy is just a TODO; the system can\'t aggregate it into a controls posture.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/loto-compliance',  label: 'LOTO Compliance' },
          { href: '/wiki/review-portal',    label: 'Client Review Portal' },
          { href: '/wiki/compliance-bundle',label: 'Compliance Bundle' },
          { href: '/wiki/risk',             label: 'Risk Assessment' },
          { href: '/wiki/near-miss',        label: 'Near-Miss Reporting' },
          { href: '/wiki/insights',         label: 'Insights (CAPA widget)' },
          { href: '/wiki/audit',            label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
