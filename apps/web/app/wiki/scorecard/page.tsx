import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.11.0'
const LAST_UPDATED    = '2026-06-15'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.11.0',
    date:    '2026-06-15',
    changes: [
      'Predictive section — “where things are going”: a forecast of next ' +
      'month’s recordable count (EWMA + a reliability-gated linear trend) with ' +
      'a Poisson 95% prediction interval, plus an improving/worsening/flat ' +
      'trend read. The number is deterministic, never an AI guess.',
      'Statistically honest distributions: recordables are shown as a c-chart ' +
      '(control chart with mean and ±3σ limits) and a Poisson fit — the right ' +
      'view for rare counts — rather than a bell curve, which would imply ' +
      'impossible negative counts. Views suppress themselves when there is too ' +
      'little data to be honest (e.g. < 8 months for a distribution).',
    ],
  },
  {
    version: '1.10.0',
    date:    '2026-06-15',
    changes: [
      'Tap-to-drill: every KPI card and risk driver opens a detail sheet with ' +
      'the metric’s definition, its live formula, supporting stats, and a ' +
      'plain-language explanation of what it means and where to act — the ' +
      'interactive replacement for a separate “simple metrics” view.',
      'Predicted-risk gauge + leading-vs-lagging panel: the 0–100 score now ' +
      'reads as a graphical gauge, and the drivers are split into leading ' +
      '(preventive) and lagging (outcome) indicators you can drill into.',
      'Comprehensive branded PDF: the “PDF” button now exports a multi-page ' +
      'report — executive summary, predicted risk + drivers, leading/lagging ' +
      'tables, a recordable & near-miss trend chart, reporting/investigation ' +
      'quality, and the LOTO program — with your tenant logo and brand mark. ' +
      'The risk score is recomputed server-side so the headline is authoritative.',
    ],
  },
  {
    version: '1.9.0',
    date:    '2026-05-24',
    changes: [
      'Goals: set a target for TRIR, DART, recordables, CAPA on-time %, and ' +
      'RCA completion % right on the board (Edit goals). The TRIR goal draws ' +
      'a line on the year-over-year chart, and each metric shows a ' +
      'progress-to-goal chip.',
      'Industry benchmark: your TRIR / DART now sit against the BLS average ' +
      'for your establishment’s NAICS sector, overlaid on the ' +
      'year-over-year chart. Override the built-in BLS default with your own ' +
      'peer figure if you have one.',
    ],
  },
  {
    version: '1.8.0',
    date:    '2026-05-24',
    changes: [
      'Leading + investigation-quality strip: severity rate, CAPA on-time %, ' +
      'RCA completion %, and mean time-to-close now sit alongside TRIR / DART / ' +
      'LTIR on the board.',
      'Injury breakdowns: a "how people are getting hurt" nature-of-injury ' +
      'chart now sits beside the "where" body-part chart, plus a shift × ' +
      'weekday heatmap showing when incidents cluster.',
    ],
  },
  {
    version: '1.7.1',
    date:    '2026-05-24',
    changes: [
      'Reworded the scorecard subtitle to reflect what it now leads with — ' +
      'recordable trend, TRIR/DART, predicted risk, and year-over-year ' +
      'performance — rather than only permits/atmospheric/equipment.',
    ],
  },
  {
    version: '1.7.0',
    date:    '2026-05-24',
    changes: [
      'Year-over-year trend: a TRIR + recordables chart spanning up to 20 ' +
      'years, built from saved OSHA 300A annual summaries (imported prior-year ' +
      'data) blended with the live current calendar year. Phase 1 of the ' +
      'historical-import feature.',
    ],
  },
  {
    version: '1.6.0',
    date:    '2026-05-24',
    changes: [
      'Click-through drill-downs: every scorecard tile now links to the ' +
      'module behind it — the injury/OSHA headline cards open Incidents and ' +
      'the OSHA 300 log, the trend + body-part charts open Incidents, and the ' +
      'permit/atmospheric/photo tiles open Confined Spaces and Equipment ' +
      'Readiness.',
    ],
  },
  {
    version: '1.5.0',
    date:    '2026-05-24',
    changes: [
      'Injury & OSHA recordkeeping section now leads the scorecard: days ' +
      'since last recordable, TRIR / DART / LTIR, the OSHA 300A recordkeeping ' +
      'roll-up (days-away / restricted / other recordable), this-week-vs-last ' +
      'movement, a recordable + near-miss monthly trend, and a "where people ' +
      'are getting hurt" body-part chart — all trailing 12 months. The ' +
      'permit / atmospheric / LOTO tiles move below it.',
    ],
  },
  {
    version: '1.4.0',
    date:    '2026-05-24',
    changes: [
      'Interactive infographics: the metric tiles are keyboard-focusable, and ' +
      'hovering (or focusing) the gauges, the permit-cycle timeline, and the ' +
      'atmospheric sensor stack reveals the exact value behind the shape.',
    ],
  },
  {
    version: '1.3.0',
    date:    '2026-05-24',
    changes: [
      'Preview email: a "Preview email" button renders the weekly weather ' +
      'report exactly as it will send (week-over-week movement, TRIR/DART, and ' +
      'the predicted incident-risk score) in a new tab, so you can see it ' +
      'before it goes out Monday.',
    ],
  },
  {
    version: '1.2.0',
    date:    '2026-05-24',
    changes: [
      'Predicted incident risk: a data-driven 0–100 score + band at the top ' +
      'of the scorecard, with a ranked "where to work to lower it" list of ' +
      'drivers (overdue CAPAs, near-miss reporting, open high risks, expiring ' +
      'training, etc.) that deep-link to the module where the work happens. ' +
      'The score is deterministic — computed from your leading/lagging ' +
      'indicators, not an AI opinion — and also appears in the weekly email.',
    ],
  },
  {
    version: '1.1.0',
    date:    '2026-05-23',
    changes: [
      'Presentation mode: a "Present" button puts the scorecard fullscreen ' +
      'with page chrome hidden for live leadership reviews; Esc restores it.',
      'Branded PDF export: a "PDF" button downloads a one-page report with ' +
      'your tenant logo in the header.',
      'Weekly weather report: an automated Monday email to owners/admins ' +
      'with week-over-week movement on key indicators plus TRIR/DART to date.',
    ],
  },
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial scorecard wiki page.'] },
]

export default function WikiScorecardPage() {
  return (
    <WikiPage
      title="EHS Scorecard"
      subtitle="Strategic KPI dashboard with selectable time windows."
      modulePath="/admin/insights/scorecard"
      audience="admin"
      category="Reports"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview', label: 'What it\'s for' },
        { id: 'metrics',  label: 'What it measures' },
        { id: 'sharing',  label: 'Present, export & email' },
        { id: 'predict',  label: 'Predicted incident risk' },
        { id: 'faq',      label: 'FAQ' },
        { id: 'dodonts',  label: 'Do\'s & Don\'ts' },
        { id: 'related',  label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The home dashboard answers &quot;what&apos;s happening right now?&quot;
          The scorecard answers &quot;how are we trending?&quot; — chartable
          KPIs over a selectable 7d / 30d / 90d window, intended for the
          weekly EHS director&apos;s review and monthly leadership reports.
        </p>
      </Section>

      <Section id="metrics" title="What it measures">
        <p>
          The scorecard leads with the injury &amp; OSHA recordkeeping picture
          (trailing 12 months), then drops into the permit / atmospheric /
          equipment program metrics for the selected window.
        </p>
        <ul>
          <li>OSHA rates — TRIR, DART, LTIR, and severity rate (days × 200K / hours)</li>
          <li>Leading + investigation quality — CAPA on-time %, RCA completion %, mean time-to-close</li>
          <li>Days since last recordable, this-week-vs-last movement, recordable + near-miss trend</li>
          <li>Where &amp; how people are getting hurt — body-part and nature-of-injury breakdowns</li>
          <li>When incidents cluster — a shift × weekday heatmap</li>
          <li>Goals vs. actuals + your TRIR/DART vs. the BLS industry benchmark for your sector</li>
          <li>Predictive — next-month recordable forecast (Poisson interval) plus a c-chart and Poisson distribution of monthly counts</li>
          <li>Confined-space permits issued, completed, expired, canceled</li>
          <li>Atmospheric-test failures and the spaces that drove them</li>
          <li>LOTO photo-completion percentage trend</li>
        </ul>
      </Section>

      <Section id="sharing" title="Present, export & email">
        <p>
          Three ways to get the scorecard in front of people who aren&apos;t
          looking at the screen:
        </p>
        <ul>
          <li><strong>Present.</strong> The &quot;Present&quot; button drops the
            page into fullscreen with the back-link and surrounding chrome
            hidden — clean enough to project in a leadership review. Press
            Esc (or &quot;Exit&quot;) to return to the normal layout.</li>
          <li><strong>PDF.</strong> The &quot;PDF&quot; button downloads a
            comprehensive, multi-page report — executive summary, predicted
            risk and its drivers, leading vs lagging indicators, a recordable
            &amp; near-miss trend chart, reporting/investigation quality, and the
            permit/LOTO program — with your tenant logo and brand mark in the
            header. The risk score is recomputed server-side so the board-pack
            headline is authoritative. Set the logo under tenant settings if the
            header looks empty.</li>
          <li><strong>Weekly weather report.</strong> Every Monday, owners and
            admins get an automated email summarizing week-over-week movement
            on the key leading and lagging indicators (recordables, near-miss
            reports, corrective actions closed) plus TRIR and DART to date — a
            30-second read of which way the program moved.</li>
        </ul>
      </Section>

      <Section id="predict" title="Predicted incident risk">
        <p>
          The card at the top of the scorecard turns your leading and lagging
          indicators into a single <strong>0–100 risk score</strong> and a band
          (low / moderate / high / extreme). It&apos;s <strong>data-driven and
          deterministic</strong> — computed from real signals like overdue
          corrective actions, near-miss reporting rate, BBS safe-to-unsafe
          ratio, open high/extreme risks, expiring training, and recent
          recordable trend. It is <em>not</em> an AI guess, so the same data
          always produces the same number.
        </p>
        <p>
          The score reads as a graphical <strong>gauge</strong>, and below it a
          ranked <strong>&quot;where to work to lower it&quot;</strong> list
          shows the specific drivers pushing the score up. A separate
          <strong> leading vs lagging</strong> panel splits those drivers into
          preventive signals (near-miss reporting, BBS ratio, overdue actions,
          expiring training) and outcomes (recordable trend). Tap any driver —
          or any KPI card on the board — to open a detail sheet with its
          definition, live formula, and where to act. Work the top driver
          first; it&apos;s contributing the most points. The same score and top
          focus area are included in the weekly weather-report email.
        </p>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why is this admin-only?',
            a: <>The scorecard rolls up tenant-wide data the typical
              technician shouldn&apos;t need (and shouldn&apos;t be measured
              against publicly). Admins and the EHS director get the
              strategic view; the operational data is on the home dashboard.</>,
          },
          {
            q: 'How fresh is the data?',
            a: <>The chart pulls live from Postgres on each render — there&apos;s
              no caching layer. If you don&apos;t see a permit you just signed,
              refresh the page.</>,
          },
          {
            q: 'Can I export the scorecard?',
            a: <>Yes — the &quot;PDF&quot; button produces a branded,
              comprehensive multi-page report for the current window (see{' '}
              <Link href="#sharing">Present, export &amp; email</Link>). For the
              raw underlying rows, use the{' '}
              <Link href="/admin/compliance/compliance-bundle">compliance bundle</Link>{' '}
              for a permanent dated export, or pull straight from the Supabase
              dashboard.</>,
          },
          {
            q: 'Why does the trend shift when I change the window?',
            a: <>The bars are sized to the selected window&apos;s peak so the
              shape is readable at any scale. Switch back to 30d if you&apos;re
              comparing trends across reviews.</>,
          },
          {
            q: 'Can I see one department only?',
            a: <>Not from the scorecard — it&apos;s a tenant-wide view by
              design. Use the per-module filters
              (<Link href="/risk/list">/risk/list</Link>,{' '}
              <Link href="/near-miss">/near-miss</Link>) for departmental
              cuts.</>,
          },
          {
            q: 'My tenant doesn\'t use one of the modules — does it still show?',
            a: <>The tile collapses to a &quot;no data&quot; placeholder so you
              don&apos;t mistake an empty module for zero activity.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Walk through the scorecard at the same cadence each week so trend reads stay comparable.',
            'Pair scorecard trends with the Risk Intelligence module to find the drivers behind the numbers.',
            'Screenshot the 30d view at month-end for the leadership pack — it\'s the cleanest comparison view.',
            'Check the scorecard before issuing tenant-wide changes; you\'ll spot regressions sooner.',
          ]}
          donts={[
            'Don\'t use scorecard numbers in incentive plans — gaming them undermines the data.',
            'Don\'t compare two tenants on this page; switch tenants to compare side-by-side.',
            'Don\'t take a single week\'s spike at face value — open the underlying module to confirm before raising it.',
            'Don\'t treat "zero permits" as healthy. Zero usually means under-reporting, not perfect safety.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/insights',          label: 'Risk Intelligence' },
          { href: '/wiki/compliance-bundle', label: 'Compliance Bundle' },
          { href: '/wiki/audit',             label: 'Audit Log' },
        ]} />
      </Section>
    </WikiPage>
  )
}
