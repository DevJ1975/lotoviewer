# AI Support Bot for Soteria FIELD

## Goal

In-app AI assistant that answers "how do I…" questions for any Soteria
module (LOTO, Confined Spaces, Hot Work, Risk, Inspector, Permit Sign-on,
Print, Reviews, Multi-tenancy admin). When the bot can't help — either
because the user explicitly asks for a human, or because the model returns
low confidence — it opens a **support ticket** that emails
`jamil@trainovations.com` with the full conversation transcript and
context, then tells the user a human will follow up.

This builds on the existing `/support` bug-report flow (Resend + Supabase
`bug_reports` table from migration 034) — same plumbing, new entrypoint
focused on usage questions rather than defects.

## Scope (and what's out)

**In scope**

- Conversational chat widget mounted on every authenticated page.
- Module-aware: knows what page the user is on and tailors answers.
- Knowledge-base–grounded answers (no free-floating hallucinations about
  the app's actual UI).
- Human-handoff: bot creates a ticket and emails support; user sees a
  ticket ID and gets an email confirmation.
- Conversation history persisted per user/tenant.

**Out of scope (v1)**

- Voice input.
- Live chat with a human inside the bot (handoff is async via email).
- Multi-language — English only first; Spanish later (parallel to the
  Spanish placard work already pending).
- Public/anonymous use — sign-in required, same as `/support`.

## Architecture

```
┌──────────────────┐     ┌──────────────────────┐     ┌────────────────┐
│ <SupportBot/>    │────▶│ POST /api/support/   │────▶│ Anthropic API  │
│ floating widget  │     │      chat            │     │ (Claude Sonnet)│
│ on every page    │◀────│  - load KB context   │◀────│  + tool use    │
└──────────────────┘     │  - call model        │     └────────────────┘
        │                │  - persist turn      │
        │                │  - if escalate →     │
        │                │    create ticket +   │
        │                │    email via Resend  │
        │                └──────────────────────┘
        │                          │
        │                          ▼
        │                ┌──────────────────────┐
        │                │ Supabase             │
        └───────────────▶│  support_conversa-   │
                         │  tions, support_     │
                         │  messages, support_  │
                         │  tickets             │
                         └──────────────────────┘
```

### Why Claude Sonnet, not Haiku

Haiku is right for narrow validation (the photo-validation route). For
multi-turn conversational support that has to reason over a knowledge
base and decide *when to escalate*, Sonnet 4.6 is the right tradeoff —
better instruction following, structured tool use for the
`create_support_ticket` action, and fast enough for chat. Use prompt
caching on the system prompt + KB so per-turn cost stays low.

## Knowledge base

Plain Markdown files under `apps/web/lib/support/kb/`, one per module:

```
lib/support/kb/
├── index.ts                ← exports the registry
├── general.md              ← sign-in, navigation, tenant switching, PWA
├── loto.md                 ← equipment, photos, energy steps, signoff
├── confined-spaces.md      ← inventory, permits, atmospheric testing
├── hot-work.md
├── risk.md
├── inspector.md
├── permit-signon.md
├── print.md
├── reviews.md
└── superadmin.md           ← only injected if user is superadmin
```

Each file is short (≤ 2k tokens) and answers the questions a field user
actually asks: "How do I sign off a department?", "Why is my photo
rejected?", "How do I cancel a hot-work permit?". Authoring is a
documentation task — content reviewed by the user, not generated.

The bot picks which KB files to load based on:

1. The current `pathname` the widget reports (e.g. `/loto/...` →
   `loto.md`).
2. The active tenant's enabled modules from `moduleVisibility` —
   never offer help for a module the tenant doesn't have.
3. Always include `general.md`.

Loaded KB content is injected into the system prompt with prompt caching
(see [Anthropic prompt caching](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)) so identical
prefixes across turns are billed at 10% of input cost.

### Why not RAG / embeddings (yet)

Total KB will fit in ~30k tokens. Keeping it as flat markdown injected
under prompt caching is simpler, deterministic, and cheaper to operate
than running pgvector + embeddings. Revisit if KB exceeds ~80k tokens.

## Data model — migration `043_support_assistant.sql`

```sql
create table public.support_conversations (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  tenant_id     uuid references public.tenants(id),
  started_at    timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  resolved      boolean not null default false,
  -- Page the user opened the bot from. Useful for analytics: which
  -- modules generate the most questions?
  origin_path   text
);

create table public.support_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant','system','tool')),
  content         text not null,
  -- Token + cost accounting per assistant turn (null for user/tool)
  input_tokens    int,
  output_tokens   int,
  cache_read_tokens int,
  created_at      timestamptz not null default now()
);

create table public.support_tickets (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.support_conversations(id),
  user_id         uuid not null references public.profiles(id),
  tenant_id       uuid references public.tenants(id),
  user_email      text,
  user_name       text,
  -- Bot's structured summary of what the user wants help with
  subject         text not null,
  summary         text not null,
  -- Why the bot escalated: 'user_requested' | 'low_confidence' | 'safety_critical'
  reason          text not null,
  -- Did the Resend send succeed? Same pattern as bug_reports.emailed_ok
  emailed_ok      boolean,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index on public.support_conversations (user_id, last_message_at desc);
create index on public.support_messages (conversation_id, created_at);
create index on public.support_tickets (created_at desc) where resolved_at is null;
```

**RLS** — mirror migration 034:

- `support_conversations` / `support_messages`: users can read & insert
  their own rows; superadmins can read all.
- `support_tickets`: any authenticated user can insert (the API route
  enforces auth via `auth.getUser`); reads are superadmin-only.

## API routes

### `POST /api/support/chat`

Request:

```ts
{
  conversationId?: string  // null on first turn
  message: string
  pathname: string         // e.g. "/loto/north-line/MIX-04"
}
```

Response (streamed via Server-Sent Events for snappy UX):

```ts
event: token  data: "..."           // assistant text deltas
event: tool   data: { name, input } // when bot calls a tool
event: done   data: {
  conversationId, messageId,
  ticketId?: string,                // present iff a ticket was created
  inputTokens, outputTokens, cacheReadTokens
}
```

The route:

1. Resolves the user from the bearer token (same `authedReporter` pattern
   as `bug-report/route.ts`).
2. Loads or creates the conversation; loads recent message history
   (cap at last 20 turns).
3. Picks KB files from the `pathname` and tenant module list.
4. Calls `client.messages.create` with:
   - **system**: persona + KB content (cached).
   - **tools**: `[create_support_ticket, get_user_context]`.
   - **messages**: prior history + new user turn.
5. Streams tokens to the client.
6. On `tool_use → create_support_ticket`, runs the tool (writes to
   `support_tickets`, sends email via Resend), feeds the tool result
   back to the model, lets it produce a confirmation reply.
7. Persists the assistant turn + token counts.

### `GET /api/support/conversations`

List the current user's conversations for a "history" panel. Superadmin
sees all (used for triage).

### `GET /api/support/tickets` (superadmin)

For the eventual admin dashboard view of open tickets. v1 just relies
on email — but having the read API ready keeps the UI cheap to add.

## The escalation tool

Defined in the Claude tool-use schema:

```ts
{
  name: 'create_support_ticket',
  description:
    'Open a human support ticket. Call this when the user explicitly ' +
    'asks to talk to a person, when you are not confident in your answer, ' +
    'or when the question involves a safety / compliance decision that a ' +
    'human must own (e.g. "is this LOTO procedure compliant?"). The ticket ' +
    'is emailed to the support team and they will follow up by email.',
  input_schema: {
    type: 'object',
    required: ['subject', 'summary', 'reason'],
    properties: {
      subject: {
        type: 'string',
        description: 'Short ticket subject (under 100 chars).',
      },
      summary: {
        type: 'string',
        description:
          'What the user is trying to do, what they tried, and where ' +
          "they're stuck. Include the module / page when relevant.",
      },
      reason: {
        type: 'string',
        enum: ['user_requested', 'low_confidence', 'safety_critical'],
      },
    },
  },
}
```

The system prompt explicitly instructs the model to **prefer escalation
over guessing** for any safety- or compliance-adjacent question. This
matches the pattern in `generate-loto-steps/route.ts`: AI drafts,
qualified humans decide.

## Email format

Reuse Resend (already wired). To: `SUPPORT_EMAIL` (defaults to
`jamil@trainovations.com`). Subject:
`[Support] {ticket.subject} — {tenant.name}`.

Body (text-first, same approach as `renderBugReportText`):

```
Ticket: {id}
Reason: {reason}
User:   {name} <{email}>
Tenant: {tenant_name}
Page:   {origin_path}
Opened: {iso timestamp}

— Summary (from the bot) —
{summary}

— Conversation transcript —
[user]      ...
[assistant] ...
[user]      ...
...

Reply directly to this email to respond to the user — Reply-To is set
to their address.
```

`replyTo` is set to the user's email so a one-tap reply lands in their
inbox, identical to the bug-report route.

A separate confirmation email goes to the user: "Your ticket #abc123 is
open, we'll follow up at {email}."

## UI

### Floating widget

`<SupportBot />` mounted in `apps/web/app/layout.tsx` inside the
authenticated shell (skip for `/login`, `/forgot-password`,
`/reset-password`, `/inspector/*` token routes, the `/print` placard
preview, and any unauthenticated landing).

- Bottom-right pill button with the existing `LifeBuoy` icon.
- Click → slide-up panel (mobile: full-screen sheet; desktop: 380×600
  card anchored bottom-right).
- Uses shadcn primitives consistent with the rest of the app.
- Markdown rendering for assistant messages (code blocks, bullet lists,
  links — the KB will reference internal routes like
  `[Equipment list](/loto)`).
- Sticky "Talk to a human" button at the bottom of the panel — calls
  `create_support_ticket` directly with `reason: 'user_requested'`,
  short-circuiting the model.
- Empty-state suggestions tailored to the current page ("How do I sign
  off this department?" on `/departments/[dept]`).

### `/support` page changes

The existing bug-report form stays — different intent (defect report vs.
how-to). Add a tab switcher at the top: **Ask the assistant** (opens the
chat widget pre-focused) | **Report a bug** (existing form). Keep both
emailing the same address; the subject prefix differentiates them
(`[Support]` vs `[Bug]`).

## Multi-tenancy

- Every conversation row carries `tenant_id` from the active-tenant
  header (`x-tenant-id`), same scoping as the rest of the app.
- KB module files are gated by `moduleVisibility` — a tenant without
  Confined Spaces never sees CS answers (avoids confusion + hallucinated
  feature suggestions).
- Conversation history is per-user, not per-tenant — if a user belongs
  to multiple tenants, their support history follows them but the
  *active tenant at the time of each message* is captured for triage.

## Cost & rate limiting

- Per-user: 30 messages / hour, 200 / day. Enforced in the API route
  via a Postgres count query (cheap; same pattern other rate-limited
  routes in this codebase use).
- Stream from Anthropic so the user sees progress and isn't tempted to
  retry.
- Prompt-cache the system + KB block; expected cache-hit rate >70%
  during a single conversation.
- Model: `claude-sonnet-4-6`. Estimated cost at typical 8-turn
  conversation with cached KB: ≈ $0.02.

## Observability

- Sentry tag every chat route call with `route: '/api/support/chat'`,
  same as bug-report.
- Log token counts to `support_messages` columns so the daily health
  cron (already exists) can roll up per-tenant cost.
- New superadmin page `/superadmin/support` (Phase 3) listing recent
  conversations + open tickets. Until that ships, email is the
  notification channel.

## Security

- Auth required (Bearer token, `auth.getUser`) — identical to bug-report
  route. No anonymous access.
- Tool inputs sanitised before insertion (length caps mirror `bug_reports`
  constraints).
- HTML-escape transcript before email (reuse `escapeHtml` from
  bug-report route).
- Never include another tenant's data in KB context — module gating
  enforces this.
- Ignore prompt-injection attempts inside KB files: the system prompt
  treats KB as reference text, not instructions, and the user-message
  channel is the only thing that can call tools.

## Phasing

### Phase 1 — MVP (the ship target)

- Migration 043.
- KB files for `general` + `loto` only.
- `POST /api/support/chat` (non-streaming first; SSE in Phase 2).
- `<SupportBot />` widget on layout.
- `create_support_ticket` tool + Resend email.
- User confirmation email.
- Tests: unit (KB resolver, tool input validation, email rendering),
  integration (chat → escalate → ticket row + email).

### Phase 2 — Coverage

- KB files for confined-spaces, hot-work, risk, inspector,
  permit-signon, print, reviews.
- SSE streaming.
- Suggested-questions empty state per page.
- Conversation history panel.

### Phase 3 — Triage

- `/superadmin/support` dashboard: open tickets, recent conversations,
  resolve / reply actions.
- Daily digest of open tickets (extends the existing health-report cron).
- Mark-as-resolved API.

### Phase 4 — Polish

- Spanish KB + auto-detect language.
- "Was this helpful?" thumbs on assistant messages — feeds a quality
  signal we can use to prioritise KB updates.

## Open questions for the user

1. Confirm `jamil@trainovations.com` is the right address for tickets
   too, or do you want a separate alias (e.g. `support@`)?
2. Should the bot be available to **inspector token** routes
   (read-only auditors)? Default plan: no — they're outside the normal
   auth flow.
3. Daily ticket cap globally? (Defending against a runaway loop or
   abusive tenant.) Default plan: 500/day platform-wide, 100/day per
   tenant — alert via Sentry on breach.
4. Authoring: do you want to draft the KB markdown yourself for accuracy,
   or have me draft from the existing module docs and you review?
