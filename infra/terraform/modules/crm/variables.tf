variable "environment" {
  description = "Environment name. Also used by the API for SSM paths (/crm/<environment>/...), so it must match NODE_ENV: staging or production."
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "size" {
  description = "starter: one server running the app and PostgreSQL (about USD 23/month, fits the AWS free credits). launch: Technology Plan v1.2 (two servers, RDS Multi-AZ)."
  type        = string
  default     = "starter"
  validation {
    condition     = contains(["starter", "launch"], var.size)
    error_message = "size must be starter or launch."
  }
}

variable "web_domain" {
  description = "Public address of the web app, e.g. crm.example.ae (served through Cloudflare Tunnel)."
  type        = string
}

variable "api_domain" {
  description = "Public address of the API for webhooks (Meta, portals, Stripe), e.g. api.crm.example.ae."
  type        = string
}

variable "mail_domain" {
  description = "Domain that emails are sent from (verified in SES with DKIM), e.g. example.ae."
  type        = string
}

variable "mail_from" {
  description = "Sender shown on CRM emails."
  type        = string
}

variable "alert_email" {
  description = "Email address that receives alarms and budget alerts."
  type        = string
}

variable "monthly_budget_usd" {
  description = "Monthly AWS budget; an email is sent at 80% of actual and 100% of forecast spend."
  type        = number
  default     = 25
}

variable "image_tag" {
  description = "Docker image tag the servers run (the release pipeline updates it in SSM)."
  type        = string
  default     = "latest"
}

variable "backup_retention_days" {
  description = "Days that daily snapshots and database backups are kept."
  type        = number
  default     = 14
}

locals {
  name = "crm-${var.environment}"
  sizes = {
    starter = { instance_type = "t4g.small", instance_count = 1, volume_gb = 30, db_mode = "container", db_class = null, db_multi_az = false }
    launch  = { instance_type = "t4g.small", instance_count = 2, volume_gb = 20, db_mode = "rds", db_class = "db.t4g.medium", db_multi_az = true }
  }
  s       = local.sizes[var.size]
  use_rds = local.s.db_mode == "rds"
  tags    = { Project = "crm", Environment = var.environment, ManagedBy = "terraform" }
  ssm     = "/crm/${var.environment}"
}
