// Copies a dotenv file (e.g. the production values from Vercel) into the
// soteria/web/env secret, replacing its previous contents.
//
//   npm run sync-env -- path/to/.env.production
//
// Empty values are dropped rather than stored, because the app treats an
// empty string as set. Fails before writing anything if a required key is
// missing.
import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { PutSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { runtimeSecretKeys } from '../lib/runtimeEnv'

const SECRET_ID = 'soteria/web/env'

async function main(): Promise<void> {
  const file = process.argv[2]
  if (!file) throw new Error('Usage: npm run sync-env -- <path to dotenv file>')

  const entries = Object.entries(parseEnv(readFileSync(file, 'utf8')))
  const values = Object.fromEntries(entries.filter(([, value]) => value !== ''))
  const dropped = entries.filter(([, value]) => value === '').map(([key]) => key)
  const injected = runtimeSecretKeys(Object.keys(values))

  await new SecretsManagerClient({}).send(new PutSecretValueCommand({
    SecretId: SECRET_ID,
    SecretString: JSON.stringify(values),
  }))

  console.log(`Wrote ${Object.keys(values).length} keys to ${SECRET_ID}; ${injected.length} reach the container.`)
  if (dropped.length) console.log(`Skipped empty: ${dropped.join(', ')}`)
  console.log('Running tasks keep their old values until the next deploy.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
