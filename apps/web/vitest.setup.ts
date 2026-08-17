import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { setActiveSupabaseClient } from '@soteria/core/supabaseClient'

// Register the (possibly vi.mock'd) `@/lib/supabase` client into
// @soteria/core's active-client registry before every test.
//
// Why: shared business logic in @soteria/core (queries/, metrics)
// imports the client through getActiveSupabaseClient(). Tests
// vi.mock('@/lib/supabase', ...) to swap in a fake `from()`; this
// hook re-imports the (mocked or real) module each time and
// installs whichever supabase the current test set up. Without
// this bridge, the moved code would throw "no Supabase client
// registered" because the register-on-import side effect in
// apps/web/lib/supabase.ts is bypassed when that module is mocked.
beforeEach(async () => {
  const mod = await import('@/lib/supabase')
  setActiveSupabaseClient(mod.supabase)
})

// Everything below patches gaps in jsdom, so it only applies under jsdom. A
// file opts out with `// @vitest-environment node` — right for a module with
// no DOM involvement, and required for anything reaching Web Crypto through
// @soteria/core, which jsdom rejects on Node 20 (see the header of
// __tests__/lib/signedArtifactHash.test.ts). Without this guard, opting out
// throws here at setup time before a single test runs.
if (typeof window !== 'undefined') {
  // ResizeObserver is used by Recharts' ResponsiveContainer — not available in jsdom
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // scrollIntoView is called by cmdk when it moves the command-palette
  // selection; jsdom implements no layout, so it ships no such method.
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? function () {}

  // matchMedia is not available in jsdom
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}
