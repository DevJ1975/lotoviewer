terraform {
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # Bucket and region are supplied at init time (see backend.hcl.example)
  # because a backend block cannot read variables. `use_lockfile` makes S3
  # itself the lock, so no DynamoDB table is needed.
  backend "s3" {
    key          = "dev/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }
}
