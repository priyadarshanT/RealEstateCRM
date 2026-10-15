# Dubai Real Estate CRM

A multi-tenant CRM for Dubai real estate brokerages (B2B) and individual agents (B2C): leads, assignment, calls and meetings, WhatsApp and email, projects and units, deals, invoices, attendance, dashboard and reports.

**Status:** design complete (v1.2, 11 Oct 2026). Database ready and tested (80 tables: 77 in v1.2 + 3 added by migrations 0002–0005; 51/51 rule tests). Backend and frontend coding starts next.

| Document | Where |
|---|---|
| Requirements (SRS v1.2) | `docs/01-SRS.md` · `docs/pdf/CRM_SRS_with_Wireframes.pdf` |
| Architecture | `docs/pdf/CRM_Architecture.pdf` |
| Database design | `docs/pdf/CRM_Database_Design.pdf` (full) · `docs/pdf/CRM_Database_Overview.pdf` (stakeholders) · `db/` |
| Workflows | `docs/pdf/CRM_Workflows.pdf` |
| API (287 endpoints) | `docs/05-API-Guide.md` · `api/openapi.yaml` · `api/swagger.html` · `docs/pdf/CRM_API_Documentation.pdf` · `docs/pdf/CRM_API_Overview.pdf` |
| Technology plan and costs | `docs/pdf/CRM_Technology_Plan_and_Costs.pdf` |
| Stakeholder files | `docs/stakeholders/` (original brief, SRS .docx, questionnaire) |
| Coding standards | `docs/06-Coding-Standards.md` *(next)* |
| Deployment | `docs/07-Deployment-Guide.md` *(next)* |

---

## Tech stack

| Part | Technology |
|---|---|
| Screens (web + installable phone app) | Next.js 15, React, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query, Apache ECharts |
| API and background worker | NestJS on Node.js 22, TypeScript |
| Database | PostgreSQL 16, Drizzle ORM, SQL migrations, row-level security per tenant |
| Job queue | pg-boss (inside PostgreSQL) |
| Login | Amazon Cognito (OIDC, two-factor) |
| Files / email | Amazon S3 / Amazon SES (MinIO and Mailpit locally) |
| PDFs | Gotenberg |
| Infrastructure | Docker, Terraform, GitHub Actions, AWS UAE region, Cloudflare |

## Repository layout

```
RealEstateCRM/
├── apps/
│   ├── web/                    Next.js screens
│   │   └── src/features/<module>/      one folder per module (leads, tasks, …)
│   └── api/                    NestJS API + worker (same code, two start modes)
│       └── src/
│           ├── core/                   shared: database, queue, files, audit, events, config, auth
│           └── modules/<module>/       one folder per module
├── packages/
│   ├── contracts/              API types generated from api/openapi.yaml
│   └── ui/                     shared UI components
├── api/openapi.yaml            API contract
├── db/
│   ├── schema.sql · security.sql · seed.sql   current database (v1.2)
│   ├── setup_db.ps1 / setup_db.sh            build a local database (+ sample data and tests)
│   ├── migrations/             numbered SQL migrations (start before the first real data)
│   └── tests/                  sample data + 51 database rule tests
├── infra/terraform/            AWS + Cloudflare infrastructure
├── docker/                     Dockerfiles, docker-compose.yml for local services
├── docs/                       all project documents (Markdown + PDFs)
└── tools/docs-generators/      scripts that regenerate the PDFs and openapi.yaml
```

**Modules:** `organization`, `settings`, `leads`, `assignment`, `scoring`, `tasks`, `calendar`, `messaging`, `campaigns`, `projects`, `deals`, `finance`, `attendance`, `reports`, `dashboard`, `integrations`, `events`, `notifications`, `billing`, `platform` (owner console). Each exists once in `apps/api/src/modules/` and once in `apps/web/src/features/`.

## Database only (works today)

Windows, from the `db` folder, with PostgreSQL 16 installed:

```powershell
.\setup_db.ps1 -Password YOUR_POSTGRES_PASSWORD -Test
```

Creates database `crm_dev` with all 80 tables, sample data, and runs the 51 rule tests. See `db/README.md`.

## Run the full app on your computer

### 1. Install once

| Tool | Version |
|---|---|
| Git | latest |
| Node.js | 22 LTS |
| pnpm | 9 (`corepack enable`; on Windows also `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once) |
| PostgreSQL | 16, with Command Line Tools (or use the `db` profile of `docker/docker-compose.yml`) |
| Docker Desktop | latest (runs the S3 stand-in for files and Gotenberg for PDFs) |
| VS Code | latest |

### 2. First time

Windows PowerShell, from the repository folder:

```powershell
pnpm install
docker compose -f docker/docker-compose.yml up -d       # files on :9000, PDFs on :3001
cd db; .\setup_db.ps1 -Password YOUR_POSTGRES_PASSWORD -Sample; cd ..   # crm_dev with sample data
copy apps\api\.env.example apps\api\.env           # then set the passwords and the two secrets
copy apps\web\.env.example apps\web\.env.local     # DEV_AUTH_SECRET = the same value as in apps/api/.env
pnpm db:migrate                                         # "database is up to date" after setup_db
```

The API connects as `crm_app`, `crm_worker` and `crm_platform`. Give them the password you put in `apps/api/.env` (pgAdmin → crm_dev → Query Tool):

```sql
ALTER ROLE crm_app PASSWORD '...'; ALTER ROLE crm_worker PASSWORD '...'; ALTER ROLE crm_platform PASSWORD '...';
```

### 3. Start (three terminals)

```powershell
pnpm dev                                   # API    http://localhost:4000
pnpm --filter @crm/api dev:worker          # worker (background jobs and schedules)
pnpm --filter @crm/web dev                 # screens http://localhost:3000
```

Open `http://localhost:3000` and sign in with company ID `aaaaaaaa-0000-0000-0000-000000000001` and `admin@a.ae` (Admin), `sara@a.ae` (Team Leader) or `ali@a.ae` (Agent). Locally, login is a development stand-in for Cognito, so no AWS account is needed. Emails are written to the API terminal (`MAIL_MODE=log`).

To try every role, the Admin adds users on **Team → Add user**; they become active at their first sign-in. The sample company has 4 seats, all used, and seats are bought through Stripe, so locally raise them first: `UPDATE subscriptions SET seats = 20;`

Sign-up and billing need Stripe test keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` in `apps/api/.env`).

### Everyday commands

| Command | Does |
|---|---|
| `pnpm dev` | Runs the API with live reload |
| `pnpm --filter @crm/api dev:worker` | Runs the worker with live reload |
| `pnpm --filter @crm/web dev` | Runs the screens with live reload |
| `pnpm test` | API tests (they build their own database, `crm_test`) |
| `pnpm test:db` | Database rule tests |
| `pnpm typecheck` | TypeScript checks |
| `pnpm db:migrate` | Apply new migrations |
| `pnpm api:check` | Fail if the code differs from `api/openapi.yaml` |

### Environment variables

All variables are listed with explanations in `apps/api/.env.example` and `apps/web/.env.example`. Real values for staging and production live in AWS SSM Parameter Store, never in the repository.

## How to add or change code

Read `docs/06-Coding-Standards.md` first. In short:

1. Create a branch from `main`: `feature/leads-sharing`, `fix/tasks-reminder-time`.
2. Change **only the module you are working on**: its `apps/api/src/modules/<module>/`, `apps/web/src/features/<module>/` and its migration in `db/migrations/`.
3. Add or update tests. Run `pnpm lint && pnpm typecheck && pnpm test`.
4. Open a pull request. It is merged only after review and green checks; `main` deploys to staging automatically.

## Help

- Something unclear in the requirements: check `docs/01-SRS.md`, then ask the solution architect.
- Database question: `docs/pdf/CRM_Database_Design.pdf` (data dictionary).
- API question: Swagger UI at `/api/docs` or `docs/05-API-Guide.md`.
