// Copies a dotenv file (e.g. the production values from Vercel) into the
// soteria/web/env secret, replacing its previous contents.
//
//   npm run sync-env -- path/to/.env.production
//
// Empty values are dropped rather than stored, because the app treats an
// empty string as set, and so are Vercel's own system variables, which
// `vercel env pull` includes. Fails before writing anything if a required
// key is missing.
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { isVercelSystemKey, runtimeSecretKeys } from '../lib/runtimeEnv'

const SECRET_ID = 'soteria/web/env'

export function secretValuesFromDotenv(contents: string): { values: Record<string, string>; dropped: string[] } {
  const values: Record<string, string> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(parseEnv(contents))) {
    if (!value || isVercelSystemKey(key)) dropped.push(key)
    else values[key] = value
  }
  return { values, dropped }
}

async function main(): Promise<void> {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: npm run sync-env -- <path to dotenv file>')

  const { values, dropped } = secretValuesFromDotenv(readFileSync(file, 'utf8'))
  const injected = runtimeSecretKeys(Object.keys(values))

  await new SecretsManagerClient({}).send(new PutSecretValueCommand({
    SecretId: SECRET_ID,
    SecretString: JSON.stringify(values),
  }))

  console.log(`Wrote ${Object.keys(values).length} keys to ${SECRET_ID}; ${injected.length} reach the container.`)
  if (dropped.length) console.log(`Skipped (empty or Vercel-only): ${dropped.join(', ')}`)
  console.log('Running tasks keep their old values until the next deploy.')
}

if (process.argv[1]?.endsWith('sync-env-secret.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
