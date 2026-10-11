# Working rules for this repository

Dubai Real Estate CRM, multi-tenant SaaS (B2B brokerages + B2C agents). Two developers: the solution architect (lead) and Claude (junior).

## How we work
1. The architect leads. Propose; don't override decisions.
2. Change only the module or file you were asked to change.
3. A feature change touches only that feature's slice: `apps/web/src/features/<module>/`, `apps/api/src/modules/<module>/`, and its migration in `db/migrations/`. Nothing else.
4. Anything outside that scope: ask first, in this format, and wait for approval:
   **Need approval:** What / Where / Why / Affects → Approve / Reject
5. Changes already decided by stakeholders are applied directly across docs and code.

## Code rules
- SOLID, loosely coupled modular monolith (NestJS API + worker, Next.js web).
- A module never reads or writes another module's tables; use its service or domain events.
- Patterns: repository, adapter (one per integration provider), strategy (assignment, scoring), observer (domain events).
- The API contract is `api/openapi.yaml`; code must match it (`pnpm api:check`).
- Schema changes only through numbered migrations; keep `db/tests` passing.
- Every tenant table has `tenant_id`; row-level security must stay on.
- Never commit secrets. Real values live in AWS SSM.

## Source of truth
- Requirements: `docs/01-SRS.md` (v1.2)
- Database: `db/schema.sql`, `db/security.sql`, `db/seed.sql`
- API: `api/openapi.yaml`
