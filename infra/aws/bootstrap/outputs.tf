output "state_bucket_name" {
  description = "Pass to `terraform init -backend-config=\"bucket=...\"` in every other stack."
  value       = aws_s3_bucket.state.id
}
