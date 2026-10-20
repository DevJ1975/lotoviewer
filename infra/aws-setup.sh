#!/usr/bin/env bash
# One-time AWS setup for apps/web. Run it on your own machine, from anywhere
# inside the repository, signed in to AWS and Vercel (and GitHub, if you have
# the gh CLI):
#
#   infra/aws-setup.sh
#
# It does the manual steps in infra/README.md in order and stops at the first
# problem. Re-running is safe: every step is idempotent.
#
#   1. checks tools and sign-ins
#   2. cdk bootstrap
#   3. cdk deploy SoteriaFoundation (ECR repository, env secret, deploy role)
#   4. copies the Vercel production settings into the soteria/web/env secret
#   5. pins CDK's account lookups in infra/cdk/cdk.context.json
#   6. sets AWS_DEPLOY_ROLE_ARN and AWS_REGION on the GitHub repository and
#      starts the first deploy (with gh), or prints the values to set by hand
#
# Secrets only ever pass through temporary files that are deleted on exit.
set -euo pipefail

say()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is not installed. $2"; }

VERCEL_PROJECT=lotoviewer
SECRET_ID=soteria/web/env

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || fail "run this from inside the lotoviewer checkout"
cd "$repo_root"

say "Checking tools"
need node   "Install Node 20 or newer: https://nodejs.org"
need npm    "It comes with Node"
need aws    "Install the AWS CLI: https://docs.aws.amazon.com/cli/"
need vercel "npm install -g vercel"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' \
  || fail "Node 20 or newer is required (found $(node --version))"

say "Checking the AWS sign-in"
account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)" \
  || fail "the AWS CLI is not signed in. Run 'aws configure' or 'aws sso login' first."
region="${AWS_REGION:-${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || true)}}"
[ -n "$region" ] || fail "no AWS region is set. Run it as: AWS_REGION=us-east-1 infra/aws-setup.sh"
export AWS_REGION="$region" CDK_DEFAULT_ACCOUNT="$account" CDK_DEFAULT_REGION="$region"
echo "account $account, region $region"

say "Checking the Vercel sign-in"
vercel whoami >/dev/null 2>&1 || fail "the Vercel CLI is not signed in. Run 'vercel login' first."

outputs="$(mktemp)"
envfile="$(mktemp)"
trap 'rm -f "$outputs" "$envfile"' EXIT

say "Installing the CDK app"
(cd infra/cdk && npm ci --no-audit --no-fund)

say "Bootstrapping CDK in account $account ($region)"
(cd infra/cdk && npx cdk bootstrap "aws://$account/$region")

say "Deploying SoteriaFoundation"
(cd infra/cdk && npx cdk deploy SoteriaFoundation --require-approval never --outputs-file "$outputs")
role_arn="$(node -e 'process.stdout.write(require(process.argv[1]).SoteriaFoundation.DeployRoleArn ?? "")' "$outputs")"
[ -n "$role_arn" ] || fail "SoteriaFoundation deployed but produced no DeployRoleArn output"

say "Copying the Vercel production settings into Secrets Manager"
# vercel env pull needs a linked directory. Reuse an existing link (repo root
# or apps/web); otherwise link the root to the known project.
vercel_dir="$repo_root"
if [ -f apps/web/.vercel/project.json ] && [ ! -f .vercel/project.json ]; then
  vercel_dir="$repo_root/apps/web"
elif [ ! -f .vercel/project.json ]; then
  vercel link --yes --project "$VERCEL_PROJECT"
fi
(cd "$vercel_dir" && vercel env pull "$envfile" --environment=production --yes)
(cd infra/cdk && npm run --silent sync-env -- "$envfile")

say "Pinning CDK lookups"
secret_keys="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ID" --query SecretString --output text \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(Object.keys(JSON.parse(s)))))')"
# Also validates the secret against the app's required-key list before
# anything is deployed with it.
(cd infra/cdk && npx cdk synth SoteriaWeb --quiet -c imageTag=setup -c "secretKeys=$secret_keys" >/dev/null)
if [ -n "$(git status --porcelain infra/cdk/cdk.context.json)" ]; then
  echo "infra/cdk/cdk.context.json changed. Commit it so CI deploys are deterministic:"
  echo "  git add infra/cdk/cdk.context.json && git commit -m 'chore(infra): pin CDK context' && git push"
fi

say "GitHub repository variables"
slug="$(git remote get-url origin | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh variable set AWS_DEPLOY_ROLE_ARN --repo "$slug" --body "$role_arn"
  gh variable set AWS_REGION --repo "$slug" --body "$region"
  echo "set AWS_DEPLOY_ROLE_ARN and AWS_REGION on $slug"

  say "Starting the first deploy"
  gh workflow run deploy-web-aws.yml --repo "$slug" --ref main
  echo "Watch it at https://github.com/$slug/actions/workflows/deploy-web-aws.yml"
  echo "When it finishes, the app's address is the Url output of the SoteriaWeb stack:"
  echo "  aws cloudformation describe-stacks --stack-name SoteriaWeb --query 'Stacks[0].Outputs' --output table"
else
  echo "The gh CLI is not installed or not signed in, so set these two repository variables by hand"
  echo "(GitHub -> Settings -> Secrets and variables -> Actions -> Variables tab):"
  echo "  AWS_DEPLOY_ROLE_ARN = $role_arn"
  echo "  AWS_REGION          = $region"
  echo "Then open the Actions tab, choose 'Deploy web (AWS)' and press 'Run workflow'."
fi

say "Done"
