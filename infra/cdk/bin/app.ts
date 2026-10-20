import * as path from 'node:path'
import * as cdk from 'aws-cdk-lib'
import { FoundationStack } from '../lib/foundationStack'
import { runtimeSecretKeys } from '../lib/runtimeEnv'
import { loadVercelCrons } from '../lib/vercelCrons'
import { WebStack } from '../lib/webStack'

const app = new cdk.App()
const context = (key: string): string => String(app.node.tryGetContext(key) ?? '').trim()
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }

const foundation = new FoundationStack(app, 'SoteriaFoundation', {
  env,
  githubRepo: context('githubRepo'),
  existingGithubOidcProviderArn: context('existingGithubOidcProviderArn') || undefined,
})

// The web stack needs an image to run and the secret's key list to inject,
// and the deploy workflow supplies both. Without them only the foundation is
// synthesized, which is all the one-time bootstrap needs.
const imageTag = context('imageTag')
if (imageTag) {
  const domainName = context('domainName')
  const hostedZoneName = context('hostedZoneName')
  if (Boolean(domainName) !== Boolean(hostedZoneName)) {
    throw new Error('Set domainName and hostedZoneName together, or neither')
  }

  new WebStack(app, 'SoteriaWeb', {
    env,
    repository: foundation.repository,
    envSecret: foundation.envSecret,
    imageTag,
    commitSha: context('commitSha') || imageTag,
    secretKeys: runtimeSecretKeys(JSON.parse(context('secretKeys') || '[]') as string[]),
    deployEnvironment: context('deployEnvironment'),
    domain: domainName ? { domainName, hostedZoneName } : undefined,
    // Off until cutover: while Vercel is primary its crons are already
    // running, and a second scheduler would send every reminder twice.
    crons: context('enableCrons') === 'true'
      ? loadVercelCrons(path.join(__dirname, '../../../apps/web/vercel.json'))
      : undefined,
  })
}
