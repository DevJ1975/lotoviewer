---
name: aws-devops
description: Safe, repeatable workflow for AWS DevOps tasks — reviewing or writing Terraform/CDK/CloudFormation, setting up CI/CD with GitHub Actions OIDC, hardening IAM and networking, diagnosing a failed deploy or outage, and trimming AWS cost. Run when the user mentions AWS, IaC, ECS/EKS/Lambda, CloudWatch, IAM, or a deploy pipeline. Read-only until the user approves a specific change.
---

# aws-devops — Safe AWS change workflow

A repeatable workflow for AWS infrastructure and delivery work. The
core idea: **look before you touch, change one small thing, and always
know how to undo it.** For deeper judgment calls, hand the work to the
`aws-devops-engineer` agent.

## When to use

- Writing or reviewing Terraform, CDK, or CloudFormation.
- Building or fixing a CI/CD pipeline that deploys to AWS.
- IAM, VPC, or security-group design and review.
- A failed deploy, an alarm, or an outage on AWS.
- A cost spike or a "why is this bill so high" question.

## Ground rules

- **Read-only first.** Discovery is free; mutation needs approval of the
  exact command.
- **Never print secrets.** Redact keys, tokens, and connection strings.
- **Production gets a confirmation.** Echo account ID, region, and
  resource names before any prod change.
- **Honest about limits.** If AWS credentials or the CLI are not
  available in this session, say so and produce the IaC and a command
  list for the user to run instead of guessing at live state.

## Phase 0 — Orient

```bash
aws sts get-caller-identity          # which account and principal?
aws configure list                   # which profile and region?
git status && git log --oneline -5   # what is the repo state?
```

Then locate the repo's IaC and pipelines (`**/*.tf`, `cdk.json`,
`template.y*ml`, `.github/workflows/*`). Summarize in a few lines:
account, region, environment, IaC tool, how deploys happen.

## Phase 1 — Discover (read-only)

Pick what fits the task:

| Question | Commands |
| --- | --- |
| What would change? | `terraform plan` · `cdk diff` · `aws cloudformation describe-change-set` |
| Is there drift? | `terraform plan -refresh-only` · `aws cloudformation detect-stack-drift` |
| Why did a deploy fail? | `aws ecs describe-services` · `aws cloudformation describe-stack-events` · CodeDeploy deployment details |
| What do logs say? | `aws logs tail <group> --since 1h` · CloudWatch Logs Insights |
| What does a role allow? | `aws iam get-role` · `aws iam simulate-principal-policy` · Access Analyzer |
| Where is the money going? | `aws ce get-cost-and-usage` (group by service, then usage type) |

## Phase 2 — Assess

Write down, in this order:

1. **Finding or goal** in one sentence.
2. **Blast radius**: what breaks if the change is wrong?
3. **Rollback**: the exact steps to undo it.
4. **Verification**: the exact check that proves it worked.

If any of the four cannot be written, stop and gather more information.

## Phase 3 — Review checklist

Run through only the sections relevant to the change.

**IAM**
- [ ] No `"Action": "*"` / `"Resource": "*"` on write actions
- [ ] Workloads use roles; no long-lived access keys
- [ ] CI uses OIDC with a trust policy scoped to repo and branch/env
- [ ] Conditions used where they narrow scope (`aws:SourceArn`, region)

**Network**
- [ ] Only load balancers are internet-facing
- [ ] Security groups reference security groups, not `0.0.0.0/0`
- [ ] Gateway endpoints for S3/DynamoDB; NAT cost considered
- [ ] Data stores in isolated subnets

**Data and reliability**
- [ ] Encryption at rest (KMS) and in transit
- [ ] Backups on, retention set, restore tested
- [ ] Deletion protection / `prevent_destroy` on stateful resources
- [ ] Multi-AZ where the availability target requires it

**Delivery**
- [ ] Immutable artifact promoted (digest, not `latest`)
- [ ] Health-gated deploy with automatic rollback
- [ ] Secrets from Secrets Manager / SSM, not plaintext variables
- [ ] `plan`/`diff` output reviewed in the pull request

**Observability and cost**
- [ ] Alarms on user-visible symptoms, each linking a runbook
- [ ] Log groups have a retention period
- [ ] Resources tagged (`env`, `service`, `owner`, `cost-center`)
- [ ] Budget and anomaly alert exist for the account

## Phase 4 — Change (with approval)

1. Edit the IaC, not the console. Keep the diff small.
2. Show the plan/diff and the exact mutating commands. **Wait for an
   explicit yes.**
3. Apply the smallest step; verify; continue.
4. Never use `--auto-approve`, `--force`, or `destroy` without a
   specific, explicit approval.

## Phase 5 — Verify and record

- Run the verification from Phase 2 and report the actual result.
- Confirm no drift remains (`plan` shows no changes).
- Update the runbook or alarm if the change affects operations.
- Summarize: what changed, what was verified, what remains.

## Incident mode

When something is down, invert the order:

1. **Stabilize**: roll back, fail over, or scale before root-causing.
2. **Preserve evidence**: capture log and metric windows.
3. **Diagnose** with read-only commands from Phase 1.
4. **Communicate** status on a fixed cadence.
5. **Follow up**: blameless review with owned, dated action items.

## Output template

```markdown
## Context
Account / region / environment · IaC tool · deploy path

## Findings
1. [Sev] Finding — evidence (path:line or command output)

## Proposed change
What and why. Smallest first step.

## Blast radius · Rollback · Verification

## Commands awaiting approval
(none executed)

## Not verified
Anything you could not confirm, and how to confirm it.
```
