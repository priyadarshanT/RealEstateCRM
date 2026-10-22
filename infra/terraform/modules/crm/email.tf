# Amazon SES: sending domain with DKIM. The three DKIM CNAME records (output dkim_records) go into Cloudflare DNS.
# A new SES account starts in the sandbox; request production access in the console before go-live.

resource "aws_sesv2_email_identity" "domain" {
  email_identity = var.mail_domain
  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
  tags = local.tags
}
