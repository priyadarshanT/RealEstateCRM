output "ecr_registry" {
  description = "Registry the release pipeline pushes images to."
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${data.aws_region.current.region}.amazonaws.com"
}

output "instance_ids" {
  description = "App servers (open a shell with: aws ssm start-session --target <id>)."
  value       = aws_instance.app[*].id
}

output "files_bucket" {
  value = aws_s3_bucket.files.bucket
}

output "backups_bucket" {
  value = aws_s3_bucket.backups.bucket
}

output "ssm_prefix" {
  description = "Where all settings live in SSM Parameter Store."
  value       = local.ssm
}

output "dkim_records" {
  description = "Add these CNAME records in Cloudflare DNS (DNS only, not proxied) so SES can send from the mail domain."
  value       = [for t in aws_sesv2_email_identity.domain.dkim_signing_attributes[0].tokens : "${t}._domainkey.${var.mail_domain} CNAME ${t}.dkim.amazonses.com"]
}

output "cognito_hosted_domains" {
  value = { for k, d in aws_cognito_user_pool_domain.pool : k => "https://${d.domain}.auth.${data.aws_region.current.region}.amazoncognito.com" }
}

output "cognito_user_pool_ids" {
  value = { for k, p in aws_cognito_user_pool.pool : k => p.id }
}

output "tunnel_routes" {
  description = "Public hostnames to add to the Cloudflare Tunnel."
  value       = { (var.web_domain) = "http://web:3000", (var.api_domain) = "http://api:4000" }
}

output "lead_email_dns" {
  description = "Cloudflare DNS for portal lead emails (all DNS only): the MX record and three DKIM CNAMEs."
  value = local.lead_email == 0 ? [] : concat(
    ["${var.lead_email_domain} MX 10 inbound-smtp.${data.aws_region.current.region}.amazonaws.com"],
    [for t in aws_sesv2_email_identity.lead_email[0].dkim_signing_attributes[0].tokens : "${t}._domainkey.${var.lead_email_domain} CNAME ${t}.dkim.amazonses.com"],
  )
}
