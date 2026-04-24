// Cheap pre-flight check for write operations. `navigator.onLine` is the
// closest to "will this fetch reach the network" signal the browser gives
// us — it's not perfect (a captive-portal Wi-Fi reports `true`), but it's
// the exact signal that flips the global OfflineBanner, so using it as the
// same gate here keeps the UX coherent: if the banner says "offline", the
// mutation bails with a matching message instead of dispatching a fetch
// that'll hang on a dead connection until it times out.
//
// For the rare captive-portal case the fetch will still fail — the
// post-request error toast is the backstop. This guard's job is to catch
// the obvious case early (plane mode, lost Wi-Fi) and give a clearer
// message than "Could not save".
export function isOffline(): boolean {
  if (typeof navigator === 'undefined') return false
  return navigator.onLine === false
}

// The user-facing copy we use consistently at every mutation site so
// people don't see 6 variants of the same error across the app.
export const OFFLINE_WRITE_MESSAGE =
  "You're offline — changes can't be saved right now. Reconnect and try again."
