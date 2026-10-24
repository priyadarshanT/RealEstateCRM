# App servers (Amazon Linux 2023, arm64 / Graviton). Containers: api, worker, web, gotenberg, cloudflared,
# and on the starter size also postgres. Admin access only through SSM Session Manager (no SSH, no open ports).

data "aws_ssm_parameter" "al2023_arm64" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/crm/${var.environment}/app"
  retention_in_days = 14
  tags              = local.tags
}

resource "aws_iam_role" "server" {
  name = "${local.name}-server"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ec2.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "server_ssm" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "server" {
  name = "crm-app"
  role = aws_iam_role.server.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "Images", Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      { Sid = "PullImages", Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = [for r in data.aws_ecr_repository.app : r.arn] },
      { Sid = "Files", Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = ["${aws_s3_bucket.files.arn}/*", "${aws_s3_bucket.backups.arn}/*"] },
      { Sid = "ListFiles", Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.files.arn, aws_s3_bucket.backups.arn] },
      { Sid = "Config", Effect = "Allow", Action = ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"], Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm}/*" },
      # Integration tokens per company (apps/api/src/core/secrets/secret-store.ts).
      { Sid = "IntegrationSecrets", Effect = "Allow", Action = ["ssm:PutParameter", "ssm:DeleteParameter"], Resource = "arn:aws:ssm:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:parameter${local.ssm}/tenants/*" },
      { Sid = "Email", Effect = "Allow", Action = ["ses:SendEmail", "ses:SendRawEmail"], Resource = "*" },
      { Sid = "Users", Effect = "Allow", Action = ["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser", "cognito-idp:AdminDisableUser", "cognito-idp:AdminEnableUser", "cognito-idp:AdminUserGlobalSignOut", "cognito-idp:AdminSetUserMFAPreference"], Resource = [for p in aws_cognito_user_pool.pool : p.arn] },
      { Sid = "Logs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource = "${aws_cloudwatch_log_group.app.arn}:*" },
    ]
  })
}

resource "aws_iam_instance_profile" "server" {
  name = "${local.name}-server"
  role = aws_iam_role.server.name
}

# Starter size: the database lives on this volume, separate from the server's own disk.
resource "aws_ebs_volume" "data" {
  count             = local.use_rds ? 0 : 1
  availability_zone = aws_subnet.public[0].availability_zone
  size              = local.s.volume_gb - 10
  type              = "gp3"
  encrypted         = true
  tags              = merge(local.tags, { Name = "${local.name}-data", Backup = "daily" })
  lifecycle {
    prevent_destroy = false
  }
}

resource "aws_instance" "app" {
  count                       = local.s.instance_count
  ami                         = data.aws_ssm_parameter.al2023_arm64.value
  instance_type               = local.s.instance_type
  subnet_id                   = aws_subnet.public[count.index % 2].id
  vpc_security_group_ids      = [aws_security_group.app.id]
  iam_instance_profile        = aws_iam_instance_profile.server.name
  associate_public_ip_address = true
  user_data_replace_on_change = false
  # replace() strips Windows line endings in case the scripts were checked out on Windows.
  user_data = replace(templatefile("${path.module}/templates/user-data.sh", {
    primary        = count.index == 0 ? "true" : "false"
    data_volume_id = !local.use_rds && count.index == 0 ? aws_ebs_volume.data[0].id : ""
    region         = data.aws_region.current.region
    environment    = var.environment
    backup_days    = var.backup_retention_days
    deploy_script = templatefile("${path.module}/templates/deploy.sh", {
      environment = var.environment
      region      = data.aws_region.current.region
    })
  }), "\r", "")

  metadata_options {
    http_tokens   = "required"
    http_endpoint = "enabled"
  }

  root_block_device {
    volume_size = 10
    volume_type = "gp3"
    encrypted   = true
  }

  # "standard": a busy server slows down instead of buying extra CPU credits (keeps the bill fixed).
  credit_specification {
    cpu_credits = "standard"
  }

  lifecycle {
    ignore_changes = [ami] # new AMIs are rolled out on purpose, not on every plan
  }

  tags = merge(local.tags, { Name = "${local.name}-app-${count.index}", Role = count.index == 0 ? "primary" : "secondary" })
}

resource "aws_volume_attachment" "data" {
  count       = local.use_rds ? 0 : 1
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.data[0].id
  instance_id = aws_instance.app[0].id
}

# Daily snapshots of volumes tagged Backup=daily.
resource "aws_iam_role" "dlm" {
  count = local.use_rds ? 0 : 1
  name  = "${local.name}-dlm"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "dlm.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count      = local.use_rds ? 0 : 1
  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

resource "aws_dlm_lifecycle_policy" "daily" {
  count              = local.use_rds ? 0 : 1
  description        = "${local.name} daily data volume snapshots"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"
  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { Backup = "daily", Environment = var.environment }
    schedule {
      name      = "daily"
      copy_tags = true
      create_rule {
        interval      = 24
        interval_unit = "HOURS"
        times         = ["21:00"]
      }
      retain_rule {
        count = var.backup_retention_days
      }
    }
  }
  tags = local.tags
}

# The only command the pipeline may run on the servers: deploy one image tag (letters and digits only).
resource "aws_ssm_document" "deploy" {
  name            = "${local.name}-deploy"
  document_type   = "Command"
  document_format = "JSON"
  tags            = local.tags
  content = jsonencode({
    schemaVersion = "2.2"
    description   = "Deploy an image tag of the CRM (runs /opt/crm/deploy.sh)."
    parameters = {
      tag = { type = "String", description = "Image tag", allowedPattern = "^[0-9a-f]{7,40}$" }
    }
    mainSteps = [{
      action = "aws:runShellScript"
      name   = "deploy"
      inputs = { runCommand = ["/opt/crm/deploy.sh {{ tag }}"], timeoutSeconds = "1200" }
    }]
  })
}
