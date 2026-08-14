terraform {
  required_version = ">= 1.8.0"
}

variable "environment" {
  type    = string
  default = "staging"
}

variable "region" {
  type    = string
  default = "us-east-1"
}

locals {
  deployment_name = "linqa-${var.environment}"
}

output "deployment_name" {
  value = local.deployment_name
}

# Provider-specific modules must supply managed PostgreSQL, Redis, private
# object storage, KMS/secrets, orchestration, load balancing, DNS/TLS, and
# backup vaults before this baseline represents deployable infrastructure.