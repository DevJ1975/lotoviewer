import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-07-14'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-07-14',
    changes: [
      'Added the Events & Causal Factors Analysis (ECFA) tool: a chronological ' +
      'event/condition timeline with verified-vs-presumptive evidence tracking ' +
      'and highlighted, coded causal factors.',
      'Each causal factor is coded (category · failed barrier · hierarchy of ' +
      'controls) and turns directly into a tracked corrective action.',
      'Added a human-approved AI co-pilot (draft the sequence from the narrative; ' +
      'suggest causal factors), an investigation-quality score, and causal-factor ' +
      'trends on the incident scorecard.',
      'The old 5 Whys method is retired: existing 5 Whys investigations stay ' +
      'read-only; new investigations use ECFA (and Fishbone / TapRooT / ICAM).',
    ],
  },
]

export default function WikiEcfaPage() {
  return (
    <WikiPage
      title="Events & Causal Factors Analysis (ECFA)"
      subtitle="Chart the story of an incident, separate fact from assumption, and turn each causal factor into a corrective action."
      modulePath="/incidents"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',  label: "What it's for" },
        { id: 'legend',    label: 'Reading the chart' },
        { id: 'build',     label: 'Build an ECFA, step by step' },
        { id: 'coding',    label: 'Coding a causal factor' },
        { id: 'ai',        label: 'AI co-pilot (human-approved)' },
        { id: 'quality',   label: 'Quality score & trends' },
        { id: 'faq',       label: 'FAQ' },
        { id: 'dodonts',   label: "Do's & Don'ts" },
        { id: 'related',   label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          An <strong>Events &amp; Causal Factors Analysis</strong> (ECFA) is the technique a
          safety professional reaches for first in a serious investigation. You lay out
          <em> what happened</em> as a chronological chain of <strong>events</strong>, attach the
          <strong> conditions</strong> that shaped each event, and end at the <strong>loss</strong>.
          Then you identify the <strong>causal factors</strong> — the events or conditions that, had
          they been different, would have prevented the incident or reduced how bad it was.
        </p>
        <p>
          ECFA runs <em>alongside</em> the root-cause tools, on its own <strong>Events &amp; Causal
          Factors</strong> tab of any incident. It is self-contained: once you flag and code a causal
          factor, you turn it straight into a tracked corrective action — no separate root-cause step
          is required.
        </p>
      </Section>

      <Section id="legend" title="Reading the chart">
        <p>The chart follows the standard ECFA shape legend, read left → right in time order:</p>
        <ul>
          <li><strong>Rectangle = Event.</strong> A discrete action or happening. One subject, one action verb (e.g. &quot;Operator opened the guard door&quot;).</li>
          <li><strong>Oval = Condition.</strong> A state or circumstance that shaped an event (e.g. &quot;Interlock was bypassed&quot;). It sits above or below the event it modifies.</li>
          <li><strong>Diamond = Loss / incident.</strong> The harm or damage that resulted — the end of the chain.</li>
          <li><strong>Dashed border = Presumptive.</strong> Not yet backed by evidence. <strong>Solid border = Verified.</strong> The visible gap between the two tells you what still needs proof.</li>
          <li><strong>★ / highlighted border = Causal factor.</strong> A coloured dot shows its systemic category.</li>
        </ul>
      </Section>

      <Section id="build" title="Build an ECFA, step by step">
        <ol>
          <li><strong>Begin the investigation</strong> on the incident (any tab). ECFA attaches to it.</li>
          <li><strong>Add the events</strong> in the order they happened. Keep each one factual and specific — one subject, one action verb.</li>
          <li><strong>Attach conditions</strong> to the events they shaped (above or below the line).</li>
          <li><strong>Mark what&apos;s verified.</strong> New items start <em>presumptive</em> (dashed). As evidence confirms them, mark them <em>verified</em> (solid). Resolve the presumptive items before you close.</li>
          <li><strong>Add the loss</strong> node — the injury, illness, spill, or damage.</li>
          <li><strong>Flag the causal factors</strong> — the handful of events/conditions that actually drove the outcome — and <a href="#coding">code</a> each one.</li>
          <li><strong>Create a corrective action</strong> from each causal factor. That closes the loop.</li>
          <li><em>Optional:</em> <strong>Pull sequence into narrative</strong> writes your ordered events into the investigation&apos;s Sequence-of-events field.</li>
        </ol>
      </Section>

      <Section id="coding" title="Coding a causal factor">
        <p>When you flag a causal factor, code it so it becomes trendable across incidents:</p>
        <ul>
          <li><strong>Category</strong> — the systemic layer it belongs to (absent/failed defences, individual/team actions, task/environmental conditions, or organisational factors). This is the same taxonomy as the ICAM method.</li>
          <li><strong>Failed / missing barrier</strong> — the control that should have caught it (e.g. &quot;machine guard interlock&quot;).</li>
          <li><strong>Control level</strong> — where your intended fix sits on the hierarchy of controls. Aim high: elimination and engineering beat administrative and PPE.</li>
        </ul>
        <p>These codes feed the <strong>Causal-factor trends</strong> panel on the incident scorecard, so recurring systemic weaknesses surface as a leading indicator.</p>
      </Section>

      <Section id="ai" title="AI co-pilot (human-approved)">
        <p>
          An optional Claude co-pilot speeds up the mechanical parts. It never writes to the chart on
          its own — every suggestion is a draft you accept item by item, and accepted items are badged
          <strong> AI</strong> (or <strong>AI · edited</strong> if you changed them).
        </p>
        <ul>
          <li><strong>Draft sequence</strong> reads the incident narrative and proposes an ordered set of events (with candidate conditions) and the loss.</li>
          <li><strong>Suggest causal factors</strong> looks at your chart and proposes which nodes are causal factors, with a category and a reason — plus a list of items still lacking evidence.</li>
        </ul>
        <p>The co-pilot is HOP / Safety-II aligned: it will not blame a person, and an inline guardrail flags &quot;human error&quot; / &quot;retrain the worker&quot; language as you type.</p>
      </Section>

      <Section id="quality" title="Quality score & trends">
        <p>
          The <strong>investigation quality</strong> score is an advisory rubric. It rewards a complete
          picture: at least two events plus a loss, causal factors that are flagged, coded, and each
          carrying a corrective action, and presumptive items resolved. It never blocks you — it just
          shows the gaps.
        </p>
        <p>
          Across incidents, the scorecard&apos;s <strong>Causal-factor trends</strong> panel rolls the
          coded factors up by category and by control level, so you can see whether your program is
          fixing root conditions with strong controls or leaning on weak ones.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          { q: 'Do I still use 5 Whys?',
            a: <>The 5 Whys method is retired. Existing 5 Whys investigations stay visible read-only; for new causal analysis use ECFA (or Fishbone / TapRooT / ICAM). ECFA supersedes 5 Whys for finding and acting on causal factors.</> },
          { q: 'What is the difference between a condition and an event?',
            a: <>An <strong>event</strong> is something that happened (an action). A <strong>condition</strong> is a state that was true (a circumstance). &quot;Operator reached into the machine&quot; is an event; &quot;the light curtain was disabled&quot; is a condition.</> },
          { q: 'When should something be verified vs presumptive?',
            a: <>Mark an item <strong>verified</strong> only when you have evidence — a photo, a record, a witness statement. Everything else stays <strong>presumptive</strong> so the chart honestly shows what is still assumption.</> },
          { q: 'How do causal factors become corrective actions?',
            a: <>Flag and code the causal factor, then click <strong>Create corrective action</strong>. It opens a CAPA on the Actions tab pre-filled from the factor (including your chosen control level), traced back to the node.</> },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Write each event as one subject + one action verb, in the past tense.',
            'Start items as presumptive and only mark verified once evidence backs them.',
            'Flag the few causal factors that truly drove the outcome — not every event.',
            'Give every causal factor a category and a corrective action before you close.',
            'Prefer higher-order controls (elimination, engineering) when coding the fix.',
          ]}
          donts={[
            "Don't stop at \"human error\" — push to the systemic condition behind it.",
            "Don't mark an assumption as verified just to make the chart look finished.",
            "Don't treat \"retrain the worker\" as a corrective action for a systemic cause.",
            "Don't flag a node as a causal factor without coding it — uncoded factors don't trend.",
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/incident-investigation', label: 'Incident Investigation & RCA' },
          { href: '/wiki/near-miss', label: 'Near-Miss Reporting' },
        ]} />
      </Section>
    </WikiPage>
  )
}
