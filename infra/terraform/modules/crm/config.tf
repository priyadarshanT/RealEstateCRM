# Runtime configuration in SSM Parameter Store. The servers load /crm/<env>/api/* and /crm/<env>/web/* into the
# containers' environment at each deploy. Secrets are SecureString. Values marked "set by hand" start as a
# placeholder; Terraform never overwrites them after you set the real value (ignore_changes).

resource "random_password" "db" {
  for_each = toset(["postgres", "crm_app", "crm_worker", "crm_platform"])
  length   = 32
  special  = false
}

resource "random_password" "oauth_state" {
  length  = 48
  special = false
}

resource "random_password" "session" {
  length  = 48
  special = false
}

locals {
  db_host = local.use_rds ? aws_db_instance.main[0].address : "postgres"
  db_url  = { for r in ["crm_app", "crm_worker", "crm_platform", "postgres"] : r => "postgres://${r}:${random_password.db[r].result}@${local.db_host}:5432/crm" }
  issuer  = { for k, p in aws_cognito_user_pool.pool : k => "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${p.id}" }

  api_config = {
    NODE_ENV                   = var.environment
    PORT                       = "4000"
    S3_BUCKET                  = aws_s3_bucket.files.bucket
    S3_REGION                  = data.aws_region.current.region
    SECRETS_MODE               = "ssm"
    PUBLIC_API_URL             = "https://${var.api_domain}"
    WEB_APP_URL                = "https://${var.web_domain}"
    AUTH_MODE                  = "cognito"
    COGNITO_ISSUER             = local.issuer.users
    COGNITO_CLIENT_ID          = aws_cognito_user_pool_client.web["users"].id
    COGNITO_USER_POOL_ID       = aws_cognito_user_pool.pool["users"].id
    PLATFORM_COGNITO_ISSUER    = local.issuer.platform
    PLATFORM_COGNITO_CLIENT_ID = aws_cognito_user_pool_client.web["platform"].id
    MAIL_MODE                  = "ses"
    MAIL_FROM                  = var.mail_from
    MESSAGING_MODE             = "live"
    CALENDAR_MODE              = "live"
    GOTENBERG_URL              = "http://gotenberg:3000"
  }
  api_secrets = {
    DATABASE_URL           = local.db_url.crm_app
    WORKER_DATABASE_URL    = local.db_url.crm_worker
    PLATFORM_DATABASE_URL  = local.db_url.crm_platform
    MIGRATION_DATABASE_URL = local.db_url.postgres
    OAUTH_STATE_SECRET     = random_password.oauth_state.result
  }
  # Set by hand once the outside accounts exist (aws ssm put-parameter ... --overwrite).
  api_manual = [
    "STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "TURNSTILE_SECRET", "META_APP_ID", "META_APP_SECRET", "META_VERIFY_TOKEN",
    "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "MICROSOFT_OAUTH_CLIENT_ID", "MICROSOFT_OAUTH_CLIENT_SECRET",
  ]
  # Public, but set by hand with its secret: the Cloudflare Turnstile widget's site key.
  web_manual = ["TURNSTILE_SITE_KEY"]

  web_config = {
    API_URL                    = "http://api:4000"
    AUTH_MODE                  = "cognito"
    WEB_APP_URL                = "https://${var.web_domain}"
    COGNITO_DOMAIN             = "https://${aws_cognito_user_pool_domain.pool["users"].domain}.auth.${data.aws_region.current.region}.amazoncognito.com"
    COGNITO_CLIENT_ID          = aws_cognito_user_pool_client.web["users"].id
    COGNITO_ISSUER             = local.issuer.users
    PLATFORM_COGNITO_DOMAIN    = "https://${aws_cognito_user_pool_domain.pool["platform"].domain}.auth.${data.aws_region.current.region}.amazoncognito.com"
    PLATFORM_COGNITO_CLIENT_ID = aws_cognito_user_pool_client.web["platform"].id
    PLATFORM_COGNITO_ISSUER    = local.issuer.platform
  }
  web_secrets = {
    COGNITO_CLIENT_SECRET          = aws_cognito_user_pool_client.web["users"].client_secret
    PLATFORM_COGNITO_CLIENT_SECRET = aws_cognito_user_pool_client.web["platform"].client_secret
    SESSION_SECRET                 = random_password.session.result
  }
}

resource "aws_ssm_parameter" "api_config" {
  for_each = local.api_config
  name     = "${local.ssm}/api/${each.key}"
  type     = "String"
  value    = each.value
  tags     = local.tags
}

resource "aws_ssm_parameter" "api_secret" {
  for_each = nonsensitive(toset(keys(local.api_secrets)))
  name     = "${local.ssm}/api/${each.key}"
  type     = "SecureString"
  value    = local.api_secrets[each.key]
  tags     = local.tags
}

resource "aws_ssm_parameter" "api_manual" {
  for_each = toset(local.api_manual)
  name     = "${local.ssm}/api/${each.key}"
  type     = "SecureString"
  value    = "unset"
  tags     = local.tags
  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "web_manual" {
  for_each = toset(local.web_manual)
  name     = "${local.ssm}/web/${each.key}"
  type     = "String"
  value    = "unset"
  tags     = local.tags
  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "web_config" {
  for_each = local.web_config
  name     = "${local.ssm}/web/${each.key}"
  type     = "String"
  value    = each.value
  tags     = local.tags
}

resource "aws_ssm_parameter" "web_secret" {
  for_each = nonsensitive(toset(keys(local.web_secrets)))
  name     = "${local.ssm}/web/${each.key}"
  type     = "SecureString"
  value    = local.web_secrets[each.key]
  tags     = local.tags
}

# Deploy-time settings read by the server scripts (not passed to the app).
# The release pipeline updates IMAGE_TAG after each deploy, so Terraform leaves its value alone.
resource "aws_ssm_parameter" "image_tag" {
  name  = "${local.ssm}/deploy/IMAGE_TAG"
  type  = "String"
  value = var.image_tag
  tags  = local.tags
  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "deploy" {
  for_each = {
    ECR_REGISTRY          = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.region}.amazonaws.com"
    DB_MODE               = local.s.db_mode
    BACKUP_BUCKET         = aws_s3_bucket.backups.bucket
    LOG_GROUP             = aws_cloudwatch_log_group.app.name
    POSTGRES_PASSWORD     = random_password.db["postgres"].result
    CRM_APP_PASSWORD      = random_password.db["crm_app"].result
    CRM_WORKER_PASSWORD   = random_password.db["crm_worker"].result
    CRM_PLATFORM_PASSWORD = random_password.db["crm_platform"].result
  }
  name  = "${local.ssm}/deploy/${each.key}"
  type  = "SecureString"
  value = each.value
  tags  = local.tags
}

# Cloudflare Tunnel token: create the tunnel in the Cloudflare dashboard, then put its token here.
resource "aws_ssm_parameter" "tunnel_token" {
  name  = "${local.ssm}/deploy/CLOUDFLARE_TUNNEL_TOKEN"
  type  = "SecureString"
  value = "unset"
  tags  = local.tags
  lifecycle {
    ignore_changes = [value]
  }
}
