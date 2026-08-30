# React Deprecation & Modernization Audit

**Date:** 2026-07-28
**Commit audited:** `2023845` (`main`)
**Scope:** `apps/web`, `apps/mobile`, `packages/core`, `services/sds-parser` — 1,621 TS/TSX files
**Versions in play:**

| Workspace | react | react-dom | @types/react | Framework |
|---|---|---|---|---|
| `apps/web` | `19.2.4` | `19.2.4` | `^19` → **19.2.14** | Next 16.2.6 (App Router) |
| `apps/mobile` | `19.1.0` | `19.1.0` | `~19.1.0` → **19.1.17** | Expo SDK 54 / RN 0.81.5 |
| `packages/core` | — | — | — | framework-free TS (contract holds) |
| `services/sds-parser` | — | — | — | Python / FastAPI |

---

## 1. Verdict

**Nothing in this codebase is broken by React 19, and very little is even at risk.** The categories that usually dominate a React 19 audit are all empty here: zero class components, zero `propTypes`/`defaultProps`, zero `findDOMNode`/`ReactDOM.render`, zero string refs, zero legacy context, zero `React.FC`, zero global `JSX.*` type usage. There are in fact **no `react-dom` imports anywhere in the repo**. Section 5 catalogues the full clean list so nobody re-audits it.

What we actually found splits three ways:

- **Tier 1 — three genuinely-deprecated APIs in use.** Small, mechanical, ~half a day total.
- **Tier 2 — nine toolchain and test-harness defects.** Independently shippable; two of them (mobile's dual-React hazard, CI running no tests) are real risk rather than tidiness.
- **Tier 3 — the actual finding.** The platform runs React 19.2 and uses essentially none of it. Adoption of every React 19-era API is **zero**: `useActionState`, `useFormStatus`, `useOptimistic`, `useEffectEvent`, `useSyncExternalStore`, `useDeferredValue`, real `use(promise)` data reads, real data Suspense, `loading.tsx`. Meanwhile 83% of pages are client components, 161 client files fetch in `useEffect`, and there are 542 hand-written memoization call sites with the React Compiler switched off.

Tier 3 is not a defect list — it is a strategic backlog, and it is deliberately **not** committed to here. It is sized and sequenced so the team can decide.

---

## 2. Method

Static source audit by three parallel specialist passes (removed/deprecated APIs; modernization gaps; toolchain, types and testing), with every headline number re-verified directly against the tree. Where a sub-audit and direct verification disagreed, **the direct verification is what appears below** — notably the `<Context.Provider>` count, which is 12, not the 20 an open+close-tag grep suggests.

**`node_modules` was not installed in the audit environment.** Every claim here is therefore derived from source, `package.json`, and `package-lock.json`, and every count is reproducible by the commands in §7. Two consequences, flagged where relevant: exact Next 16 configuration keys are **not** asserted anywhere in this document, and anyone implementing §6 should read `node_modules/next/dist/docs/` first, per `AGENTS.md`.

---

## 3. Tier 1 — Deprecated React APIs in use

### 1.1 `forwardRef` — 3 sites, 2 files

React 19 passes `ref` to function components as an ordinary prop. `forwardRef` still works and is slated for deprecation in a future release.

| File:line | Shape |
|---|---|
| `apps/web/components/SignaturePad.tsx:3,15` | `forwardRef` + `useImperativeHandle` (`:100`) |
| `apps/web/components/ui/form.tsx:148` | local `Slot` polyfill |

`SignaturePad` is the straightforward one — take `ref` as a prop, keep `useImperativeHandle` (still current). Its three call sites all pass a ref object and need no change: `components/ReviewModal.tsx:175`, `app/review/[token]/_components/ReviewClient.tsx:666`, `app/toolbox-talks/[id]/page.tsx:526`.

**`ui/form.tsx:148-156` needs judgment, not a codemod.** The hand-rolled `Slot` combines `forwardRef` + `cloneElement` + injecting `ref` into the cloned props:

```tsx
return React.cloneElement(children, {
  ...slotProps,
  ...(children.props as Record<string, unknown>),
  ref,
} as React.HTMLAttributes<HTMLElement>)
```

Under React 19's ref-as-prop, `children.props` now *contains* `ref` when the child set one. Because `ref` is spread last, the forwarded ref wins and the child's own ref is silently dropped. Verify the installed `cloneElement` behaviour before touching this — it is the one spot in the whole audit that deserves a test rather than a find-and-replace.

Related, not urgent: `components/ui/sidebar.tsx:186-187` and `:239-240` reimplement the same `asChild`/Slot logic. Two occurrences — per the Rule of Three in `AGENTS.md`, note it and leave it.

**Do not touch `useFormState` in `ui/form.tsx:11,65`.** That is `react-hook-form`'s hook, not the `react-dom` one that React 19 renamed to `useActionState`. Same name, unrelated API.

### 1.2 `react-test-renderer` — deprecated, and the test is dead code

`react-test-renderer` is deprecated in React 19. Its only consumer here is Expo scaffold:

- `apps/mobile/components/__tests__/StyledText-test.js:2` — the sole test file in `apps/mobile`
- `apps/mobile/package.json:39` — `"react-test-renderer": "19.1.0"`

**The test cannot run.** `apps/mobile/package.json` defines only `start`/`android`/`ios`/`web` — no `test` script — and `jest`, `jest-expo`, and `@testing-library/react-native` appear in no manifest and no lockfile entry. There is no `__snapshots__/` directory. `apps/mobile/tsconfig.json` `include` covers only `.ts`/`.tsx`, so the `.js` file is not even type-checked.

It also tests scaffold: `MonoText` → `StyledText.tsx` → used only by `EditScreenInfo.tsx` → used only by `app/modal.tsx`, the stock Expo modal.

Two honest options, and they point in opposite directions:

- **Delete it** — `AGENTS.md` says no dead code, git remembers. Removes the deprecated dependency for free.
- **Wire up a real harness** — `jest-expo` + `@testing-library/react-native`. Justified by `docs/mobile-parity-plan.md`, which schedules substantial mobile expansion against **zero** current coverage.

Deleting the scaffold does not preclude the harness; doing the harness makes deleting the scaffold a side effect. Either way `react-test-renderer` goes.

### 1.3 `<Context.Provider>` — 12 sites, 12 contexts

React 19 renders a context object directly as its own provider (`<Ctx value={…}>`); `<Ctx.Provider>` still works and is slated for deprecation.

Clean 1:1 — every context has exactly one provider site, and there are **zero** `<Ctx.Consumer>` anywhere:

| File | `createContext` | Provider JSX |
|---|---|---|
| `apps/web/components/AuthProvider.tsx` | `:61` | `:143` |
| `apps/web/components/TenantProvider.tsx` | `:82` | `:287` |
| `apps/web/components/FacilityProvider.tsx` | `:42` | `:161` |
| `apps/web/components/SessionProvider.tsx` | `:27` | `:86` |
| `apps/web/components/UploadQueueProvider.tsx` | `:38` | `:158` |
| `apps/web/components/ThemeProvider.tsx` | `:20` | `:92` |
| `apps/web/components/ui/sidebar.tsx` | `:14` | `:44` |
| `apps/web/components/ui/form.tsx` | `:45`, `:59` | `:52`, `:84` |
| `apps/web/components/ui/dialog.tsx` | `:29` | `:43` |
| `apps/mobile/components/AuthProvider.tsx` | `:33` | `:101` |
| `apps/mobile/components/TenantProvider.tsx` | `:35` | `:123` |

Excluded from that count and from any codemod: `components/ui/tooltip.tsx:13` is `TooltipPrimitive.Provider` from `@base-ui/react` — not a React context. `components/TenantProvider.tsx:268` is prose inside a comment.

Lowest-risk item in this document, and the one with the least urgency. Worth doing as a single sweep whenever one of these files is open anyway.

---

## 4. Tier 2 — Toolchain, versions, and test harness

| # | Finding | Evidence |
|---|---|---|
| **2.1** | **React version skew is a live hazard.** Web pins 19.2.4, mobile pins 19.1.0. `react-test-renderer` hoists to root (resolving React **19.2.4**) while a test inside `apps/mobile` resolves the nested React **19.1.0** — two React instances in one process, i.e. null-dispatcher / "invalid hook call". Latent **only** because nothing runs it. Wiring up a mobile test runner (§1.2) without first aligning versions turns this from latent to immediate. | `package-lock.json:15318` vs `:60` |
| **2.2** | **`apps/mobile` has zero test coverage** — one unrunnable file, no runner. 33 `.tsx` files across 24 routes and 9 components. | `apps/mobile/package.json:5-10` |
| **2.3** | **CI runs neither tests nor lint.** `repo-health.yml` runs only `npm ci`, `npm run check:repo`, `npm run check:wiki`. The 303 web tests, the 14 `packages/core` tests, and ESLint never gate a merge. | `.github/workflows/repo-health.yml:25,28,34` |
| **2.4** | **`apps/mobile` is never linted.** No ESLint config exists outside `apps/web`; root `lint` is `npm --workspace web run lint`. The `react-hooks/exhaustive-deps` disable at `apps/mobile/app/(tabs)/hazardous-waste.tsx:116` is inert — it suppresses a rule that never runs. | `package.json:13` |
| **2.5** | **Undeclared peer: `@testing-library/dom@10.4.1`.** Required by RTL 16, present only via npm auto-peer install. Works today; breaks under strict or no-auto-peer installs. | `package-lock.json:5701` (`"peer": true`) |
| **2.6** | **Mobile has `react-dom` with no `@types/react-dom`.** The only copy is root's 19.2.3, which peers on `@types/react ^19.2.0` — mobile's nested 19.1.17 cannot satisfy it. | `apps/mobile/package.json:28`; `package-lock.json:6020` |
| **2.7** | **Stray root dependency.** `expo-router` sits in root `dependencies` with zero root consumers; already declared in `apps/mobile/package.json:22`. | `package.json:30` |
| **2.8** | **Lockfile version strings stale** — `1.9.0` vs `1.16.0`. Dependency *sets* verified in sync across all four manifests; only the strings drifted. `check:version` covers root pkg, web pkg, and `lib/version.ts` — not the lock. | `package-lock.json:3,9` |
| **2.9** | **`globals: true` is load-bearing by accident.** All 303 web tests import `describe`/`it`/`expect` explicitly from `'vitest'`, so `globals` is otherwise unused — but `vitest.setup.ts` registers no `cleanup()`, so RTL's auto-cleanup depends on `globals` exposing `afterEach`. Turning it off would leak DOM across tests **with no error**. Either register `cleanup()` explicitly or leave a comment saying why `globals` cannot be removed. | `apps/web/vitest.config.ts:9`; `apps/web/vitest.setup.ts` |

**React Compiler is not enabled.** `apps/web/next.config.ts` has no `experimental` block at all — no React-specific Next flags are set anywhere. Two things are already in place for it: `babel-plugin-react-compiler@1.0.0` is in the tree (transitively, undeclared — `package-lock.json:7282`), and `eslint-plugin-react-hooks@7.1.1` already ships the compiler-derived rules. See §6.2 before acting.

---

## 5. Already clean — do not re-audit

Every one of these returned **zero hits** across `apps/`, `packages/`, and `services/`:

**Removed in React 19:** `ReactDOM.render`, `ReactDOM.hydrate`, `unmountComponentAtNode`, `findDOMNode`, `React.createFactory`, `propTypes` / the `prop-types` package, `defaultProps` on function components, string refs, legacy context (`contextTypes` / `childContextTypes` / `getChildContext`), `react-dom/test-utils`, `unstable_batchedUpdates`, `useFormState` from `react-dom`, `React.VFC` / `React.SFC`.

**Types:** the global `JSX.*` namespace (`JSX.Element`, `JSX.IntrinsicElements`, …), removed from global scope in `@types/react` v19 — 0 hits. `React.FC` / `React.FunctionComponent` — 0 hits. No `@types/react@19` migration work is outstanding.

**Legacy class-era React:** `extends React.Component` / `PureComponent`, `componentWillMount` / `componentWillReceiveProps` / `componentWillUpdate`, all `UNSAFE_*` lifecycles — 0 hits. **100% function components.** The 12 `class … extends` matches in the repo are all `extends Error`.

**React 19 subtleties that usually bite:** all 172 `useRef` call sites pass an initial value (React 19's `@types` requires one). No ref callback uses an implicit-return arrow body (React 19 treats a returned value as a cleanup function, which silently breaks `ref={el => (r.current = el)}`). No `element.ref` property reads. `React.Children` — 0 hits.

**Testing:** every `act(` import comes from `'react'` or `'@testing-library/react'` — none from the removed `react-dom/test-utils`. `@testing-library/react@16.3.2` declares React 19 peers and is compatible. No enzyme, no `react-addons-*`, no `@testing-library/react-hooks`.

**Boundaries:** `packages/core` holds its stated "no DOM, no Node, no React" contract — zero React imports. `services/sds-parser` is Python; no React surface.

---

## 6. Tier 3 — Outdated idioms (strategic; not committed)

Everything above is a defect. This section is a **choice**. It is included because the brief asked for *outdated* as well as *deprecated*, and because the gap is large enough that not naming it would be the bigger omission.

### 6.0 The shape of it

| Signal | Count |
|---|---|
| `'use client'` files (excl. tests) | **475** |
| `page.tsx` that are client components | **238 of 288 (83%)** |
| Client files fetching data inside `useEffect` | **161** |
| `useEffect` call sites | 438 |
| `<form>` elements / `onSubmit` handlers | 61 / 79 |
| `<form action={…}>` / `'use server'` files | **0 / 0** |
| `useActionState` / `useFormStatus` / `useOptimistic` | **0 / 0 / 0** |
| `useEffectEvent` / `useSyncExternalStore` / `useDeferredValue` | **0 / 0 / 0** |
| Real `use(promise)` data reads | **0** |
| `useMemo` / `useCallback` / `memo()` | 211 / 330 / **1** |
| `<Suspense>` boundaries | 18 — **all** client-side `useSearchParams` CSR bailouts |
| `useTransition` | **1 component** (`app/risk/_components/RiskFilters.tsx:48,55`) |
| `loading.tsx` across 288 routes | **0** |
| `error.tsx` / `global-error.tsx` | 2 (root only) |
| `generateMetadata` / `export const metadata` | 0 / **1** |
| `<Activity>` / `cacheSignal` / `<ViewTransition>` | 0 / 0 / 0 |

Two clarifications so these are not over-read. The 20+ `use(` hits in the codebase are all `const { id } = use(params)` — Next 16's mandated params migration, not `use()`-for-data adoption. And the 8 `<Activity>` grep hits are the `lucide-react` icon, not React's component.

**This is already documented in the repo.** `apps/web/eslint.config.mjs:18-53` disables `react-hooks/set-state-in-effect` with a 35-line rationale, notes it fires at **49 sites across 46 files**, and names its own re-enable conditions: adopt the React Compiler, or migrate to `use()` + Suspense + Server Components. That comment is this roadmap, written from the other direction. `docs/performance-audit-2026-05-13.md` reached the same root cause from the performance side. Three independent audits now converge on one finding.

### 6.1 RSC conversion — the root cause

83% client pages and 161 `useEffect` fetches are why items 6.2 through 6.5 exist at all. Multi-quarter; sequence it behind the performance audit, which already scoped the top read routes. Cross-reference rather than re-plan.

### 6.2 React Compiler — best effort-to-value ratio

542 manual memoization sites, most of them `useCallback` wrapping a `load` function purely to keep an effect's dep array honest. The compiler makes that class of code unnecessary, and it is condition #1 in the ESLint rationale above. The plugin is already in the dependency tree; `eslint-plugin-react-hooks@7.1.1` already provides the rules.

**Before enabling anything: read `node_modules/next/dist/docs/` for the exact Next 16 configuration key.** This document deliberately does not state one — `node_modules` was not installed during the audit, and per `AGENTS.md` the bundled docs are authoritative over training memory. Also declare `babel-plugin-react-compiler` explicitly in `apps/web/package.json` rather than relying on it arriving transitively through Expo tooling.

### 6.3 Form actions — `useActionState` + `useFormStatus`

Of 57 form-bearing files, **50** hand-roll pending state (`saving` / `submitting` / `busy`) and **46** hand-roll error state — the exact pair `useActionState` returns. Representative: `app/fleet/_components/VehicleForm.tsx:28-46`, `app/login/page.tsx:29-30,57`, `app/incidents/new/page.tsx:65-87` (16 `useState` for one form).

Adjacent dependency finding: **`react-hook-form` + `@hookform/resolvers` are carried for exactly one form.** Only two files import it — `components/ui/form.tsx` (unused shadcn wrapper) and `app/admin/people/users/page.tsx` — out of 61 forms. Either adopt it properly or drop it; carrying a form library for 1.6% of forms is the worst of both.

### 6.4 `useEffectEvent` — deletes code that already exists as a polyfill

React 19.2 shipped `useEffectEvent`. The codebase contains a hand-rolled version of it — stash the latest callback in a ref so the effect's dep array can stay empty — in at least five components:

`components/ui/sheet.tsx:28` · `components/Toast.tsx:26` · `components/BatchPrintModal.tsx:29` · `components/placard/PlacardPdfPreview.tsx:81` · `components/dashboard/PlacardDetailPanel.tsx:37`

Supporting surface: 16 files register `keydown` listeners in effects; 33 `setInterval` polling sites. Smallest, most self-contained win in Tier 3.

### 6.5 `useSyncExternalStore` — zero usage, obvious candidates

Several `[]`-dep effects exist only to read browser state after mount: `SessionProvider.tsx:55`, `ThemeProvider.tsx:61`, `app/_components/SafetyAlertTicker.tsx:42`. `hooks/useNetworkStatus.ts` is the clearest case — its `useState(() => navigator.onLine)` lazy init is a hydration-mismatch shape that a server snapshot resolves properly.

### 6.6 `generateMetadata`

288 routes share one static title, `'SoteriaField'` (`app/layout.tsx:19`). Zero `generateMetadata`. No legacy head hacks to remove first — `document.title =`, `document.head` manipulation, and `next/head` are all 0 hits.

Related: React 19 hoists `<link>`/`<meta>` rendered anywhere, so the `apple-touch-startup-image` tags in `components/IosSplashLinks.tsx` no longer need to live under the manual `<head>` in `app/layout.tsx:52`.

### 6.7 Effect hygiene

The dominant anti-pattern is "reset draft state from props when a sheet opens" — which a `key` remount or plain derived state handles without an effect:

`components/placard/PlacardDetailsSheet.tsx:41-47` (five `setDraft*` calls) · `components/placard/EditStepsSheet.tsx:85-88` · `components/SpanishTranslationSheet.tsx:32-36` · `components/BatchPrintModal.tsx:40-49` · `components/equipment/AddEquipmentDialog.tsx:79-85` (pure derived state computed via effect, with the derived value in its own dep array) · `components/AppChrome.tsx:56` (route-change side effect belonging in the nav handler).

There are 11 inline `eslint-disable` comments for react-hooks rules across 10 files — low enough to review individually rather than treat as a class.

---

## 7. Reproducing these numbers

Run from the repo root. Each command maps to a claim above.

```bash
# §3.1 forwardRef — expect 3
grep -rn "forwardRef" --include=*.tsx --include=*.ts apps/ | grep -v node_modules

# §3.2 react-test-renderer — expect 2 (dependency + import)
grep -rn "react-test-renderer" apps/mobile/package.json apps/mobile/components

# §3.3 Context.Provider — expect 14 raw, minus tooltip.tsx (third-party) and
#      TenantProvider.tsx:268 (comment) = 12 real sites
grep -rEn "<[A-Za-z_]+\.Provider" --include=*.tsx apps/ | grep -v node_modules

# §6.0 headline counts
grep -rl "'use client'" --include=page.tsx apps/web/app | wc -l    # 238
find apps/web/app -name page.tsx | wc -l                           # 288
find apps/web/app -name loading.tsx | wc -l                        # 0
grep -rn "useActionState\|useFormStatus\|useOptimistic\|useEffectEvent\|\
useSyncExternalStore\|useDeferredValue" --include=*.tsx --include=*.ts \
  apps/ packages/ | grep -v node_modules | wc -l                   # 0

# §5 the clean list — every one of these should return nothing
grep -rn "findDOMNode\|ReactDOM.render\|unmountComponentAtNode\|createFactory\|\
\.propTypes\|defaultProps =\|react-dom/test-utils\|React\.FC\|: JSX\.Element" \
  --include=*.tsx --include=*.ts apps/ packages/ | grep -v node_modules
```

Note that `grep -rl "'use client'"` counts files whose *content* contains the directive; `apps/web/__tests__` is excluded from the 475 figure in §6.0 but not from an unfiltered run.

---

## 8. Sequenced plan

| # | Item | Tier | Effort | Risk | Notes |
|---|---|---|---|---|---|
| 1 | `SignaturePad` → ref-as-prop | 1 | ~1h | Low | 3 call sites unchanged |
| 2 | `ui/form.tsx` `Slot` → ref-as-prop | 1 | ~2h | **Medium** | Ref-collision nuance; add a test |
| 3 | Delete dead `react-test-renderer` scaffold | 1 | ~15m | None | Or fold into #6 |
| 4 | `<Ctx.Provider>` → `<Ctx>` sweep | 1 | ~1h | Low | 12 sites, mechanical |
| 5 | Align mobile React 19.1.0 → 19.2.4 | 2 | ~1h | Medium | **Blocks #6.** Touches install for both apps |
| 6 | Mobile test harness (`jest-expo` + RNTL) | 2 | ~1d | Low | Blocked by #5. Justified by `mobile-parity-plan.md` |
| 7 | CI: run `test`, `test:core`, `lint` | 2 | ~2h | Low | Highest safety-per-hour item here |
| 8 | ESLint config for `apps/mobile` | 2 | ~2h | Low | Pairs with #7 |
| 9 | Declare `@testing-library/dom`, add mobile `@types/react-dom`, drop root `expo-router`, refresh lockfile version | 2 | ~1h | Low | Single dependency-hygiene PR |
| 10 | `vitest.setup.ts`: explicit `cleanup()` | 2 | ~15m | None | Removes a silent trap |
| 11 | `useEffectEvent` at the 5 polyfill sites | 3 | ~3h | Low | Net code deletion |
| 12 | `useSyncExternalStore` at 4 sites | 3 | ~4h | Low | Fixes a hydration shape |
| 13 | `generateMetadata` per route | 3 | ~1d | Low | Incremental, route by route |
| 14 | React Compiler | 3 | ~2d + soak | Medium | **Verify the Next 16 config key first** |
| 15 | Form actions (`useActionState`) | 3 | multi-PR | Medium | Decide `react-hook-form` in or out |
| 16 | RSC conversion | 3 | multi-quarter | High | Sequence behind the performance audit |

Items 1-4 and 7-10 are independently shippable and do not interact. Item 5 blocks item 6. Items 14-16 are a program, not a PR.

---

## 9. Related documents

- `apps/web/eslint.config.mjs:18-53` — the `set-state-in-effect` rationale; already states §6's re-enable conditions
- `docs/performance-audit-2026-05-13.md` — same root cause (client-component density) from the performance side
- `docs/audits/scale-audit-6500-users.md` — the dashboard fan-out that RSC conversion would collapse
- `docs/mobile-parity-plan.md` — why `apps/mobile` deserves a test harness rather than a deleted scaffold
- `apps/web/docs/react-patterns-cheatsheet.md` — the in-repo teaching doc; §7 still teaches `<Ctx.Provider>` and it predates every React 19 API listed here
