import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-06-19'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-06-19', changes: ['Initial Hazard Hunt module page.'] },
]

// The OSHA 1910 + Cal/OSHA Title 8 general-industry coverage the starter
// library ships with. Colocated with the prose (not imported from
// @soteria/core) so this wiki page stays a pure RSC with no data-layer
// coupling, and so an editor can adjust the write-up without touching seed
// data. The D/W/M column states which cadence checklist includes each section.
const COVERAGE: {
  section:   string
  category:  string
  cadences:  string
  citation:  string
}[] = [
  { section: 'Walking-working surfaces & housekeeping', category: 'Physical',      cadences: 'D · W · M', citation: '29 CFR 1910.22; T8 §3273, §3380' },
  { section: 'Means of egress & exit routes',            category: 'Physical',      cadences: 'D · W · M', citation: '29 CFR 1910.36-.37; T8 §3215-§3220' },
  { section: 'Emergency action / fire prevention',       category: 'Physical',      cadences: 'M',         citation: '29 CFR 1910.38-.39; T8 §3220-§3221' },
  { section: 'Fire protection (extinguishers/sprinklers)', category: 'Physical',    cadences: 'W · M',     citation: '29 CFR 1910.157; T8 §6151' },
  { section: 'Electrical safety & wiring',                category: 'Electrical',    cadences: 'W · M',     citation: '29 CFR 1910.303-.305; T8 §2340, §2395' },
  { section: 'Machine guarding & point-of-operation',    category: 'Mechanical',    cadences: 'W · M',     citation: '29 CFR 1910.212/.219; T8 §4002-§4070' },
  { section: 'Control of hazardous energy (LOTO)',        category: 'Mechanical',    cadences: 'W · M',     citation: '29 CFR 1910.147; T8 §3314' },
  { section: 'Hand & portable powered tools',             category: 'Mechanical',    cadences: 'D · W',     citation: '29 CFR 1910.242; T8 §3556' },
  { section: 'Personal protective equipment',             category: 'Physical',      cadences: 'D · W · M', citation: '29 CFR 1910.132-.138; T8 §3380-§3400' },
  { section: 'Hazard Communication (labels/SDS)',         category: 'Chemical',      cadences: 'W · M',     citation: '29 CFR 1910.1200; T8 §5194' },
  { section: 'Flammable/combustible liquid storage',      category: 'Chemical',      cadences: 'W · M',     citation: '29 CFR 1910.106; T8 §5417' },
  { section: 'Compressed gas cylinders',                  category: 'Chemical',      cadences: 'W · M',     citation: '29 CFR 1910.101; T8 §4649-§4651' },
  { section: 'Respiratory protection program',            category: 'Chemical',      cadences: 'M',         citation: '29 CFR 1910.134; T8 §5144' },
  { section: 'Bloodborne pathogens / sanitation',         category: 'Biological',    cadences: 'M',         citation: '29 CFR 1910.1030, 1910.141; T8 §5193, §3362' },
  { section: 'Ergonomics / manual material handling',     category: 'Ergonomic',     cadences: 'W · M',     citation: 'Gen Duty 5(a)(1); T8 §5110' },
  { section: 'Powered industrial trucks (forklifts)',     category: 'Mechanical',    cadences: 'D · W',     citation: '29 CFR 1910.178; T8 §3650, §3664' },
  { section: 'Fall protection / working at heights',      category: 'Physical',      cadences: 'W · M',     citation: '29 CFR 1910.28; T8 §3210' },
  { section: 'Confined spaces (signage/permits)',         category: 'Environmental', cadences: 'M',         citation: '29 CFR 1910.146; T8 §5157' },
  { section: 'Ventilation / indoor air & heat illness',   category: 'Environmental', cadences: 'D (heat) · M', citation: '29 CFR 1910.94; T8 §5142, §3395' },
  { section: 'Noise / hearing conservation',              category: 'Physical',      cadences: 'M',         citation: '29 CFR 1910.95; T8 §5095-§5100' },
  { section: 'Ionizing/non-ionizing radiation',           category: 'Radiological',  cadences: 'M',         citation: '29 CFR 1910.1096; T8 §5075-§5085' },
  { section: 'Workplace violence / psychosocial',         category: 'Psychosocial',  cadences: 'M',         citation: '5(a)(1); T8 §3342 (WVPP, CA SB 553)' },
  { section: 'First aid & medical',                       category: 'Physical',      cadences: 'M',         citation: '29 CFR 1910.151; T8 §3400' },
]

export default function WikiHazardHuntPage() {
  return (
    <WikiPage
      title="Hazard Hunt"
      subtitle="Recurring OSHA / Cal-OSHA workplace inspections — the cheapest leading indicator you have. Walk the floor on a cadence, turn findings into actions, and feed the risk register."
      modulePath="/hazard-hunt"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',  label: 'What it\'s for' },
        { id: 'cadences',  label: 'Cadences' },
        { id: 'coverage',  label: 'OSHA / Cal-OSHA coverage' },
        { id: 'findings',  label: 'From finding to risk' },
        { id: 'score',     label: 'How it feeds the EHS score' },
        { id: 'agents',    label: 'The agents' },
        { id: 'faq',       label: 'FAQ' },
        { id: 'dodonts',   label: 'Do\'s & Don\'ts' },
        { id: 'related',   label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          A <strong>Hazard Hunt</strong> is a recurring, structured walk of your
          workplace against a checklist of OSHA and Cal/OSHA general-industry
          hazards. It is built on the generic inspection engine, but ships with a
          CSP-curated starter library so you are inspecting the right things from
          day one.
        </p>
        <p>
          It is the cheapest <em>leading</em> indicator in the whole program.
          Recordable injuries, lost-time rates, and CAPA backlogs are all
          <em> lagging</em> — they tell you what already went wrong. A hazard hunt
          finds the unguarded nip point, the blocked exit, and the ungrounded
          cord <em>before</em> they become an incident, for the price of a few
          minutes of walking. Done on cadence, it converts safety from
          reactive cleanup into proactive prevention.
        </p>
      </Section>

      <Section id="cadences" title="Cadences">
        <p>
          Three cadences nest from a fast daily sweep to a deep monthly review.
          Each ships as its own checklist template (category
          <code> hazard_hunt</code>) that an admin can customize after seeding.
        </p>
        <ul>
          <li>
            <strong>Daily</strong> — a lean walk-the-floor sweep of the hazards
            that change shift-to-shift: housekeeping, egress, PPE, hand and
            powered tools, forklift operations, and heat illness. Built to run in
            minutes so it actually happens every day (~14 items).
          </li>
          <li>
            <strong>Weekly</strong> — condition-based checks of equipment,
            electrical, and chemical hazards that drift over days: machine
            guarding, lockout/tagout, wiring and panels, fire protection, HazCom
            labeling, flammable storage, compressed gas, and fall protection
            (~27 items).
          </li>
          <li>
            <strong>Monthly</strong> — a program-level governance review plus the
            lower-frequency hazards: emergency action and fire prevention plans,
            respiratory / hearing / radiation programs, confined spaces,
            workplace-violence prevention, sanitation, and first-aid readiness
            (~36 items).
          </li>
        </ul>
        <p>
          Cadences are scheduled by calendar day (UTC) with a weekly weekday
          anchor or a monthly day-of-month anchor, and a generator keeps runs
          idempotent so a missed cron tick never double-creates a hunt.
        </p>
      </Section>

      <Section id="coverage" title="The OSHA / Cal-OSHA coverage">
        <p>
          The starter library maps to a comprehensive general-industry hazard
          taxonomy. Each row below is one checklist section, the hazard category
          it carries, the cadences that include it (<strong>D</strong>aily /
          <strong> W</strong>eekly / <strong>M</strong>onthly), and its federal +
          California citation. This is what makes the hunt a genuine
          <em> comprehensive</em> inspection rather than a generic walkthrough.
        </p>
        <div className="not-prose mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-900/40 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <th className="px-3 py-2 font-semibold">Section</th>
                <th className="px-3 py-2 font-semibold">Category</th>
                <th className="px-3 py-2 font-semibold whitespace-nowrap">Cadence</th>
                <th className="px-3 py-2 font-semibold">Citation</th>
              </tr>
            </thead>
            <tbody>
              {COVERAGE.map(row => (
                <tr key={row.section} className="border-t border-slate-200 dark:border-slate-800 align-top">
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-100">{row.section}</td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{row.category}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500 dark:text-slate-400">{row.cadences}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{row.citation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Citations are starting references, not legal advice. Confirm the
          standards and thresholds that apply to your operation and jurisdiction;
          the library is editable so you can tighten, add, or remove items.
        </p>
      </Section>

      <Section id="findings" title="From finding to risk">
        <p>
          Every checklist item is phrased so that <strong>PASS = the safe,
          compliant condition</strong>. A failed item is therefore an unsafe
          condition. High-consequence items (egress, LOTO, machine guarding,
          electrical, falls, forklifts, fire, confined space) are flagged
          <em> fail → action</em>, so failing one automatically opens a
          corrective action — the inspector never has to remember to.
        </p>
        <p>
          A finding carries one of the nine shared hazard categories — the same
          taxonomy used by the risk register, JHA, and near-miss modules
          (physical, chemical, biological, mechanical, electrical, ergonomic,
          psychosocial, environmental, radiological). Because the category is
          shared, a finding can be <strong>escalated into the risk register with
          its category unchanged</strong>: its severity hint (low / moderate /
          high / extreme) maps to an inherent severity, and the risk is then
          driven down through the <strong>hierarchy of controls</strong> —
          elimination, substitution, engineering controls, administrative
          controls, and PPE, in that order of preference.
        </p>
        <p>
          A finding is considered resolved once it is either closed out
          (corrected and verified) or promoted into the risk register for managed,
          longer-term treatment.
        </p>
      </Section>

      <Section id="score" title="How it feeds the EHS score">
        <p>
          Hazard hunts power a leading-indicator signal,
          <code> hazard_hunt_proactive</code>, that lowers (improves) your EHS
          score on two behaviors:
        </p>
        <ul>
          <li>
            <strong>Running on cadence</strong> — adherence is the ratio of
            completed runs to the runs that were due. Walking the floor when you
            said you would is itself the proactive signal.
          </li>
          <li>
            <strong>Closing findings</strong> — surfacing a hazard and then
            actually correcting or escalating it is what turns the inspection into
            risk reduction. Open, aging findings blunt the signal.
          </li>
        </ul>
        <p>
          Because it rewards <em>finding and fixing</em> rather than the absence
          of reports, the indicator resists the perverse incentive of under-
          reporting that pure lagging metrics create: a site that hunts diligently
          and closes what it finds scores well even in a busy month.
        </p>
      </Section>

      <Section id="agents" title="The agents">
        <p>
          Two assistants support the module without taking the inspector out of
          the loop:
        </p>
        <ul>
          <li>
            <strong>CSP write-up agent</strong> — an in-app Certified Safety
            Professional assistant that drafts clear, citation-backed finding
            descriptions and suggested corrective actions from the failed item, so
            a field user is not left staring at a blank text box. The human reviews
            and owns the wording.
          </li>
          <li>
            <strong>DS analytics agent</strong> — a data-science assistant that
            looks across hunts for trends: repeat findings, sections that fail most
            often, categories drifting over time, and cadence slippage — turning a
            stack of checklists into a prioritized list of where to act.
          </li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Can I customize the starter checklists?',
            a: <>Yes — that&apos;s the point. The library seeds three editable
              inspection templates (daily, weekly, monthly). After seeding they are
              ordinary templates you can reweight, rephrase, add to, or prune under
              <strong> Admin → Inspections</strong>. Re-seeding does not overwrite
              your edits.</>,
          },
          {
            q: 'What\'s the difference between a Hazard Hunt and a regular inspection?',
            a: <>A Hazard Hunt <em>is</em> an inspection, run on the generic engine.
              What it adds is the recurring cadence, the CSP-curated OSHA/Cal-OSHA
              starter content, hazard-categorized findings, and the escalation path
              into the risk register.</>,
          },
          {
            q: 'When does a failed item become a corrective action automatically?',
            a: <>When the item is flagged <em>fail → action</em>. The starter
              library sets this on the life-safety items (egress, LOTO, machine
              guarding, electrical, falls, forklifts, fire, confined space) so the
              highest-consequence failures are never lost.</>,
          },
          {
            q: 'Why does running hunts improve my EHS score even with no incidents?',
            a: <>Because <code>hazard_hunt_proactive</code> is a leading indicator.
              It credits on-cadence hunts and closed findings — the proactive work
              that prevents incidents — rather than waiting for a lagging metric to
              get worse.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Run the daily hunt every shift — its value is in the cadence, not the length.',
            'Tune the weight and "fail → action" flag on items that match your real life-safety hazards.',
            'Close or escalate findings promptly; an open finding is a hazard you have only documented, not removed.',
            'Drive escalated findings down the hierarchy of controls, preferring elimination over PPE.',
          ]}
          donts={[
            'Don\'t treat the starter citations as legal advice — confirm the standards that apply to your site.',
            'Don\'t let the checklist replace judgment; record anything unsafe in the free-text item even if no line covers it.',
            'Don\'t bloat the daily list — push lower-frequency and program-level checks to weekly or monthly.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/inspections',  label: 'Inspections' },
          { href: '/wiki/risk',         label: 'Risk Assessment' },
          { href: '/wiki/jha',          label: 'Job Hazard Analysis' },
          { href: '/wiki/near-miss',    label: 'Near Miss' },
          { href: '/wiki/scorecard',    label: 'EHS Scorecard' },
        ]} />
      </Section>
    </WikiPage>
  )
}
