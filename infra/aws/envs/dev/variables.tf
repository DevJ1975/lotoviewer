variable "aws_region" {
  description = "Region for dev resources."
  type        = string
  default     = "us-west-2"
}

variable "environment" {
  description = "Environment name used in resource names and tags."
  type        = string
  default     = "dev"
}

variable "github_owner" {
  description = "GitHub user or organization that owns the repository."
  type        = string
  default     = "DevJ1975"
}

variable "github_repo" {
  description = "GitHub repository whose workflows may assume the plan role."
  type        = string
  default     = "lotoviewer"
}

variable "state_bucket_name" {
  description = "Terraform state bucket created by the bootstrap stack."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly spend limit that triggers alerts, in USD."
  type        = number
  default     = 50

  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be greater than zero."
  }
}

variable "budget_alert_emails" {
  description = "Addresses that receive budget alerts."
  type        = list(string)

  validation {
    condition     = length(var.budget_alert_emails) > 0
    error_message = "At least one budget alert email is required, otherwise the budget alerts nobody."
  }
}
