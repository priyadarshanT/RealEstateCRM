# Production on the starter size (one server, PostgreSQL on its own data volume): fits the AWS free credits.
# Switch size to "launch" when paying clients grow (Technology Plan v1.2: two servers, RDS Multi-AZ).
#
#   terraform init -backend-config="bucket=crm-terraform-state-<account id>"
#   terraform apply -var-file=production.tfvars

terraform {
  required_version = ">= 1.10"
  backend "s3" {
    key          = "production/terraform.tfstate"
    region       = "eu-north-1"
    use_lockfile = true
    encrypt      = true
  }
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

provider "aws" {
  region = "eu-north-1"
  default_tags {
    tags = { Project = "crm" }
  }
}

module "crm" {
  source             = "../../modules/crm"
  environment        = "production"
  size               = var.size
  web_domain         = var.web_domain
  api_domain         = var.api_domain
  mail_domain        = var.mail_domain
  mail_from          = var.mail_from
  alert_emails       = var.alert_emails
  monthly_budget_usd = var.monthly_budget_usd
}

variable "size" {
  type    = string
  default = "starter"
}
variable "web_domain" { type = string }
variable "api_domain" { type = string }
variable "mail_domain" { type = string }
variable "mail_from" { type = string }
variable "alert_emails" { type = list(string) }
variable "monthly_budget_usd" {
  type    = number
  default = 25
}

output "crm" {
  value = module.crm
}
