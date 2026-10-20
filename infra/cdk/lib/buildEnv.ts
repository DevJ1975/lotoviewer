import { BUILD_ONLY_KEYS } from './runtimeEnv'

export interface BuildIdentity {
  commitSha: string
  deployEnvironment: string
}

// Next loads .env files through dotenv-expand, which rewrites `$NAME`, and
// dotenv itself treats quotes, `#` and backslashes specially. Rather than
// escape for both layers, refuse values that would not survive verbatim.
const UNSAFE_VALUE = /[\r\n"'`$#\\]/

/**
 * The dotenv file `next build` reads through the BuildKit secret mount:
 * browser-visible NEXT_PUBLIC_* values (inlined into the bundle), the Sentry
 * upload credentials, and the build's identity. Unset keys are omitted, never
 * written empty.
 */
export function buildEnvFile(secret: Record<string, unknown>, identity: BuildIdentity): string {
  const fromSecret = Object.entries(secret).filter(
    ([key, value]) => (key.startsWith('NEXT_PUBLIC_') || BUILD_ONLY_KEYS.has(key)) && value !== '',
  )
  const entries: [string, unknown][] = [
    ...fromSecret,
    // The app's Sentry and version code reads Vercel's variable names.
    ['NEXT_PUBLIC_VERCEL_ENV', identity.deployEnvironment],
    ['NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA', identity.commitSha],
    ['NEXT_PUBLIC_COMMIT_SHA', identity.commitSha],
    ['SENTRY_RELEASE', identity.commitSha],
  ]

  return entries
    .map(([key, value]) => {
      if (typeof value !== 'string') throw new Error(`${key} must be a string in the env secret`)
      if (UNSAFE_VALUE.test(value)) throw new Error(`${key} contains a character the .env loader would reinterpret`)
      return `${key}=${value}\n`
    })
    .join('')
}

/** Values GitHub Actions must redact from logs. NEXT_PUBLIC_* ship to every browser, so they are not secret. */
export function valuesToMask(secret: Record<string, unknown>): string[] {
  return Object.entries(secret)
    .filter(([key, value]) => !key.startsWith('NEXT_PUBLIC_') && typeof value === 'string' && value !== '')
    .map(([, value]) => value as string)
}
