# AWS hosting for apps/web

A second production host for the web app, built to become the primary one.
Vercel keeps running unchanged until the cutover at the end of this page.
Supabase, Anthropic, Resend, Sentry and Voyage stay where they are; only
the Next.js server moves.

```
GitHub Actions ──push──▶ ECR (soteria/web)
      │                      │
      └─cdk deploy──▶ ECS Fargate service (2–6 tasks, private subnets)
                             ▲
Route 53 ─▶ ALB (HTTPS, 330 s timeout) ─┘      EventBridge (29 rules) ─▶ cron Lambda ─▶ /api/cron/*
                             │
                Secrets Manager: soteria/web/env
```

| Path | What it is |
| --- | --- |
| `../Dockerfile` | Production image (Next.js standalone output) |
| `../.github/workflows/deploy-web-aws.yml` | Build, push and deploy after "Repo health" passes on `main` |
| `cdk/lib/foundationStack.ts` | ECR repository, env secret, GitHub deploy role. Deployed by a person. |
| `cdk/lib/webStack.ts` | VPC, ALB, Fargate service, autoscaling, cron schedules. Deployed by CI. |
| `cdk/lib/runtimeEnv.ts` | Which secret keys are required |
| `cdk/lib/vercelCrons.ts` | Reads `apps/web/vercel.json`, so cron schedules have a single source |

## One-time setup

You need the AWS CLI signed in to the target account, Node 20, and admin
rights in that account for the first deploy.

**Shortcut:** `infra/aws-setup.sh` runs steps 2 to 5 below in one go (and
starts the first deploy when the `gh` CLI is signed in). Do step 1 first if
you want HTTPS from the start; otherwise run it as is and add the domain
later.

```bash
cd infra/cdk && npm ci
export AWS_REGION=us-east-1                      # or your region
npx cdk bootstrap                                # once per account and region
```

**1. Domain (recommended).** HTTPS and the cron schedules need a Route 53
hosted zone. If the main domain's DNS lives elsewhere, delegate a subdomain
(for example `aws.example.com`) to Route 53. Then set both values in
`cdk/cdk.json`:

```json
"domainName": "app.aws.example.com",
"hostedZoneName": "aws.example.com"
```

Leave both empty to start on the load balancer's own `http://…elb.amazonaws.com`
address for a first look. Don't sign in with real accounts over plain HTTP.

**2. Foundation stack.** If the account already has a GitHub OIDC provider,
put its ARN in `existingGithubOidcProviderArn` first (an account can only
have one).

```bash
npx cdk deploy SoteriaFoundation
```

Note the `DeployRoleArn` output.

**3. Configuration.** Pull the production values from Vercel, adjust them
for AWS, load them into Secrets Manager, then delete the file:

```bash
vercel env pull .env.aws --environment=production
# edit .env.aws: NEXT_PUBLIC_APP_URL=https://<your AWS domain>
npm run sync-env -- .env.aws
rm .env.aws
```

The script refuses to write if a required key is missing, and it drops
empty values, because the app treats an empty string as a real setting.
The deploy injects exactly the keys present in the secret.

**4. Pin lookups.** CDK looks up availability zones and the hosted zone once,
and records the answers in `cdk.context.json`. Commit that file so CI deploys
are deterministic:

```bash
npx cdk synth SoteriaWeb -c imageTag=lookup \
  -c secretKeys="$(aws secretsmanager get-secret-value --secret-id soteria/web/env --query SecretString --output text | jq -c keys)"
git add cdk.context.json
```

**5. GitHub.** Under Settings → Secrets and variables → Actions → Variables,
add `AWS_DEPLOY_ROLE_ARN` (from step 2) and `AWS_REGION`. Until both exist,
the deploy workflow skips itself. Start the first deploy from
Actions → "Deploy web (AWS)" → Run workflow.

**6. Supabase.** Under Authentication → URL Configuration, add the AWS URL
to the redirect URLs. Otherwise sign-in and invite links fail on AWS.

## Day to day

- **Deploys:** every push to `main` that passes "Repo health" deploys
  automatically. New tasks must pass `/api/health` before old ones drain. If
  they don't, ECS rolls back by itself.
- **Logs:** CloudWatch log group `/soteria/web`. Cron runs log to the
  `CronInvoker` function's log group.
- **Changing configuration:** run `npm run sync-env`, then redeploy. Running
  tasks keep the values they started with.
- **Rollback:** `npx cdk deploy SoteriaWeb --exclusively -c imageTag=<earlier tag> -c secretKeys=…`
  using a tag listed in ECR. The last 30 images are kept.

## Cutover: making AWS the primary host

1. Smoke-test on the AWS URL: sign-in, tenant switch, photo upload, placard
   PDF signing, the assistant, and push notifications.
2. Switch the crons over in one window, so no job runs twice or not at all:
   - set `"enableCrons": true` in `cdk/cdk.json`, merge, and let it deploy;
   - right after, disable crons in Vercel (Project → Settings → Cron Jobs).
     Leave `vercel.json` as it is, because the AWS schedules are generated
     from it.
3. Point every inbound webhook (Supabase database webhooks for push
   dispatch, and any other integration) at the AWS domain.
4. Move the production domain: add it to `domainName` / `hostedZoneName`
   (or keep the delegated name and CNAME the apex to it), update
   `NEXT_PUBLIC_APP_URL`, and set `ALLOWED_ORIGIN_HOSTS` if more than one
   hostname serves the app.
5. Keep Vercel deployable for a week as the rollback path. Rolling back means
   pointing DNS back and re-enabling Vercel's crons.

## Differences from Vercel worth knowing

- **Static assets** are served by the containers, not an edge CDN. Add
  CloudFront in front of the ALB if users far from the region notice.
- **Rate limits** in `lib/rateLimit/memory.ts` count per task, so with N
  tasks a caller gets up to N× the limit. Vercel already behaves this way
  across function instances.
- **No preview deployments.** Vercel previews keep doing that job.
- **Sentry** reports AWS events as environment `aws-production` (the
  `deployEnvironment` value in `cdk.json`), separate from Vercel's
  `production`. Change it to `production` at cutover if you prefer.
- **Cost** is roughly $130–150 a month at the default size: two 1 vCPU / 2 GB
  tasks (~$72), the load balancer (~$20), the NAT gateway (~$35), plus
  logs, metrics and data transfer.
