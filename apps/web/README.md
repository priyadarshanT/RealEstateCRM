# Web app (Next.js)

Screens for computer and phone. One folder per module in `src/features/<module>/`; pages in `src/app/` only render a feature screen.

| Folder | Holds |
|---|---|
| `src/features/<module>/` | Screens, dialogs and data hooks of one module (leads, tasks, team, …) |
| `src/core/` | API client, session and permissions, lookups, formatting, file upload |
| `src/app/` | Routes. `api/v1/[...path]` forwards to the NestJS API with the login token from an httpOnly cookie |
| `../../packages/ui` | Shared components (`@crm/ui`, charts at `@crm/ui/chart`) |
| `../../packages/contracts` | Types generated from `api/openapi.yaml` (`pnpm --filter @crm/contracts api:generate`) |

## Run locally

```bash
cp .env.example .env.local     # set DEV_AUTH_SECRET to the same value as apps/api/.env
pnpm --filter @crm/web dev     # http://localhost:3000 (the API must run on :4000)
```

Local login (`AUTH_MODE=dev`): company ID and email of an existing user, e.g. sample data
`aaaaaaaa-0000-0000-0000-000000000001` / `admin@a.ae`. Owner console: `/console` with `owner@crm.ae`.
