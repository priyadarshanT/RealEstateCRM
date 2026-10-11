# API and worker (NestJS)

Empty starter project. Nothing is built yet.

```bash
pnpm install          # from the repository root
pnpm dev              # starts the API on http://localhost:4000
```

Planned structure (see `docs/06-Coding-Standards.md` once added):
- `src/core/`: database (tenant-scoped), auth, permissions, errors, logging, queue
- `src/modules/<module>/`: one folder per business module
- Contract: `../../api/openapi.yaml`
