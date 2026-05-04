import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // ── react-hooks/set-state-in-effect — disabled, see notes below ───
      //
      // The rule (new in eslint-plugin-react-hooks v6, default-on via
      // eslint-config-next 16) fires on the canonical data-fetching
      // pattern this codebase uses everywhere:
      //
      //   const load = useCallback(async () => {
      //     setLoading(true)              // ← sync setState before await
      //     try { setData(await fetch()) }
      //     finally { setLoading(false) }
      //   }, [deps])
      //   useEffect(() => { load() }, [load])
      //
      // The rule's concern ("calling setState synchronously within an
      // effect body causes cascading renders") is technically correct,
      // but in this shape the cascade is bounded — one re-render to
      // reflect loading=true, then the actual data setState happens
      // after `await` in a microtask, not in the effect body. 49 sites
      // across 46 files use this shape; refactoring to the
      // "loading-derived-from-data-presence" structural pattern is a
      // multi-PR project with real regression risk and near-zero
      // practical benefit (the renders are not actually problematic).
      //
      // Re-enable when one of these is true:
      //   1. We adopt the React Compiler (which auto-defers these
      //      synchronous setStates and the rule becomes useful again).
      //   2. We migrate the data-fetching layer to React 19's `use()` +
      //      Suspense + server components — at which point most of
      //      these sites stop needing useEffect at all.
      //   3. We start seeing real performance issues from the cascade
      //      and want the rule's pressure to push toward the structural
      //      fix.
      //
      // The rule itself is fine; it's just not the right enforcement
      // for this codebase's current architecture.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);

export default eslintConfig;
