output "terraform_plan_role_arn" {
  description = "Set as the AWS_DEV_ROLE_ARN repository variable so CI can run `terraform plan`."
  value       = aws_iam_role.terraform_plan.arn
}

output "monthly_budget_name" {
  value = aws_budgets_budget.monthly.name
}
