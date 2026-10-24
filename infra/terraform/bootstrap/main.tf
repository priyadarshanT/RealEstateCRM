# One-time setup per AWS account, shared by every environment (staging, production):
# - the S3 bucket that stores Terraform state,
# - the container image registry (crm/api, crm/web): staging and production run the same images, so a release
#   tested on staging reaches production unchanged,
# - GitHub Actions' sign-in to AWS (OIDC): the pipeline gets short-lived credentials, no access keys in GitHub.
# Run once with local state:  terraform init && terraform apply
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

provider "aws" {
  region = "eu-north-1"
}

data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "state" {
  bucket = "crm-terraform-state-${data.aws_caller_identity.current.account_id}"
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Container images (built by .github/workflows/deploy-production.yml, tagged with the source tree hash).
resource "aws_ecr_repository" "app" {
  for_each             = toset(["api", "web"])
  name                 = "crm/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  image_scanning_configuration {
    scan_on_push = true
  }
  encryption_configuration {
    encryption_type = "AES256"
  }
  tags = { Project = "crm" }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images (staging and production share them)"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# GitHub Actions sign-in. The AWS Free plan blocks OIDC providers, so until the account leaves it the pipeline
# signs in with the deploy user below (docs/07-Deployment-Guide.md, Known gaps). After leaving the Free plan:
# set github_oidc = true, apply, move the pipeline to OIDC, then delete the deploy user's access key.
variable "github_oidc" {
  description = "Create the GitHub OIDC provider (not allowed on the AWS Free plan)."
  type        = bool
  default     = false
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.github_oidc ? 1 : 0
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

# Temporary pipeline user (Free plan only). It can push the two images, set IMAGE_TAG and run the
# crm-<env>-deploy document on the CRM servers; nothing else. Its access key is created in the AWS console
# and stored only as a GitHub environment secret.
resource "aws_iam_user" "github_deploy" {
  count = var.github_oidc ? 0 : 1
  name  = "crm-github-deploy"
  tags  = { Project = "crm" }
}

resource "aws_iam_user_policy" "github_deploy" {
  count = var.github_oidc ? 0 : 1
  name  = "deploy"
  user  = aws_iam_user.github_deploy[0].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "EcrLogin", Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Sid    = "EcrPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:CompleteLayerUpload", "ecr:DescribeImages",
          "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload", "ecr:PutImage", "ecr:UploadLayerPart",
        ]
        Resource = [for r in aws_ecr_repository.app : r.arn]
      },
      {
        Sid      = "ImageTag"
        Effect   = "Allow"
        Action   = "ssm:PutParameter"
        Resource = "arn:aws:ssm:eu-north-1:${data.aws_caller_identity.current.account_id}:parameter/crm/*/deploy/IMAGE_TAG"
      },
      { Sid = "FindServers", Effect = "Allow", Action = "ec2:DescribeInstances", Resource = "*" },
      {
        Sid      = "DeployDocument"
        Effect   = "Allow"
        Action   = "ssm:SendCommand"
        Resource = "arn:aws:ssm:eu-north-1:${data.aws_caller_identity.current.account_id}:document/crm-*-deploy"
      },
      {
        Sid       = "DeployServers"
        Effect    = "Allow"
        Action    = "ssm:SendCommand"
        Resource  = "arn:aws:ec2:eu-north-1:${data.aws_caller_identity.current.account_id}:instance/*"
        Condition = { StringEquals = { "ssm:resourceTag/Project" = "crm" } }
      },
      { Sid = "DeployResult", Effect = "Allow", Action = ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"], Resource = "*" },
    ]
  })
}

output "state_bucket" {
  value = aws_s3_bucket.state.bucket
}

output "ecr_registry" {
  value = "${data.aws_caller_identity.current.account_id}.dkr.ecr.eu-north-1.amazonaws.com"
}
