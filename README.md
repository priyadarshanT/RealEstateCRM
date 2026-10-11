# Dubai Real Estate CRM

A multi-tenant CRM for Dubai real estate brokerages (B2B) and individual agents (B2C): leads, assignment, calls and meetings, WhatsApp and email, projects and units, deals, invoices, attendance, dashboard and reports.

**Status:** design complete (v1.2, 11 Oct 2026). Database ready and tested (77 tables, 51/51 rule tests). Backend and frontend coding starts next.

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

Creates database `crm_dev` with all 77 tables, sample data, and runs the 51 rule tests. See `db/README.md`.

## Run the full app on your computer (once the code exists)

### 1. Install once

| Tool | Version |
|---|---|
| Git | latest |
| Node.js | 22 LTS |
| pnpm | 9 (`corepack enable`) |
| Docker Desktop | latest (runs PostgreSQL, MinIO, Mailpit, Gotenberg locally) |
| VS Code | latest, with the recommended extensions in `.vscode/extensions.json` |

### 2. Get the code and start

```bash
git clone https://github.com/priyadarshanT/RealEstateCRM.git
cd RealEstateCRM
cp .env.example .env            # local settings; no real secrets needed
pnpm install
docker compose -f docker/docker-compose.yml up -d   # postgres:5432, minio:9000, mailpit:8025, gotenberg:3001
pnpm db:migrate                 # creates all tables
pnpm db:seed                    # reference data + a demo tenant with sample users and leads
pnpm dev                        # web http://localhost:3000 · api http://localhost:4000 · worker
```

Open `http://localhost:3000` and sign in as a demo user (listed in `db/seed/README.md`). Locally, login uses a development identity provider so no AWS account is needed.

### 3. Everyday commands

| Command | Does |
|---|---|
| `pnpm dev` | Runs web, API and worker with live reload |
| `pnpm test` | Unit tests for all modules |
| `pnpm test:e2e` | Browser tests (Playwright) |
| `pnpm test:db` | Database rule tests |
| `pnpm lint` | Lint, formatting and module-boundary checks |
| `pnpm typecheck` | TypeScript checks |
| `pnpm db:migrate` | Apply new migrations |
| `pnpm db:new <name>` | Create a new numbered migration file |
| `pnpm db:reset` | Drop and rebuild the local database with seed data |
| `pnpm api:generate` | Regenerate `packages/contracts` from `api/openapi.yaml` |
| `pnpm api:check` | Fail if the code's Swagger output differs from `api/openapi.yaml` |

### 4. Environment variables

All variables are listed with explanations in `.env.example`. Real values for staging and production live in AWS SSM Parameter Store, never in the repository.

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
