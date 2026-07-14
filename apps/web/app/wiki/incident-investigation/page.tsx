import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.1.0'
const LAST_UPDATED    = '2026-07-14'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.1.0',
    date:    '2026-07-14',
    changes: [
      'The 5 Whys method is retired: existing 5 Whys investigations stay ' +
      'read-only, and new investigations use Fishbone / TapRooT / ICAM or the ' +
      'new Events & Causal Factors Analysis (ECFA) tool.',
    ],
  },
  {
    version: '1.0.0',
    date:    '2026-06-17',
    changes: [
      'Rebuilt the 5 Whys / root-cause tool: contextual prompts that chain each ' +
      '“why” to the answer above it, branching, multiple identified root causes, ' +
      'and an inline anti-blame guardrail.',
      'Added AI assist (human-approved): “Suggest next why” and “Draft root cause ' +
      '& actions”. Nothing the AI proposes is saved until a person accepts it.',
      'Unified the investigation: the RCA editor now lives inside the Investigate ' +
      'tab. One click pulls identified roots into the narrative and turns a root ' +
      'cause into a tracked corrective action. The old /rca tab redirects here.',
    ],
  },
]

export default function WikiIncidentInvestigationPage() {
  return (
    <WikiPage
      title="Incident Investigation & Root Cause"
      subtitle="Run a guided, AI-assisted root cause analysis and turn findings into tracked corrective actions."
      modulePath="/incidents"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',   label: 'What it\'s for' },
        { id: 'start',      label: 'Start an investigation' },
        { id: 'fivewhys',   label: 'Using the 5 Whys' },
        { id: 'guardrail',  label: 'The anti-blame guardrail' },
        { id: 'ai',         label: 'AI assist (human-approved)' },
        { id: 'actions',    label: 'Roots → corrective actions' },
        { id: 'methods',    label: 'Other RCA methods' },
        { id: 'complete',   label: 'Sign off & publish' },
        { id: 'faq',        label: 'FAQ' },
        { id: 'dodonts',    label: 'Do\'s & Don\'ts' },
        { id: 'related',    label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          When an incident or serious near-miss needs more than a status change, you open
          an <strong>investigation</strong>: a structured way to work out <em>why</em> it
          happened and what to change so it does not happen again. The investigation lives
          on the <strong>Investigate &amp; RCA</strong> tab of any incident.
        </p>
        <p>
          The centrepiece is a rebuilt <strong>5 Whys</strong> tool. Each &quot;why&quot;
          digs into the answer above it, you can record more than one root cause (real
          incidents usually have several), and the tool actively steers you away from
          stopping at &quot;human error&quot;. An optional AI co-pilot suggests the next
          question and drafts findings &mdash; but a person always approves before anything
          is saved.
        </p>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <strong>5 Whys is now retired.</strong> Existing 5 Whys investigations stay visible
          read-only; new investigations use Fishbone, TapRooT, or ICAM, or the new{' '}
          <a href="/wiki/ecfa">Events &amp; Causal Factors Analysis</a> — which supersedes 5 Whys
          for finding and acting on causal factors.
        </p>
      </Section>

      <Section id="start" title="Start an investigation">
        <ul>
          <li>Open the incident and choose the <strong>Investigate &amp; RCA</strong> tab.</li>
          <li>Click <strong>Begin investigation</strong>. Pick a root-cause method now, or
            choose <em>Start without picking a method</em> and decide later &mdash; starting
            the investigation moves the incident to <strong>Investigating</strong>.</li>
          <li>Fill the <strong>Scope</strong> and <strong>Sequence of events</strong> as you
            learn them. <strong>Save draft</strong> as often as you like; nothing is locked
            until you sign off.</li>
        </ul>
        <p>
          Any tenant admin/owner, the lead investigator, or a named team member can edit an
          investigation.
        </p>
      </Section>

      <Section id="fivewhys" title="Using the 5 Whys">
        <p>The 5 Whys board reads top-to-bottom as a connected chain:</p>
        <ul>
          <li><strong>State the problem.</strong> The first entry answers
            &quot;What happened?&quot; &mdash; the event you are explaining.</li>
          <li><strong>Ask why.</strong> Under any entry, click <strong>Ask why</strong>. The
            prompt is written for you and echoes the answer it interrogates &mdash; e.g.
            <em> Why did &quot;the guard was removed&quot; happen?</em> &mdash; so the chain
            actually chains.</li>
          <li><strong>Branch when reality branches.</strong> If an answer has two causes, ask
            &quot;why&quot; twice under the same entry. Children are indented under their
            parent so the structure stays readable.</li>
          <li><strong>Mark every root.</strong> When an answer names something the
            organisation can change, click <strong>Mark root</strong>. You can mark
            <em> several</em> roots &mdash; marking one no longer clears the others.</li>
          <li><strong>Edit or remove</strong> any entry in place; the chain re-numbers and
            re-threads automatically.</li>
        </ul>
        <p>
          A good root cause is a <em>condition the organisation owns</em> (a missing
          interlock, a procedure that cannot be followed as written, a staffing or
          time-pressure gap) &mdash; not a person&apos;s behaviour.
        </p>
      </Section>

      <Section id="guardrail" title="The anti-blame guardrail">
        <p>
          As you type, the tool watches for answers that stop at a symptom or blame a
          person &mdash; &quot;human error&quot;, &quot;careless&quot;, &quot;wasn&apos;t
          paying attention&quot;, &quot;retrain the worker&quot;, &quot;didn&apos;t follow
          the procedure&quot;. When it spots one it shows a short amber nudge suggesting how
          to dig deeper.
        </p>
        <p>
          The nudge is <strong>advisory only</strong> &mdash; it never blocks you from
          saving. It runs instantly in your browser, so it works even when the AI assistant
          is unavailable. This reflects modern safety practice (Human &amp; Organizational
          Performance / Just Culture): people do not come to work to fail, so the useful
          question is what made the error likely, not who made it.
        </p>
      </Section>

      <Section id="ai" title="AI assist (human-approved)">
        <p>
          Admins see two AI buttons. Both return suggestions you can edit; <strong>nothing
          is written to the investigation until you accept it</strong>, and accepted AI text
          is badged so the record stays honest.
        </p>
        <ul>
          <li><strong>Suggest next why.</strong> Inside an &quot;Ask why&quot; form, this
            proposes a plausible, systemic next answer based on the chain and the incident.
            Edit it freely before adding &mdash; if you change it, it is marked
            <em> AI &middot; edited</em>.</li>
          <li><strong>Draft root cause &amp; actions.</strong> From the whole chain, this
            proposes one systemic root-cause statement plus one to three corrective actions.
            Review the panel, then <strong>Add as root cause</strong> and
            <strong> Create action</strong> for the ones you want.</li>
        </ul>
        <p>
          The assistant is coached to avoid person-blame and to prefer stronger controls
          (elimination/engineering over PPE). It reads the analysis fresh on the server each
          time, never edits your incident on its own, and is rate- and budget-limited like
          every other AI feature. If your tenant has AI turned off, the board works exactly
          the same way without the suggestion buttons.
        </p>
      </Section>

      <Section id="actions" title="Turn roots into corrective actions">
        <p>
          A root cause that does not drive a change is wasted work. Two affordances close the
          loop without retyping:
        </p>
        <ul>
          <li><strong>Create action.</strong> On any root, click <strong>Create action</strong>
            to open a corrective action (CAPA) pre-filled from the root-cause text and linked
            back to it. Set an owner, due date, and the strongest workable control on the
            <Link href="/incidents"> Actions</Link> tab.</li>
          <li><strong>Pull from RCA.</strong> On the <strong>Root causes</strong> narrative
            field, click <strong>Pull from RCA</strong> to drop your identified roots straight
            into the write-up &mdash; the old copy-paste step is gone.</li>
        </ul>
      </Section>

      <Section id="methods" title="Other RCA methods">
        <p>
          Switch methods any time from the method selector; your work in other methods is
          kept, not deleted. Use the heavier methods for serious or systemic events:
        </p>
        <ul>
          <li><strong>Fishbone (Ishikawa)</strong> &mdash; bucket causes into six categories
            (people, process, equipment, environment, materials, management) to surface blind
            spots.</li>
          <li><strong>TapRooT</strong> &mdash; build a causal-factor tree from event to root
            to generic cause for serious or systemic incidents.</li>
          <li><strong>ICAM</strong> &mdash; layer causes from absent/failed defences through
            individual/team actions to task and organisational factors (common in mining and
            aviation).</li>
        </ul>
        <p>All methods support multiple identified roots.</p>
      </Section>

      <Section id="complete" title="Sign off & publish the lesson">
        <ul>
          <li>You can complete an investigation once the analysis has at least one entry and
            at least one identified root.</li>
          <li>Type your name under <strong>Sign off</strong> and click
            <strong> Complete investigation</strong>. This stamps the sign-off and moves the
            incident to <strong>Pending review</strong>; the investigation becomes read-only.</li>
          <li>Optionally publish a short, anonymised <strong>lesson</strong> so other teams
            can learn from the case &mdash; it appears in the lessons-learned library.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Can I record more than one root cause?',
            a: <>Yes. Mark as many entries as root as the evidence supports &mdash; marking a
              new one no longer clears the others. Most real incidents have several
              contributing roots.</>,
          },
          {
            q: 'Does the AI change my incident or pick the root cause for me?',
            a: <>No. Every AI button returns a suggestion you edit and explicitly accept.
              The route never writes RCA entries, never sets a root, and never edits the
              incident. Accepted AI text is badged, and edits to it are recorded.</>,
          },
          {
            q: 'Why is the tool warning me about my answer?',
            a: <>The guardrail flags symptom-level or person-blaming answers (like
              &quot;human error&quot; or &quot;retrain the worker&quot;) and suggests digging
              deeper. It is advice, not a block &mdash; you can still save the answer.</>,
          },
          {
            q: 'What happened to the separate RCA tab?',
            a: <>It is now part of the Investigate &amp; RCA tab so findings flow straight into
              the write-up and into corrective actions. The old <code>/rca</code> link still
              works &mdash; it redirects here.</>,
          },
          {
            q: 'Can I switch RCA methods after I start?',
            a: <>Yes, any time. Switching keeps the work you did in the other methods; the
              board just shows the active one.</>,
          },
          {
            q: 'Why can\'t I complete the investigation yet?',
            a: <>Completion needs a method picked, at least one analysis entry, and at least
              one entry marked as a root cause. The sign-off panel tells you which is
              missing.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Write the problem statement as a fact, then let each "why" interrogate the answer above it.',
            'Mark every systemic root you find — controls follow from roots, and there is usually more than one.',
            'Use "Create action" on each root so the analysis ends in a tracked, owned corrective action.',
            'Treat AI suggestions as a first draft: read, edit, and accept only what fits the evidence.',
          ]}
          donts={[
            'Don\'t stop at "human error", "careless", or "didn\'t follow the procedure" — those are starting points, not root causes.',
            'Don\'t default to "retrain the worker" before you\'ve found the systemic gap.',
            'Don\'t accept an AI draft you can\'t defend from the facts — you own the sign-off.',
            'Don\'t sign off until each identified root has a corrective action behind it.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/near-miss',           label: 'Near-Miss Reporting' },
          { href: '/wiki/integrity-compliance', label: 'CAPA & ISO 45001 Evidence' },
          { href: '/wiki/risk',                label: 'Risk Assessment' },
          { href: '/wiki/scorecard',           label: 'EHS Scorecard' },
        ]} />
      </Section>
    </WikiPage>
  )
}
