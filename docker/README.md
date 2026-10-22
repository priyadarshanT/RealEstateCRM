# Docker

- `docker-compose.yml`: local services for development (S3 stand-in, Gotenberg, optional PostgreSQL).
- `api.Dockerfile`: one image for the API, the worker (`node apps/api/dist/worker.js`) and migrations.
- `web.Dockerfile`: the Next.js web app as a standalone server.

Build from the repository root:

```bash
docker build -f docker/api.Dockerfile -t crm-api .
docker build -f docker/web.Dockerfile -t crm-web .
```

Images take every setting from environment variables at runtime (in AWS: SSM Parameter Store), so the same image runs in every environment. No `.env` file is copied into an image.
