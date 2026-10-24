# Portal lead emails (SRS §11): Property Finder, Bayut, Dubizzle and others email leads to an address on
# var.lead_email_domain (e.g. skyline@leads.example.ae). SES receives the mail and publishes it to SNS, which
# posts it to the API (POST /api/v1/webhooks/email-inbound; signature checked, routed by the To address to the
# company's portal connection). DNS (Cloudflare): the MX record and three DKIM CNAMEs from output lead_email_dns.
# Off when lead_email_domain is empty. One receipt rule set is active per account and region.

locals {
  lead_email = var.lead_email_domain != "" ? 1 : 0
}

resource "aws_sesv2_email_identity" "lead_email" {
  count          = local.lead_email
  email_identity = var.lead_email_domain
  tags           = local.tags
}

resource "aws_sns_topic" "lead_email" {
  count = local.lead_email
  name  = "${local.name}-lead-emails"
  tags  = local.tags
}

resource "aws_sns_topic_policy" "lead_email" {
  count = local.lead_email
  arn   = aws_sns_topic.lead_email[0].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "SesPublish"
      Effect    = "Allow"
      Principal = { Service = "ses.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.lead_email[0].arn
      Condition = { StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

# The API confirms the subscription itself when SNS calls it, so the API must be reachable on var.api_domain.
resource "aws_sns_topic_subscription" "lead_email" {
  count                  = local.lead_email
  topic_arn              = aws_sns_topic.lead_email[0].arn
  protocol               = "https"
  endpoint               = "https://${var.api_domain}/api/v1/webhooks/email-inbound"
  endpoint_auto_confirms = true
}

resource "aws_ses_receipt_rule_set" "main" {
  count         = local.lead_email
  rule_set_name = local.name
}

resource "aws_ses_active_receipt_rule_set" "main" {
  count         = local.lead_email
  rule_set_name = aws_ses_receipt_rule_set.main[0].rule_set_name
}

resource "aws_ses_receipt_rule" "lead_email" {
  count         = local.lead_email
  name          = "lead-emails"
  rule_set_name = aws_ses_receipt_rule_set.main[0].rule_set_name
  recipients    = [var.lead_email_domain]
  enabled       = true
  scan_enabled  = true
  tls_policy    = "Optional"

  # Whole message in the notification (lead emails are small; SNS carries up to 150 KB).
  sns_action {
    topic_arn = aws_sns_topic.lead_email[0].arn
    encoding  = "UTF-8"
    position  = 1
  }

  depends_on = [aws_sns_topic_policy.lead_email]
}
