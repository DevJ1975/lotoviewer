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

// ResizeObserver is used by Recharts' ResponsiveContainer — not available in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

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
