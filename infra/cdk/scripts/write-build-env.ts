// CI helper: reads the env secret JSON on stdin, prints `::add-mask::` lines so
// GitHub redacts every secret value, and writes the build dotenv file.
//
//   aws secretsmanager get-secret-value … | npx tsx scripts/write-build-env.ts <out-file>
//
// Expects COMMIT_SHA and DEPLOY_ENVIRONMENT in the environment.
import { readFileSync, writeFileSync } from 'node:fs'
import { buildEnvFile, valuesToMask } from '../lib/buildEnv'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

function main(): void {
  const outFile = process.argv[2]
  if (!outFile) throw new Error('Usage: write-build-env.ts <out-file>')

  const secret = JSON.parse(readFileSync(0, 'utf8')) as Record<string, unknown>
  for (const value of valuesToMask(secret)) console.log(`::add-mask::${value}`)

  const contents = buildEnvFile(secret, {
    commitSha: requireEnv('COMMIT_SHA'),
    deployEnvironment: requireEnv('DEPLOY_ENVIRONMENT'),
  })
  writeFileSync(outFile, contents, { mode: 0o600 })
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
