import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.14.0'
const LAST_UPDATED    = '2026-07-14'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.14.0',
    date:    '2026-07-14',
    changes: [
      'Cross-module risk engine (model v2.0.0): the site-health score now also ' +
      'reads failing inspections, open BBS follow-ups, overdue JHA reviews, ' +
      'permits left open past expiry, competency-matrix training gaps, and ECFA ' +
      'causal factors on weak controls — each surfaced as a leading driver.',
      'New “Leading Indicator Signals” panel: shows which leading indicators ' +
      'historically precede your recordables and by how many months — presented ' +
      'as exploratory correlation, not proof of cause.',
      'Statistical honesty: OSHA rates now show confidence intervals (Poisson ' +
      'for rates, Wilson for RCA completion) so a rate built on a few events no ' +
      'longer reads as precise.',
    ],
  },
  {
    version: '1.13.1',
    date:    '2026-06-17',
    changes: [
      'Docs: expanded the usage guide — how to read the board and drill into ' +
      'any metric, how to read the distribution + forecast (c-chart / Poisson), ' +
      'how the “Where to focus” assistant works (including its deterministic ' +
      'fallback when AI is unavailable), and the multi-tab Excel / Google ' +
      'Sheets export.',
    ],
  },
  {
    version: '1.13.0',
    date:    '2026-06-15',
    changes: [
      'PDF parity: the branded PDF now includes the recordable distribution + ' +
      'next-month forecast (mean, median, spread, c-chart control limits, and ' +
      'the Poisson prediction interval) — the same numbers as the Excel ' +
      '“Distribution” tab, computed once and shared by both exports.',
      'Where to focus: the card now clearly flags when it is showing the ' +
      'deterministic top drivers because AI analysis was unavailable, so the ' +
      'fallback is never mistaken for an AI-written read. Screen readers now ' +
      'announce the results as they load.',
    ],
  },
  {
    version: '1.12.0',
    date:    '2026-06-15',
    changes: [
      'Where to focus: an on-demand AI card that reads your deterministic risk ' +
      'drivers + forecast and ranks, in plain language, where to work next to ' +
      'lower predicted risk — each item deep-links to the module. The risk score ' +
      'is always computed by the model, never the assistant; if AI is ' +
      'unavailable the card falls back to the top deterministic drivers.',
      'Excel export: the new “Excel” button downloads a multi-tab .xlsx ' +
      '(Summary, Leading, Lagging, Trends, Distribution, Targets, Risk drivers) ' +
      'that opens in Excel and imports cleanly into Google Sheets. The risk ' +
      'headline is recomputed server-side and every cell is guarded against ' +
      'spreadsheet formula injection.',
    ],
  },
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
      subtitle="Strategic BI board — drill-down KPIs, predictive analytics, an AI focus assistant, and branded PDF / Excel exports."
      modulePath="/admin/insights/scorecard"
      audience="admin"
      category="Reports"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',     label: 'What it\'s for' },
        { id: 'metrics',      label: 'What it measures' },
        { id: 'using',        label: 'How to read the board' },
        { id: 'distribution', label: 'Distributions & forecast' },
        { id: 'sharing',      label: 'Present, export & email' },
        { id: 'predict',      label: 'Predicted incident risk' },
        { id: 'focus',        label: 'Where to focus (AI)' },
        { id: 'faq',          label: 'FAQ' },
        { id: 'dodonts',      label: 'Do\'s & Don\'ts' },
        { id: 'related',      label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          The home dashboard answers &quot;what&apos;s happening right now?&quot;
          The scorecard answers &quot;how are we trending?&quot; — chartable
          KPIs over a selectable 7d / 30d / 90d window, intended for the
          weekly EHS director&apos;s review and monthly leadership reports.
        </p>
        <p>
          It&apos;s built to be read graphically and explored: the headline is a
          predicted-risk score, every KPI tile and risk driver is{' '}
          <strong>tap-to-drill</strong> (definition, live formula, and where to
          act), and on top of the deterministic numbers sit a next-month{' '}
          <em>forecast</em> and an on-demand AI{' '}
          <em>&quot;Where to focus&quot;</em> assistant. Export the whole picture
          to a branded PDF or a multi-tab Excel workbook.
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

      <Section id="using" title="How to read the board">
        <p>
          Start by picking a <strong>time window</strong> (7d / 30d / 90d) in the
          top bar. The OSHA recordkeeping picture is always trailing 12 months,
          but the permit, atmospheric, and equipment tiles follow the window you
          choose — stick to one (30d is the usual choice) so week-to-week reads
          stay comparable.
        </p>
        <p>
          The board is <strong>graphical-first and interactive</strong>: every
          KPI tile, gauge, and risk driver is <strong>tap-to-drill</strong>. Tap
          one (or focus it and press Enter) to open a <em>detail sheet</em> with
          the metric&apos;s plain-English definition, its <strong>live
          formula</strong> with your actual numbers plugged in, the supporting
          stats behind it, and a short &quot;what this means / where to act&quot;
          read that deep-links to the module where the work happens. This is the
          interactive replacement for a separate &quot;simple view&quot; — the
          depth is one tap away instead of behind a toggle.
        </p>
        <p>
          Below the predicted-risk gauge, the <strong>leading vs lagging</strong>
          panel splits the drivers into <em>preventive</em> signals you can still
          act on (near-miss reporting rate, BBS safe-to-unsafe ratio, overdue
          corrective actions, expiring training) and <em>lagging</em> outcomes
          that have already happened (recordable trend). Work the top driver
          first — it&apos;s contributing the most points to the score.
        </p>
      </Section>

      <Section id="distribution" title="Distributions & forecast (reading them right)">
        <p>
          Recordables are <strong>rare counts</strong>, so the scorecard does{' '}
          <em>not</em> draw them as a bell curve — a normal curve would imply
          impossible negative months and overstate the spread. Instead you get
          two honest views:
        </p>
        <ul>
          <li><strong>c-chart (control chart).</strong> Monthly counts plotted
            against a center line (the mean) and <strong>±3σ control
            limits</strong>. A point <em>above the upper limit (UCL)</em> is a
            real signal worth investigating — not normal variation. Points inside
            the band are ordinary month-to-month noise; resist reading a story
            into them.</li>
          <li><strong>Poisson distribution.</strong> The shape rare counts
            actually follow, with the mean (λ) marked — the right reference for
            &quot;is this month unusual?&quot;</li>
        </ul>
        <p>
          The <strong>next-month forecast</strong> projects the recordable count
          from your recent history (an EWMA level plus a linear trend that is only
          applied when the fit is reliable; otherwise it holds a flat run-rate and
          says so), with a <strong>95% Poisson prediction interval</strong> —
          read the band, not just the point. Both the chart and the forecast{' '}
          <strong>suppress themselves when there isn&apos;t enough data</strong>{' '}
          (a control chart needs at least two months; a forecast about six),
          showing an &quot;insufficient data&quot; note rather than a fabricated
          line. Every number here is <strong>deterministic</strong> and advisory —
          a planning aid, never a compliance prediction.
        </p>
      </Section>

      <Section id="sharing" title="Present, export & email">
        <p>
          Several ways to get the scorecard in front of people who aren&apos;t
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
            &amp; near-miss trend chart, the <strong>recordable distribution +
            next-month forecast</strong>, reporting/investigation quality, and the
            permit/LOTO program — with your tenant logo and brand mark in the
            header. The risk score is recomputed server-side so the board-pack
            headline is authoritative. Set the logo under tenant settings if the
            header looks empty.</li>
          <li><strong>Excel.</strong> The &quot;Excel&quot; button downloads a
            multi-tab workbook (<em>Summary, Leading, Lagging, Trends,
            Distribution, Targets, Risk drivers</em>) for analysts who want to
            pivot the numbers themselves. It opens in Excel and{' '}
            <strong>imports cleanly into Google Sheets</strong> (File ▸ Import) —
            the &quot;Google spreadsheet&quot; route, with no add-on to install.
            The risk headline is recomputed server-side, and every cell is
            guarded against spreadsheet formula injection.</li>
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

      <Section id="focus" title="Where to focus (AI assistant)">
        <p>
          Next to the predicted-risk card,{' '}
          <strong>&quot;Where to focus&quot;</strong> is an on-demand assistant:
          press <strong>Analyze</strong> and it turns your <em>deterministic</em>{' '}
          risk drivers and forecast into a short, ranked, plain-language list of
          where to work next — each item deep-linking to the module to act in.
        </p>
        <p>
          It is deliberately <strong>honest about its limits</strong>. The risk
          score is <em>always</em> computed by the model, <strong>never</strong>{' '}
          by the AI; the assistant only writes the prose and picks which drivers
          to highlight, and the deep links are resolved server-side (the model
          can&apos;t invent a destination). If the AI is unavailable the card
          falls back to the top deterministic drivers and shows an amber{' '}
          <em>&quot;deterministic — AI analysis unavailable&quot;</em> pill, so a
          fallback is never mistaken for an AI-written read. It&apos;s
          rate-limited per tenant (about 20 runs an hour) and is advisory
          guidance for a human to review — not a compliance determination.
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
          {
            q: 'Is "Where to focus" an AI that decides my risk score?',
            a: <>No. The 0–100 score is computed deterministically from your
              indicators; the AI only writes the plain-language ranking on top of
              those numbers and never sets or changes the score. If the AI is
              down, the card shows the top deterministic drivers with an
              &quot;AI analysis unavailable&quot; note.</>,
          },
          {
            q: 'How do I get this into Google Sheets?',
            a: <>Click <strong>Excel</strong> to download the workbook, then in
              Google Sheets use <strong>File ▸ Import</strong> and upload it — all
              seven tabs come across. There&apos;s no Google sign-in or add-on to
              install.</>,
          },
          {
            q: 'Why a c-chart instead of a bell curve?',
            a: <>Recordables are rare counts, so a normal (bell) curve is the
              wrong model — it would imply negative months. A c-chart with ±3σ
              control limits (plus a Poisson fit) is the standard, honest way to
              tell a real signal from ordinary variation. See{' '}
              <Link href="#distribution">Distributions &amp; forecast</Link>.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Walk through the scorecard at the same cadence each week so trend reads stay comparable.',
            'Tap into a metric\'s detail sheet to see its formula and supporting stats before you quote a number.',
            'Use the c-chart\'s upper control limit to tell a real signal from week-to-week noise before you escalate.',
            'Treat "Where to focus" as a starting point — confirm in the linked module before you act.',
            'Pair scorecard trends with the Risk Intelligence module to find the drivers behind the numbers.',
            'Screenshot the 30d view at month-end for the leadership pack — it\'s the cleanest comparison view.',
            'Check the scorecard before issuing tenant-wide changes; you\'ll spot regressions sooner.',
          ]}
          donts={[
            'Don\'t use scorecard numbers in incentive plans — gaming them undermines the data.',
            'Don\'t compare two tenants on this page; switch tenants to compare side-by-side.',
            'Don\'t take a single week\'s spike at face value — open the underlying module to confirm before raising it.',
            'Don\'t paste the "Where to focus" narrative into a compliance record as a determination — it\'s advisory.',
            'Don\'t read the forecast band as a guarantee; it\'s a deterministic projection, not a promise.',
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
