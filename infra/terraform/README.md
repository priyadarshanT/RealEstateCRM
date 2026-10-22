# Infrastructure (Terraform)

AWS me-central-1 (UAE) with Cloudflare in front. Two sizes from the same code:

| Size | What runs | About |
|---|---|---|
| `starter` (default) | 1 server (t4g.small): API, worker, web, Gotenberg, cloudflared, PostgreSQL on a separate encrypted data volume; daily volume snapshots + nightly database dump to S3 | USD 23 / month (fits the AWS free credits) |
| `launch` | 2 servers in two Availability Zones + RDS PostgreSQL Multi-AZ (Technology Plan v1.2) | USD 144 / month |

Both sizes include ECR, S3 (files, backups), SES (domain + DKIM), Cognito (users and owner console pools, pre-token trigger), SSM Parameter Store for all settings, CloudWatch logs and alarms, and a monthly budget alert. Servers have no open ports: users come in through Cloudflare Tunnel, admins through SSM Session Manager.

## Layout

- `bootstrap/`: one-time S3 bucket for Terraform state.
- `modules/crm/`: everything above.
- `envs/production/`: production settings (`production.tfvars`, copied from the `.example`).

## First run

```bash
cd infra/terraform/bootstrap && terraform init && terraform apply
cd ../envs/production
terraform init -backend-config="bucket=crm-terraform-state-<account id>"
terraform apply -var-file=production.tfvars
```

Step-by-step instructions (AWS account, Cloudflare Tunnel, DNS, first owner login): `docs/07-Deployment-Guide.md`.
