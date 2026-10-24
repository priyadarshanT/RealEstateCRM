# Deployment Guide · AWS (eu-north-1) + Cloudflare

How to put the CRM on AWS for the first time and release new versions. The infrastructure is in `infra/terraform/` (see its README for what each size creates and costs); the images are built from `docker/`.

Commands work in PowerShell on Windows and in bash. Replace values in `<angle brackets>`. Nothing secret goes into git: real values live in AWS SSM Parameter Store under `/crm/production/`.

---

## 0. What you need first

| Item | Why |
|---|---|
| AWS account (Free plan: region **eu-north-1, Stockholm**, is the only one allowed) | Everything runs there. Move to me-central-1 (UAE) after leaving the Free plan. |
| An IAM user or SSO role with admin rights, and the **AWS CLI v2** signed in to it (`aws sts get-caller-identity` works) | Terraform and the commands below use it |
| **Terraform 1.10 or newer** | `terraform version` |
| **Docker Desktop** with `buildx` | Builds the images (the servers are arm64 / Graviton) |
| A domain in **Cloudflare** (e.g. `example.ae`) | Users reach the app through Cloudflare Tunnel; DNS records for email |
| AWS **Session Manager plugin** for the AWS CLI | Opens a shell on the server without SSH |

---

## 1. Terraform state bucket (once per AWS account)

```powershell
cd infra/terraform/bootstrap
terraform init
terraform apply
```

It prints the bucket name: `crm-terraform-state-<account id>`.

## 2. Production settings

```powershell
cd ../envs/production
copy production.tfvars.example production.tfvars      # bash: cp
```

Edit `production.tfvars`:

| Setting | Example | Notes |
|---|---|---|
| `size` | `starter` | One server with PostgreSQL on its own volume (about USD 23/month). `launch` = two servers + RDS Multi-AZ (about USD 144/month). |
| `web_domain` | `crm.example.ae` | Address users open |
| `api_domain` | `api.crm.example.ae` | Webhooks (Meta, portals, Stripe) |
| `mail_domain` / `mail_from` | `example.ae` / `Dubai Real Estate CRM <no-reply@example.ae>` | Sender of CRM emails |
| `alert_emails` | `["it@example.ae"]` | Alarms and budget alerts; each address confirms the AWS email once |
| `monthly_budget_usd` | `25` | Email at 80% / 100% of the budget |

## 3. Create the infrastructure

```powershell
terraform init -backend-config="bucket=crm-terraform-state-<account id>"
terraform validate
terraform apply -var-file=production.tfvars
```

Type `yes` when the plan looks right. The first apply takes about 10 minutes. **The server starts but cannot run the app yet** (no images in the registry): that is expected, step 5 fixes it.

Keep the outputs at hand (`terraform output`):

| Output | Used in |
|---|---|
| `crm.ecr_registry` | Step 5 (push images) |
| `crm.instance_ids` | Steps 5–8 (shell on the server) |
| `crm.dkim_records` | Step 6 (email DNS) |
| `crm.tunnel_routes` | Step 4 (Cloudflare Tunnel) |
| `crm.cognito_user_pool_ids` | Step 8 (first owner login) |
| `crm.ssm_prefix` | Where every setting lives (`/crm/production`) |

## 4. Cloudflare Tunnel (how users reach the app)

The server has no open ports. Cloudflare Tunnel connects it to your domain.

1. Cloudflare dashboard → **Zero Trust → Networks → Tunnels → Create a tunnel** → type **Cloudflared** → name it `crm-production`.
2. Copy the **token** shown in the install command (the long string after `--token`). Do not install anything; the server runs `cloudflared` itself.
3. Put the token in SSM:
   ```powershell
   aws ssm put-parameter --region eu-north-1 --name /crm/production/deploy/CLOUDFLARE_TUNNEL_TOKEN --type SecureString --overwrite --value "<token>"
   ```
4. In the tunnel → **Public Hostname → Add** the two routes from the `tunnel_routes` output:

   | Public hostname | Service |
   |---|---|
   | `crm.example.ae` | `http://web:3000` |
   | `api.crm.example.ae` | `http://api:4000` |

   Cloudflare creates the DNS records for them.

## 5. Build, push and deploy the first release

From the repository root (`develop` or the branch being released):

```powershell
$REG = "<ecr_registry output>"          # bash: REG=...
$TAG = git rev-parse --short HEAD       # bash: TAG=$(git rev-parse --short HEAD)
aws ecr get-login-password --region eu-north-1 | docker login --username AWS --password-stdin $REG
docker buildx build --platform linux/arm64 -f docker/api.Dockerfile -t "$REG/crm/api:$TAG" --push .
docker buildx build --platform linux/arm64 -f docker/web.Dockerfile -t "$REG/crm/web:$TAG" --push .
aws ssm put-parameter --region eu-north-1 --name /crm/production/deploy/IMAGE_TAG --type String --overwrite --value $TAG
```

Run the deploy on the server (pulls the images, runs the database migrations, starts api, worker, web, Gotenberg and cloudflared):

```powershell
aws ssm send-command --region eu-north-1 --instance-ids <instance id> --document-name AWS-RunShellScript --parameters 'commands=["/opt/crm/deploy.sh"]'
```

Or interactively: `aws ssm start-session --region eu-north-1 --target <instance id>`, then `sudo /opt/crm/deploy.sh`. It ends with `deployed <tag>`.

Check: `https://crm.example.ae/login` opens the Cognito sign-in page, and `https://api.crm.example.ae/health` answers `{"status":"ok"}`.

## 6. Email (Amazon SES)

1. Add the three **DKIM CNAME records** from the `dkim_records` output in Cloudflare DNS, **DNS only** (grey cloud, not proxied).
2. AWS console → **SES → Get set up → Request production access** (use case: transactional emails to the CRM's users: invitations, sign-up codes, invoices). AWS answers in about a day.

Until production access is granted, SES only delivers to addresses you verified yourself, so invitations to real users do not arrive.

## 7. Outside services (set when the accounts exist)

Terraform creates these as `unset`; the app runs without them, and the related feature reports that it is not configured.

```powershell
aws ssm put-parameter --region eu-north-1 --name /crm/production/api/<NAME> --type SecureString --overwrite --value "<value>"
```

| `<NAME>` | From | Needed for |
|---|---|---|
| `TURNSTILE_SECRET` | Cloudflare → Turnstile (site for `crm.example.ae`) | Public sign-up (required in production) |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys | Sign-up, billing |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → endpoint `https://api.crm.example.ae/api/v1/webhooks/stripe` | Payment events |
| `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN` | Meta for Developers app | Lead ads, WhatsApp |

After changing settings, run the deploy again (step 5, `send-command` only) so the containers read them.

## 8. First owner-console login

The owner console (`https://crm.example.ae/console`) is for our team only, with its own Cognito pool and two-factor.

1. Add yourself as owner in the database. Shell on the server (`aws ssm start-session …`), then:
   ```bash
   sudo bash -c 'docker run --rm --network crm postgres:16 psql "$(grep ^MIGRATION_DATABASE_URL= /opt/crm/api.env | cut -d= -f2-)" \
     -c "INSERT INTO platform_admins (email, full_name, role) VALUES ('"'"'you@example.ae'"'"', '"'"'Your Name'"'"', '"'"'owner'"'"')"'
   ```
2. Create your login in the **platform** pool (`cognito_user_pool_ids.platform`):
   ```powershell
   aws cognito-idp admin-create-user --region eu-north-1 --user-pool-id <platform pool id> --username you@example.ae --user-attributes Name=email,Value=you@example.ae Name=email_verified,Value=true
   ```
   Cognito emails a temporary password (SES must be out of the sandbox, or your address verified in SES).
3. Open `https://crm.example.ae/console`: sign in, set a new password and set up the authenticator app (two-factor is always on for the owner console). The first sign-in links your login to the `platform_admins` row by email.

## 9. First company

Either a customer signs up at `https://crm.example.ae/signup` (needs Stripe and Turnstile, step 7), or the owner console creates the company from a sales enquiry (Enterprise, no card). Both create the company's first Admin in Cognito with an emailed temporary password.

---

## Releasing a new version

1. Merge into the release branch and run `pnpm typecheck && pnpm test && pnpm api:check`.
2. Step 5: build and push both images with the new tag, update `IMAGE_TAG`, run `/opt/crm/deploy.sh`. Migrations run automatically on the primary server before the new containers start.
3. Check `/health` and sign in once.

To roll back, set `IMAGE_TAG` to the previous tag and run the deploy again. Migrations are not reversed, so a migration must stay compatible with the previous release.

## Day to day

| Task | How |
|---|---|
| Shell on a server | `aws ssm start-session --region eu-north-1 --target <instance id>` |
| Logs | CloudWatch → Log groups → the app group (one stream per container) |
| Change a setting | `aws ssm put-parameter … --overwrite`, then run the deploy |
| Backups | Starter: daily volume snapshots and a nightly database dump to the backups bucket. Launch: RDS automated backups. Kept for `backup_retention_days`. |
| Grow to the launch size | Set `size = "launch"` in `production.tfvars` and `terraform apply`. Plan a maintenance window: the database moves from the server volume to RDS (restore the latest dump into RDS before switching). |

## Known gaps

| Gap | Effect | Plan |
|---|---|---|
| **Team invites do not create Cognito logins yet.** Only sign-up and the owner console create a Cognito user (for a company's first Admin). Users added on Team → Add user, and users deactivated there, are not sent to Cognito. | On AWS, colleagues added by an Admin cannot sign in until it is fixed. | API change in the organization module (needs approval). |
| **GitHub sign-in to AWS (OIDC) is blocked on the AWS Free plan.** The bootstrap step cannot create the GitHub OIDC provider. | The pipeline deploys with a long-lived deploy key stored as a GitHub secret, limited to pushing images and running the deploy. | After leaving the Free plan: create the OIDC provider (`terraform apply` in `bootstrap/`), switch the pipeline to OIDC, then delete the deploy key and its secret. Security requirement, do not skip. |
| No CI/CD pipeline yet | Releases are built and deployed by hand (step 5). | GitHub Actions: tests on every push, image build and deploy on release. |
