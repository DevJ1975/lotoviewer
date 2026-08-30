import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-06-17'

const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.0.0',
    date:    '2026-06-17',
    changes: [
      'Initial dedicated Behavior-Based Safety wiki page. Consolidates both ' +
      'BBS surfaces (v1 gamified QR + leaderboard, v2 ratio-driven coaching) ' +
      'and the Workplace Learning System coaching upgrade: C.A.R.E.S. notes, ' +
      'a structured safe-behavior checklist, recognition, the 24-hour "Hot ' +
      'Seat" rapid review, and Safety Action Teams. Previously covered under ' +
      'the Platform Features page.',
    ],
  },
]

export default function WikiBbsPage() {
  return (
    <WikiPage
      title="Behavior-Based Safety (BBS)"
      subtitle="Catch the safe and unsafe behaviors that precede injuries — observe, coach in the moment, and track the safe-to-unsafe ratio as a leading indicator."
      modulePath="/bbs"
      audience="live"
      category="Safety"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',     label: 'What it\'s for' },
        { id: 'surfaces',     label: 'Two surfaces' },
        { id: 'capture',      label: 'Filing an observation' },
        { id: 'ratio',        label: 'Safe-to-unsafe ratio' },
        { id: 'coaching',     label: 'C.A.R.E.S. coaching & recognition' },
        { id: 'rapid-review', label: 'Rapid review (Hot Seat)' },
        { id: 'teams',        label: 'Safety Action Teams' },
        { id: 'dashboards',   label: 'Dashboards & scorecard' },
        { id: 'faq',          label: 'FAQ' },
        { id: 'dodonts',      label: 'Do\'s & Don\'ts' },
        { id: 'related',      label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Behavior-Based Safety captures the everyday behaviors and conditions
          that come <em>before</em> an injury — the unsafe act caught and
          coached, the unsafe condition flagged, the safe behavior reinforced.
          Where an incident report is a lagging indicator (it counts what
          already went wrong), BBS is a <strong>leading indicator</strong>: a
          steady flow of observations and coaching conversations is what bends
          the injury curve down before anyone gets hurt.
        </p>
        <p>
          The approach is grounded in the Workplace Learning System (WLS)
          methodology: many small observations, a positive and non-punitive
          coaching conversation in the moment, and a culture where people look
          out for one another.
        </p>
      </Section>

      <Section id="surfaces" title="Two surfaces">
        <p>
          BBS ships two complementary surfaces that share the philosophy but
          serve different jobs. Both can run at once.
        </p>
        <ul>
          <li>
            <strong>v1 — participation &amp; gamification.</strong> Anonymous
            QR intake, authenticated submissions that earn points, a
            leaderboard, a 3×3 risk matrix, and a close-out workflow. Built to
            drive broad participation across a site.
          </li>
          <li>
            <strong>v2 — shop-floor coaching.</strong> A fast, mobile-first
            capture form built around the safe-to-unsafe ratio, the in-the-
            moment coaching conversation, recognition, rapid review, and team
            ownership. Built for daily coaching by supervisors and peers.
          </li>
        </ul>
      </Section>

      <Section id="capture" title="Filing an observation">
        <ul>
          <li>
            <strong>Quick coaching capture (v2).</strong>{' '}
            <Link href="/bbs/observe">/bbs/observe</Link> — pick a category
            (safe behavior / unsafe act / unsafe condition) and severity,
            describe what you saw, and submit. Most observations take under 30
            seconds; the goal is many small ones, not a few exhaustive ones.
            For safe behaviors you can tick a behavior checklist (PPE, body
            position / line of fire, tools &amp; equipment, procedures,
            housekeeping, ergonomics) and recognize the worker; for unsafe ones
            you can recommend a control on the hierarchy of controls.
          </li>
          <li>
            <strong>Authenticated submission (v1).</strong>{' '}
            <Link href="/bbs/new">/bbs/new</Link> — file a fuller report with
            optional ABC analysis (antecedent / behavior / consequence) and a
            risk rating; submissions earn leaderboard points.
          </li>
          <li>
            <strong>Anonymous QR intake (v1).</strong> A worker scans a printed
            QR code at a posted location and submits without logging in
            (<code>/r/bbs/&#123;token&#125;</code>). Admins create and print the
            location codes at <Link href="/bbs/qr">/bbs/qr</Link> and can rotate
            or disable a token at any time.
          </li>
        </ul>
      </Section>

      <Section id="ratio" title="Safe-to-unsafe ratio">
        <p>
          The headline v2 metric is the <strong>safe-to-unsafe ratio</strong> —
          safe-behavior observations divided by unsafe ones (acts + conditions).
          The dashboard bands it with an intentionally loud colour:
        </p>
        <ul>
          <li><strong>Red</strong> (&lt;2:1) — too few safe observations; a culture finding, not a data finding.</li>
          <li><strong>Yellow</strong> (2–4:1) — coaching is catching up.</li>
          <li><strong>Green</strong> (≥4:1) — a healthy coaching ratio.</li>
        </ul>
        <p>
          The thresholds are the bands the EHS community has converged on. The
          ratio is a thermometer, not a target to optimize — see the Don&apos;ts.
        </p>
      </Section>

      <Section id="coaching" title="C.A.R.E.S. coaching & recognition">
        <p>
          The act that actually changes behavior is the conversation, not the
          record. When an observer has the coaching talk in the moment, they
          mark <strong>&quot;I gave coaching feedback&quot;</strong> and can add
          a short <strong>C.A.R.E.S.</strong> note — keep it positive and
          connect the behavior to a safe outcome. Safe behaviors worth
          celebrating can be flagged <strong>Recognized</strong>; recognized
          observations surface in a recognition feed on the dashboard. The whole
          loop is deliberately non-punitive: the point is the system and the
          habit, not blame.
        </p>
      </Section>

      <Section id="rapid-review" title="Rapid review (Hot Seat)">
        <p>
          Borrowing the WLS &quot;Hot Seat&quot; idea, a <strong>critical</strong>{' '}
          unsafe observation is automatically flagged for a{' '}
          <strong>24-hour rapid review</strong>. The dashboard tracks these as
          due and overdue so a serious finding gets a fast, learn-and-fix
          response — again, to understand and correct quickly, never to punish.
          Lower-severity findings use the ordinary follow-up flag instead.
        </p>
      </Section>

      <Section id="teams" title="Safety Action Teams">
        <p>
          Rather than a single safety committee, work can be owned by{' '}
          <strong>Safety Action Teams</strong>. Admins manage the team list
          inline on the dashboard, and any observation can be assigned to a team.
          Outstanding follow-ups then group by team (with an &quot;Unassigned&quot;
          bucket), so each crew can see and clear its own.
        </p>
      </Section>

      <Section id="dashboards" title="Dashboards & scorecard">
        <ul>
          <li>
            <strong>Leading-indicator dashboard (admin).</strong>{' '}
            <Link href="/admin/observations/bbs/dashboard">/admin/observations/bbs/dashboard</Link>
            {' '}— the trailing-30-day safe-to-unsafe ratio, a funnel, rapid
            reviews due/overdue, the safe-behavior trend, the recognition feed,
            and follow-ups grouped by team. Also where you add/disable teams.
          </li>
          <li>
            <strong>BBS scorecard.</strong> <Link href="/bbs/scorecard">/bbs/scorecard</Link>
            {' '}— the composite EHS score (participation, close-out rate,
            severity weighting), the top-contributor leaderboard, and a
            &quot;Coaching &amp; recognition&quot; panel surfacing the v2 leading
            indicators.
          </li>
          <li>
            <strong>Leaderboard.</strong> <Link href="/bbs/leaderboard">/bbs/leaderboard</Link>
            {' '}— top contributors by points (anonymous submissions excluded).
          </li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'Why are there two BBS surfaces (v1 and v2)?',
            a: <>v1 predates the safe / unsafe-act / unsafe-condition
              categorization and ratio metric the EHS community standardized on.
              v2 adds that plus the coaching loop. They run in parallel so sites
              already invested in the v1 QR + leaderboard flow keep it while
              adopting the v2 coaching practice.</>,
          },
          {
            q: 'Should I report a safe behavior, or only unsafe ones?',
            a: <>Report both — safe behaviors are the point. The safe-to-unsafe
              ratio only works if observers actively catch people doing it right,
              and recognition is what reinforces the habit.</>,
          },
          {
            q: 'What makes an observation trigger a 24-hour rapid review?',
            a: <>An unsafe act or unsafe condition logged at <strong>critical</strong>{' '}
              severity is auto-flagged at capture. You\'ll see a banner on the
              form; the dashboard then tracks it as due, and overdue once 24
              hours pass without a completed review.</>,
          },
          {
            q: 'Can workers submit without an account?',
            a: <>Yes, through the QR intake — they scan a posted code and submit
              anonymously. Anonymous submissions count toward the metrics but are
              excluded from the points leaderboard.</>,
          },
          {
            q: 'Who can manage Safety Action Teams?',
            a: <>Admins, inline on the leading-indicator dashboard. Teams can be
              disabled (not deleted) so historical assignments stay intact.</>,
          },
          {
            q: 'Where does BBS show up in KPIs?',
            a: <>The <Link href="/bbs/scorecard">BBS scorecard</Link> blends a
              composite EHS score and surfaces the v2 ratio, recognition,
              coaching-feedback, and rapid-review-due figures.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Aim for many small observations. A 30-second note beats a page-long report nobody files.',
            'Have the coaching conversation in the moment and mark feedback given — the talk is the intervention, not the record.',
            'Catch people doing it right. Recognize safe behaviors so the ratio reflects real coaching.',
            'Close out a critical finding within the 24-hour rapid-review window; assign follow-ups to the owning Safety Action Team.',
            'Recommend a control on the hierarchy of controls (eliminate first, PPE last) when you log an unsafe condition.',
          ]}
          donts={[
            'Don\'t treat the safe-to-unsafe ratio as a target to optimize. Tilting toward easy "safe" observations to pad the ratio is the failure mode the metric is meant to surface.',
            'Don\'t use BBS to assign blame. A punitive program kills reporting overnight.',
            'Don\'t let rapid reviews go overdue — a critical finding without a fast response is the gap the Hot Seat exists to close.',
            'Don\'t leave QR location tokens active after a poster is removed. Rotate or disable them so stale codes can\'t be misused.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/scorecard',             label: 'EHS Scorecard' },
          { href: '/wiki/near-miss',             label: 'Near-Miss' },
          { href: '/wiki/risk',                  label: 'Risk Assessment' },
          { href: '/wiki/integrity-compliance',  label: 'Integrity & Compliance' },
          { href: '/wiki/platform-features',     label: 'Platform Features' },
        ]} />
      </Section>
    </WikiPage>
  )
}
