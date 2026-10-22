# Launch size only: Amazon RDS PostgreSQL 16 with a standby copy in a second Availability Zone (Technology Plan v1.2).
# The starter size runs PostgreSQL in a container on the app server instead (see servers.tf and deploy.sh).

resource "aws_db_subnet_group" "main" {
  count      = local.use_rds ? 1 : 0
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
  tags       = local.tags
}

resource "aws_db_instance" "main" {
  count                        = local.use_rds ? 1 : 0
  identifier                   = local.name
  engine                       = "postgres"
  engine_version               = "16"
  instance_class               = local.s.db_class
  multi_az                     = local.s.db_multi_az
  db_name                      = "crm"
  username                     = "postgres"
  password                     = random_password.db["postgres"].result
  allocated_storage            = 20
  max_allocated_storage        = 200
  storage_type                 = "gp3"
  storage_encrypted            = true
  db_subnet_group_name         = aws_db_subnet_group.main[0].name
  vpc_security_group_ids       = [aws_security_group.db[0].id]
  backup_retention_period      = var.backup_retention_days
  deletion_protection          = true
  skip_final_snapshot          = false
  final_snapshot_identifier    = "${local.name}-final"
  auto_minor_version_upgrade   = true
  performance_insights_enabled = false
  tags                         = local.tags
}
