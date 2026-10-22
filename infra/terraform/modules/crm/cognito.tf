# Amazon Cognito: one user pool for CRM users (every company), one for our owner console.
# Users are created only by the API (sign-up, team invites); there is no public self sign-up.
# A pre-token-generation trigger (V2) adds custom:tenant_id and email to the access token, which the API verifies
# (apps/api/src/core/auth/cognito-token-verifier.ts). Access-token customisation needs the Essentials tier
# (free up to 10,000 monthly active users).

data "archive_file" "pre_token" {
  type        = "zip"
  output_path = "${path.module}/.build/pre-token.zip"
  source {
    filename = "index.mjs"
    content  = <<-JS
      // Adds the company (tenant) ID and email to the access token.
      export const handler = async (event) => {
        const a = event.request.userAttributes || {};
        const claims = {};
        if (a['custom:tenant_id']) claims['custom:tenant_id'] = a['custom:tenant_id'];
        if (a.email) claims.email = a.email;
        event.response = { claimsAndScopeOverrideDetails: { accessTokenGeneration: { claimsToAddOrOverride: claims } } };
        return event;
      };
    JS
  }
}

resource "aws_iam_role" "pre_token" {
  name = "${local.name}-cognito-pre-token"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "pre_token_logs" {
  role       = aws_iam_role.pre_token.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "pre_token" {
  function_name    = "${local.name}-cognito-pre-token"
  role             = aws_iam_role.pre_token.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.pre_token.output_path
  source_code_hash = data.archive_file.pre_token.output_base64sha256
  timeout          = 5
  memory_size      = 128
  tags             = local.tags
}

resource "aws_cloudwatch_log_group" "pre_token" {
  name              = "/aws/lambda/${aws_lambda_function.pre_token.function_name}"
  retention_in_days = 14
  tags              = local.tags
}

locals {
  pools = {
    users = {
      name    = "${local.name}-users"
      mfa     = "OPTIONAL" # enforced per company by the "Require 2FA" setting
      invite  = "You have been invited to the CRM. Your username is {username} and your temporary password is {####}. Sign in at https://${var.web_domain}"
      tenant  = true
      cb_path = "/auth/callback"
      out     = "/login"
    }
    platform = {
      name    = "${local.name}-platform"
      mfa     = "ON" # our own team always uses two-factor
      invite  = "Owner console access. Username {username}, temporary password {####}. Sign in at https://${var.web_domain}/console"
      tenant  = false
      cb_path = "/auth/platform-callback"
      out     = "/console/login"
    }
  }
}

resource "aws_cognito_user_pool" "pool" {
  for_each                 = local.pools
  name                     = each.value.name
  user_pool_tier           = "ESSENTIALS"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.environment == "production" ? "ACTIVE" : "INACTIVE"
  mfa_configuration        = each.value.mfa

  software_token_mfa_configuration {
    enabled = true
  }

  admin_create_user_config {
    allow_admin_create_user_only = true
    invite_message_template {
      email_subject = "Your CRM account"
      email_message = each.value.invite
      sms_message   = each.value.invite
    }
  }

  password_policy {
    minimum_length                   = 10
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = false
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  dynamic "schema" {
    for_each = each.value.tenant ? [1] : []
    content {
      name                     = "tenant_id"
      attribute_data_type      = "String"
      mutable                  = false
      developer_only_attribute = false
      required                 = false
      string_attribute_constraints {
        min_length = 36
        max_length = 36
      }
    }
  }

  lambda_config {
    pre_token_generation_config {
      lambda_arn     = aws_lambda_function.pre_token.arn
      lambda_version = "V2_0"
    }
  }

  tags = local.tags
}

resource "aws_lambda_permission" "pre_token" {
  for_each      = aws_cognito_user_pool.pool
  statement_id  = "cognito-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pre_token.function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = each.value.arn
}

resource "random_string" "auth_domain" {
  length  = 6
  special = false
  upper   = false
}

resource "aws_cognito_user_pool_domain" "pool" {
  for_each     = aws_cognito_user_pool.pool
  domain       = "${local.name}-${each.key}-${random_string.auth_domain.result}"
  user_pool_id = each.value.id
}

# The web server exchanges the sign-in code for tokens, so the client keeps a secret (stored in SSM).
resource "aws_cognito_user_pool_client" "web" {
  for_each                             = aws_cognito_user_pool.pool
  name                                 = "${local.name}-${each.key}-web"
  user_pool_id                         = each.value.id
  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${var.web_domain}${local.pools[each.key].cb_path}"]
  logout_urls                          = ["https://${var.web_domain}${local.pools[each.key].out}"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 60
  id_token_validity                    = 60
  refresh_token_validity               = 30
  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
