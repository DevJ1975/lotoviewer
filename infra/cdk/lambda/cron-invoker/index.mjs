// Invoked by EventBridge with { path: '/api/cron/<job>' }. Calls the route the
// way Vercel Cron would and fails the invocation on a non-2xx response, so the
// Lambda error metric counts failed cron runs.
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

const secrets = new SecretsManagerClient({})
let internalSecret

// Cached for the life of the execution environment. A rotated secret is
// picked up on the next cold start.
async function getInternalSecret() {
  if (internalSecret) return internalSecret
  const { SecretString } = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.ENV_SECRET_ARN }))
  const value = JSON.parse(SecretString).INTERNAL_PUSH_SECRET
  if (!value) throw new Error('INTERNAL_PUSH_SECRET is not set in the env secret')
  internalSecret = value
  return value
}

export async function handler(event) {
  if (typeof event?.path !== 'string' || !event.path.startsWith('/api/cron/')) {
    throw new Error(`Refusing to call non-cron path: ${JSON.stringify(event?.path)}`)
  }
  const url = new URL(event.path, process.env.APP_BASE_URL)
  const startedAt = Date.now()
  const response = await fetch(url, {
    headers: { 'x-internal-secret': await getInternalSecret() },
    signal: AbortSignal.timeout(Number(process.env.REQUEST_TIMEOUT_MS)),
  })
  const body = (await response.text()).slice(0, 2000)
  console.log(JSON.stringify({ path: event.path, status: response.status, durationMs: Date.now() - startedAt, body }))
  if (!response.ok) throw new Error(`${event.path} responded ${response.status}`)
}
