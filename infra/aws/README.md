# Soteria Field on AWS — infrastructure

Terraform for the AWS build-out described in
[`docs/aws-migration/PLAN.md`](../../docs/aws-migration/PLAN.md). Production
stays on Vercel and Supabase until cutover; nothing here touches it.

| Path | Purpose | Applied by |
| --- | --- | --- |
| `bootstrap/` | S3 bucket that stores Terraform state for every other stack | A human, once per AWS account |
| `envs/dev/` | Dev account baseline: spend budget, GitHub sign-in (OIDC), read-only CI plan role | A human, via SSO |

CI (`.github/workflows/infra-aws.yml`) formats and validates both stacks on
every change, and runs `terraform plan` for `envs/dev` once the variables
listed in that workflow are set.

## One-time setup (human steps)

1. Create a **separate AWS account for dev** (AWS Organizations). Turn on MFA for
   the root user, then stop using root.
2. Enable **IAM Identity Center** and sign in to the CLI with
   `aws sso login` — no long-lived access keys.
3. Bootstrap the state bucket:
   ```bash
   cd infra/aws/bootstrap
   terraform init && terraform apply
   ```
4. Apply the dev baseline:
   ```bash
   cd infra/aws/envs/dev
   cp backend.hcl.example backend.hcl        # fill in the bucket from step 3
   terraform init -backend-config=backend.hcl
   terraform apply \
     -var 'state_bucket_name=soteria-tfstate-<account-id>' \
     -var 'budget_alert_emails=["you@example.com"]'
   ```
5. Add the four repository variables named in the workflow header, using the
   outputs from steps 3 and 4. Confirm the budget's email subscription when AWS
   sends the confirmation message.

## Security model

- **No stored AWS keys.** GitHub Actions trades its short-lived token for AWS
  credentials. The role trusts only `pull_request` runs of this repository.
- **The plan role is metadata-only** (`ViewOnlyAccess` plus a few reads). Any
  pull request can assume it, so it must never be able to read S3 objects or
  database rows. If the first real `plan` reports an access-denied error, add
  the single missing read action to `plan_extra_reads`; do not widen the role.
- **Apply is manual** for now. An apply role, limited to `main` and a protected
  GitHub environment, comes with the first stack that needs it.
- **State** is versioned, encrypted, private and TLS-only. State can contain
  secrets in later phases; never commit it.

## Provider lock files

`.terraform.lock.hcl` is committed with checksums for Linux and macOS (Intel and
Apple Silicon). When the provider version changes, regenerate them:

```bash
terraform providers lock -platform=linux_amd64 -platform=linux_arm64 \
  -platform=darwin_arm64 -platform=darwin_amd64
```

## Cost notes

Fargate, load balancers, NAT gateways and RDS bill by the hour even when idle.
The monthly budget defaults to $50 and alerts at 50%, 80% and 100% of actual
spend and at 100% of forecast. Check the AWS Pricing Calculator before adding
each phase's resources, and stop or destroy dev resources you are not using.
