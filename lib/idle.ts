// Pure helpers for idle-logout timing. Kept out of the React component so
// the math can be unit-tested without rendering.
//
// Timeline (defaults: 30 min idle, 60 s warning):
//   t=0                 last activity
//   t=29 min            'active' state (no warning)
//   t=29 min, 1 sec     'warning' state with 59 seconds remaining
//   t=30 min            'expired' state — caller should sign out

export type IdleState =
  | { kind: 'active' }
  | { kind: 'warning'; secondsLeft: number }
  | { kind: 'expired' }

export interface IdleParams {
  idleMs:    number
  warningMs: number
}

export function computeIdleState(
  now: number,
  lastActivityAt: number,
  { idleMs, warningMs }: IdleParams,
): IdleState {
  const idleFor = Math.max(0, now - lastActivityAt)
  if (idleFor >= idleMs) return { kind: 'expired' }
  const remainingMs = idleMs - idleFor
  if (remainingMs >= warningMs) return { kind: 'active' }
  // Floor + clamp to 1 so the user always sees "1s" rather than "0s" before
  // the next tick triggers expiry.
  const secondsLeft = Math.max(1, Math.ceil(remainingMs / 1000))
  return { kind: 'warning', secondsLeft }
}
