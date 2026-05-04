# Deferred work log — monorepo / mobile rollout

Running tally of items consciously deferred during the
Solito-monorepo rollout. Each entry has: phase it surfaced in, why
it was deferred, what unblocks it, and the file path(s) involved.
Kept here so nothing leaks out of the plan.

## Phase 0 — monorepo migration

### D0.1 — Vercel project root directory
- **Why deferred**: Cannot edit Vercel project settings from this
  environment.
- **Action**: User sets Vercel → Project → Settings → General →
  **Root Directory: `apps/web`** before the next deploy.
- **Blocks**: First production deploy after the Phase 0 commit.

### D0.2 — Switch from npm to pnpm
- **Why deferred**: Plan called for pnpm workspaces; in this
  sandbox `pnpm install` hit transient registry 403s. `npm install`
  worked cleanly. Kept npm to avoid bundling tooling churn into the
  monorepo move.
- **Action**: Optional. Run `pnpm import` to translate the npm
  lockfile, delete `package-lock.json`, add `pnpm-workspace.yaml`,
  point Vercel at pnpm. Only worth doing if the team sees
  meaningful pnpm benefits (faster installs, content-addressable
  store).
- **Blocks**: Nothing — npm workspaces are functionally equivalent.

## Phase 1 — extract `packages/core`

### D1.1 — Move `lib/supabase.ts` into `packages/core`
- **Why deferred**: Browser sessionStorage + `process.env.NEXT_PUBLIC_*`
  reads make it not yet cross-platform clean. Plan calls for
  parameterizing the storage adapter so each app supplies its own
  (`window.localStorage` for web, `expo-secure-store` for mobile).
  Doing this without an actual mobile consumer risks designing the
  wrong abstraction.
- **Action**: When wiring Phase 2's auth shell, refactor to take a
  storage adapter + active-tenant getter as parameters. Move the
  refactored client to `packages/core/src/supabase.ts`. Leave a
  thin `apps/web/lib/supabase.ts` that supplies the browser
  adapters.
- **Blocks**: D1.2 (everything that imports `supabase`).
- **Files**: `apps/web/lib/supabase.ts`.

### D1.2 — Move metrics + queries to `packages/core`
- **Why deferred**: Each of these imports `@/lib/supabase`. Once
  D1.1 lands, they can move without changes.
- **Files**:
  - `apps/web/lib/scorecardMetrics.ts`
  - `apps/web/lib/insightsMetrics.ts`
  - `apps/web/lib/homeMetrics.ts`
  - `apps/web/lib/queries/*.ts`
- **Action**: After D1.1, `git mv` to `packages/core/src/`,
  re-export shims in apps/web/lib, run vitest.

### D1.3 — Codemod call sites off the shims
- **Why deferred**: Phase 1 left thin re-export shims at
  `apps/web/lib/X.ts` so 175+ call sites stay untouched. Long-term
  the right thing is `import from '@soteria/core/X'` directly so
  there's no extra hop.
- **Action**: Mechanical sed/jscodeshift across `apps/web/`. Drop
  the shim files when the last caller is updated. Optional — the
  shims are zero-cost at bundling time.
- **Blocks**: Nothing.

## Phase 2 — Expo app skeleton (open)

### D2.1 — TestFlight + Play Internal Testing builds
- **Why deferred**: Requires Xcode + Android Studio + Apple
  Developer ID + Google Play console credentials. Cannot run from
  this environment.
- **Action**: User runs `eas build --profile preview --platform
  ios|android` after the auth shell lands; uploads via Transporter
  / Play Console.
- **Blocks**: Phase 3 acceptance.

### D2.2 — Universal Links / App Links domain hosting
- **Why deferred**: Requires uploading
  `apple-app-site-association` and
  `.well-known/assetlinks.json` to `soteriafield.app`. The web
  domain and DNS are user-controlled.
- **Action**: User adds the two well-known files to
  `apps/web/public/.well-known/` and verifies via Apple's
  Universal Link Validator.
- **Blocks**: The "tap reset-password email link → app opens"
  smoke step.

### ~~D2.4 — Mobile Metro bundler: hoist expo-router so babel-preset-expo finds it~~ — RESOLVED
- **Original problem**: `expo export --platform ios` (and `expo
  start`) failed to bundle `expo-router/_ctx.ios.js` because
  `require.context(process.env.EXPO_ROUTER_APP_ROOT, …)` was not
  being transformed. Root cause: `babel-preset-expo` resolves at
  the hoisted root `/node_modules/`, where it calls
  `require.resolve('expo-router')` to decide whether to register
  the babel plugin that inlines `EXPO_ROUTER_APP_ROOT`. But
  `expo-router` landed in `apps/mobile/node_modules/expo-router`
  (npm wouldn't hoist it because of an unrelated React version
  conflict), so the resolve failed and the plugin never registered.
- **Resolution**: Pinned `expo-router` as a top-level dependency
  in the root `package.json`. `npm install` then hoists it to
  `/node_modules/expo-router`, where babel-preset-expo's
  `require.resolve('expo-router')` succeeds and the plugin chain
  fires correctly.
- **Verification**: `npx expo export --platform ios|android`
  from `apps/mobile/` both bundle cleanly (4.15 MB Hermes
  bytecode each). Web vitest still 1078/1078 green.
- **Note for future maintainers**: The root pin is _not_ a
  regular consumer dependency — nothing at the monorepo root
  imports from `expo-router`. It exists solely to coerce npm
  workspaces into hoisting it so the babel plugin chain works.
  Same trick may be needed for any future Expo plugin that does
  `require.resolve('expo-…')` from a hoisted location.

### D2.3 — Apple Developer Program enrollment + Bundle ID claim
- **Why deferred**: Paid annual program ($99/yr); requires user
  identity + DUNS or individual signup.
- **Action**: User enrolls and reserves
  `com.soteriafield.app` in App Store Connect.
- **Blocks**: TestFlight build upload.

## Conventions

- Add new entries with the next sequential ID (D2.4, D2.5, …).
- Cross-link by ID from commit messages and PRs ("unblocks D1.1").
- Strike out a row (`~~D…~~`) when complete; don't delete — keep
  the audit trail.
