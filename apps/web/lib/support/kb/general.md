# Soteria FIELD — general usage

This is the general help that applies anywhere in the app. Module-specific
help (LOTO, Confined Spaces, Hot Work, Risk, Inspector, Permit Sign-on) lives
in separate sections that are loaded automatically when the user is on those
pages.

## What Soteria FIELD is

A field-safety PWA used by production teams to manage Lockout/Tagout
procedures, confined-space permits, hot-work permits, risk assessments, and
related compliance documentation. It runs in the browser on iPad, iPhone,
Android, laptops, and desktops, and works offline for most read tasks.

## Regulatory frameworks the platform addresses

Soteria FIELD is built around overlapping U.S. Federal OSHA, Cal/OSHA
Title 8, NFPA, ANSI, and ISO 45001 standards. The bot will surface
the specific citations relevant to each module when asked. The major
ones that span multiple modules:

- **Federal OSHA — 29 CFR Part 1910** (Occupational Safety and Health
  Standards for General Industry) — the federal floor.
- **OSHA General Duty Clause — Section 5(a)(1) of the OSH Act** —
  the catch-all employers must keep workplaces free from recognized
  serious hazards even where no specific standard exists.
- **OSHA recordkeeping — 29 CFR Part 1904** — what counts as a
  recordable injury / illness; influences how near-misses + incidents
  are tracked.
- **Cal/OSHA — Title 8 of the California Code of Regulations (T8)** —
  California-specific requirements that meet or exceed federal OSHA.
  Cal/OSHA tenants typically need both the federal AND California
  citations on documentation.
- **ISO 45001:2018** — international occupational health and safety
  management system standard. The Risk + Near-Miss + JHA modules align
  to ISO 45001 §6.1 (hazard ID + risk eval), §8.1.2 (hierarchy of
  controls), and §9.1 (monitoring and measurement).
- **NFPA 51B** — fire-prevention standard for hot work.
- **ANSI/ASSP Z490.1** — guideline cadence for periodic JHA review
  (annual minimum, plus on every significant process change).

The bot can cite specific subsections per module — e.g. it knows that
LOTO maps to 29 CFR 1910.147 and Cal/OSHA T8 §3314, that confined
spaces maps to 29 CFR 1910.146 and Cal/OSHA T8 §5157, and so on.
**Citations are pointers, not legal advice.** A qualified safety
professional must make the actual compliance call.

## Signing in

- Open the app and tap **Sign in** at `/login`.
- Email + password. Use **Forgot password?** at `/forgot-password` to get a
  reset link.
- New users are invited by an admin. There is no public sign-up.

## Navigating

- The hamburger button in the top-left opens the **navigation drawer** with
  every module the current tenant has enabled.
- The brand mark in the top bar always returns to the home dashboard (`/`).
- Global search (top bar) finds equipment, departments, permits, and risk
  assessments by ID or name.

## Tenants (which "site" you're working on)

- The tenant pill in the top bar shows the active tenant. Tap it to switch
  if you're a member of more than one.
- Switching tenants reloads the page so in-flight data from the old tenant
  can't leak into the new view.
- Each tenant only sees its own equipment, permits, and reports.

## Offline behaviour

- Read pages cache automatically — viewing equipment lists or placards
  without signal works.
- Photo uploads and signatures are blocked while offline; you'll see a
  sticky banner across the top until the network returns.
- The app retries failed uploads with backoff once you're back online.

## Installing as an app (PWA)

- iPhone / iPad (Safari): tap the share icon → **Add to Home Screen**.
- Android (Chrome): tap the three-dot menu → **Install app**.
- Desktop Chrome / Edge: install icon in the address bar.

## Reporting a bug vs. asking for help

- Use the chat bubble (this assistant) for **how-to** questions.
- Use **Settings → Support** or `/support` for **bug reports** — the form
  goes to the same support inbox but is tagged differently.
- The "Talk to a human" button at the bottom of the chat opens a ticket
  immediately if you'd rather skip the bot.

## Keyboard shortcuts

- `/` focuses the global search bar (when not inside an input).
- `Esc` closes any open modal, drawer, or the chat panel.

## Common questions

**"My module is missing from the drawer."** Each tenant has a list of
enabled modules. An admin (Settings → Modules) can turn one on. If you
don't have admin access, ask whoever onboarded you.

**"I changed something but my colleague doesn't see it."** Most lists
update in real time. If a screen looks stale, pull down to refresh on
mobile or hard-reload the page on desktop.

**"How do I change my password?"** Settings → Account → Change password.
You can also use the password-reset link on the login page.
