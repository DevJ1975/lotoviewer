# React Patterns Cheat-Sheet

Living reference for the React patterns we use across this codebase,
written for someone learning React. Where to look in the actual code is
called out so you can read working examples.

Each section answers: **what is it, when to use it, what bugs it
prevents, and where in this repo it's used.**

---

## 1. `useState` — when JSX needs to react to a value

```tsx
const [count, setCount] = useState(0)
return <button onClick={() => setCount(c => c + 1)}>{count}</button>
```

- **Drives re-render.** Setting state schedules a re-render with the new value.
- The callback form (`setX(prev => ...)`) is safer when the next value
  depends on the previous one — it avoids stale-closure bugs when
  multiple updates fire quickly.

**Where in this repo:**
- Almost every `'use client'` component
- `components/TenantProvider.tsx` — `available`, `tenantId`, `loading`
- `app/superadmin/tenants/[number]/_components/MembersSection.tsx` —
  every form field + the optimistically-removed set

**Common bug**: mutating state directly. `setX({...x, foo: 1})` works,
`x.foo = 1; setX(x)` doesn't trigger a re-render (same reference).

---

## 2. `useRef` — for non-render data and "latest value" snapshots

```tsx
const timerRef = useRef<NodeJS.Timeout | null>(null)
const latestValueRef = useRef(value)
useEffect(() => { latestValueRef.current = value }, [value])
```

- **Does NOT trigger re-render.**
- Use for: timer/interval handles, "did this fire yet" flags, mutable
  values that callbacks need to read without going through closures.

**Where in this repo:**
- `app/superadmin/tenants/[number]/_components/UndoToast.tsx` —
  `dismissedRef` + `committedRef` so cleanup callbacks see the latest
  values, not stale closures
- `components/AppChrome.tsx` — `wrapRef` for outside-click detection

**Common bugs**:
- **Setting `.current` and expecting a re-render** — won't happen. Use
  state for that.
- **Reading `.current` during render** — React's eslint plugin
  (`react-hooks/refs`) flags this. Refs aren't part of the render
  cycle; reading them during render means your component might not
  update when you expect.
- **Forgetting the mirror pattern** — if you need a ref that always has
  the latest state, you have to update it in a useEffect:
  ```tsx
  useEffect(() => { ref.current = state }, [state])
  ```

---

## 3. `useEffect` — running code after render

```tsx
useEffect(() => {
  // Side effect: fetch, subscribe, set up a timer, etc.
  return () => {
    // Cleanup: unsubscribe, clearTimeout, etc.
  }
}, [dep1, dep2])
```

- The function runs **after** every render where deps changed.
- The cleanup runs before the NEXT effect runs OR when the component unmounts.

**The deps array IS NOT optional.**
- `[]` → run once on mount, cleanup on unmount.
- `[a, b]` → run whenever `a` or `b` changes.
- (no deps array) → run after EVERY render (almost always wrong).

The `react-hooks/exhaustive-deps` lint rule will warn if you reference
something inside the effect that's not in the deps. **Listen to it** —
silencing it almost always hides a bug.

**Where in this repo:**
- `components/TenantProvider.tsx` — fetches memberships when `userId` changes
- `components/AppChrome.tsx` — registers/unregisters the drawer key handler
- `app/superadmin/tenants/[number]/_components/UndoToast.tsx` — three
  effects: commit timer, display tick, defensive unmount commit

**Common bugs**:
- **Stale closures**: the callback captures values from the render it
  was created in. If the effect doesn't re-run on the value's change,
  you read the old one. Either add the value to deps, OR use a ref
  mirror.
- **Forgetting to clean up subscriptions**: you'll leak listeners and
  may set state on an unmounted component (warning in dev).

---

## 4. `useCallback` — stable function identity

```tsx
const fetchData = useCallback(async () => {
  // ...
}, [dep])
```

- Returns the SAME function reference across renders unless deps change.
- Useful when the function goes into:
  - A useEffect deps array (so the effect doesn't re-fire on every render)
  - A useMemo's value (so child components don't see "new" props)
  - A child component's prop (same reason)

**Don't use it everywhere.** It has a small cost (the function + deps
check). Use it when something downstream actually needs the stability.

**Where in this repo:**
- `components/TenantProvider.tsx` — `fetchAll`, `switchTenant`, `refresh`
  are stable so consumers don't re-fire their effects on every render
- `app/superadmin/users/[user_id]/page.tsx` — `load` is wrapped so the
  useEffect that runs it has an honest deps array

---

## 5. `useMemo` — memoize expensive derived values

```tsx
const sorted = useMemo(() => bigArray.sort(), [bigArray])
```

- Re-computes only when deps change.
- Two reasons to use it:
  1. The computation is genuinely expensive.
  2. The output's identity stability matters (e.g. it's passed to a
     memoized child or to a Context provider).

**Where in this repo:**
- `components/TenantProvider.tsx` — wraps the Context `value` so
  consumers don't re-render every time TenantProvider renders
- `app/superadmin/tenants/[number]/_components/MembersSection.tsx` —
  `visibleMembers` derived from `members` + the optimistic set
- `app/superadmin/_components/AllMembersPanel.tsx` — `filtered` and
  `totals` derived from `users` + search query

**Common bug**: forgetting a dep. If you reference `members` inside the
factory but only put `[search]` in deps, the result will be stale.

---

## 6. Custom hooks — composing the above

```tsx
function useTenant() { return useContext(Ctx) }
```

- Just a function that calls hooks. **Convention**: name starts with `use`.
- Lets callers replace 3 lines of boilerplate with 1 import.
- Encapsulates the "what hooks does this need" — the caller doesn't have
  to know.

**Where in this repo:**
- `components/TenantProvider.tsx` — `useTenant()`
- `components/AuthProvider.tsx` — `useAuth()`
- `hooks/usePhotoUpload.ts` — wraps state + the upload pipeline

**RECOMMENDATION**: when a component does something that's reused
elsewhere (toast queue, forms, debouncing), extract it into a custom
hook in `hooks/`. Don't extract everything — only when it actually has
a second caller or is genuinely complex enough to deserve isolation.

---

## 7. Context — sharing state without prop-drilling

```tsx
const Ctx = createContext<MyShape>(defaultValue)
function Provider({ children }) { return <Ctx.Provider value={...}>{children}</Ctx.Provider> }
function useMe() { return useContext(Ctx) }
```

- `<Provider value={...}>` makes a value available to all descendants.
- `useContext(Ctx)` reads it from any descendant.
- **EVERY consumer re-renders when the Provider's `value` changes
  identity** — that's why we wrap value in useMemo.

**Where in this repo:**
- `components/AuthProvider.tsx` — current user + profile
- `components/TenantProvider.tsx` — active tenant
- `components/UploadQueueProvider.tsx` — offline upload queue

**Common bug**: passing a fresh object literal as `value`:
```tsx
<Ctx.Provider value={{ a, b }}>  // BAD: new object every render
```
Use useMemo to stabilize it.

---

## 8. Optimistic UI — feel snappy by lying briefly

The user clicks Delete. Two possible UX:
- A) Wait for the API → show a spinner → row disappears after 200ms.
- B) Hide the row INSTANTLY → fire the API in the background → if it
     fails, restore the row + show an error.

(B) is "optimistic UI." It's snappier because the user sees their
intent honored immediately.

**Pattern in this repo** (`MembersSection.tsx`):
1. Maintain a Set of "ids the user removed but the API hasn't acked yet."
2. Filter the rendered list through the set.
3. After the API call, reload the data. The set self-cleans for ids
   that have actually disappeared from the new data.
4. If an id is STILL in the new data (DB delete silently failed), keep
   it in the set anyway — UI must never lie about what the click did.

**LEARN**: with the `UndoToast` extension, the API call is also
DEFERRED. The optimistic hide is paired with a 30-second window where
the user can click Undo to cancel before the API even fires.

---

## 9. Deferred destruction with undo

When a destructive action is irreversible, give the user 30 seconds to
take it back BEFORE the API call fires.

**Pattern** (`UndoToast.tsx`):
1. On click, hide the row optimistically + show a toast.
2. The toast manages a setTimeout for `duration * 1000` ms.
3. If undo is clicked: cancel the timeout, restore the row, no API call.
4. If timeout fires: fire the API.
5. If the toast unmounts (navigation, swap to a new pending action)
   without either: defensively fire the API to preserve intent.

**Tricky bits worth understanding:**
- Use BOTH state and ref for the dismissed signal (see commented
  reasoning in the file).
- Single setTimeout for the commit (deterministic in tests). Separate
  setInterval for the display countdown (cosmetic only).
- Use `vi.useFakeTimers()` in tests so you don't wait 30s in real
  time.

---

## 10. The "render-prop wrapper" pattern

```tsx
<ModuleGuard moduleId="loto">{children}</ModuleGuard>
```

- A component that takes `children` and decides whether to render them
  OR replacement UI.
- Owns no real state — it just reads from a context (or props) and
  branches.
- Drops into any layout without changing the parent's structure
  because it returns `<>{children}</>` in the pass-through case.

**Where in this repo:**
- `components/ModuleGuard.tsx` — gates module routes by tenant flag
- `components/AuthGate.tsx` — gates routes by auth status

---

## When in doubt

1. **Start with state.** Add useEffect when you need a side effect.
2. **Add useCallback / useMemo only when something downstream cares
   about identity stability.** Premature memoization adds cost without
   benefit.
3. **Trust the linter.** `react-hooks/exhaustive-deps` and
   `react-hooks/rules-of-hooks` catch real bugs. Disabling them with
   `eslint-disable-next-line` is a code smell — try harder first.
4. **Refs are escape hatches.** Reach for state first. Reach for ref
   only when you specifically need to bypass the render cycle (timers,
   "latest value" snapshots, DOM nodes).
5. **Read the React docs**: https://react.dev/learn — the new docs are
   excellent. The "Adding Interactivity" section and "Escape Hatches"
   sections cover ~80% of what you'll hit day-to-day.
