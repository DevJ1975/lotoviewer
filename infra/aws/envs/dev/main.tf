provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "soteria-field"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  github_repository = "${var.github_owner}/${var.github_repo}"

  # Alert early on real spend, and once on the forecast so a runaway resource
  # is caught before the month ends.
  actual_spend_alert_percentages = [50, 80, 100]
}

# ── Spend guard ────────────────────────────────────────────────────────
# Fargate, load balancers, NAT gateways and RDS bill by the hour even when
# idle, so this is the first resource in the account.

resource "aws_budgets_budget" "monthly" {
  name         = "soteria-${var.environment}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = local.actual_spend_alert_percentages

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.budget_alert_emails
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_alert_emails
  }
}

# ── GitHub Actions sign-in without stored keys ─────────────────────────
# Workflows exchange a short-lived GitHub token for temporary AWS
# credentials, so no access key ever lives in repository secrets.

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "plan_role_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only pull-request runs of this repository may assume the role.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${local.github_repository}:pull_request"]
    }
  }
}

resource "aws_iam_role" "terraform_plan" {
  name               = "soteria-${var.environment}-terraform-plan"
  assume_role_policy = data.aws_iam_policy_document.plan_role_trust.json
}

# Any pull request in the repository can assume this role, so it is limited to
# resource METADATA. ViewOnlyAccess cannot read S3 objects or database rows,
# which later phases will fill with photos and tenant data.
resource "aws_iam_role_policy_attachment" "plan_view_only" {
  role       = aws_iam_role.terraform_plan.name
  policy_arn = "arn:aws:iam::aws:policy/job-function/ViewOnlyAccess"
}

data "aws_iam_policy_document" "plan_extra_reads" {
  statement {
    sid       = "ReadState"
    actions   = ["s3:GetObject"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}/${var.environment}/*"]
  }

  statement {
    sid       = "ListStateBucket"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.state_bucket_name}"]
  }

  # Configuration reads that Terraform's refresh needs and ViewOnlyAccess omits.
  statement {
    sid = "ReadResourceConfiguration"
    actions = [
      "budgets:ViewBudget",
      "iam:GetOpenIDConnectProvider",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListRolePolicies",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "plan_extra_reads" {
  name   = "plan-extra-reads"
  role   = aws_iam_role.terraform_plan.id
  policy = data.aws_iam_policy_document.plan_extra_reads.json
}
