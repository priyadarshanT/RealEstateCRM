#!/bin/bash
# Pulls the configured images and (re)starts the CRM containers on this server.
# Runs at boot (crm.service) and on every release (the pipeline calls it through SSM Run Command).
# All settings come from SSM Parameter Store under /crm/<env>/; nothing secret is kept in this script.
set -euo pipefail

ENV="${environment}"
REGION="${region}"
PRIMARY="$${CRM_PRIMARY:-$(cat /opt/crm/primary 2>/dev/null || echo false)}"
P="/crm/$ENV"

get() { aws ssm get-parameter --region "$REGION" --with-decryption --name "$P/deploy/$1" --query Parameter.Value --output text; }

# api.env / web.env from /crm/<env>/api/* and /crm/<env>/web/* (placeholders "unset" are skipped).
envfile() {
  umask 077
  aws ssm get-parameters-by-path --region "$REGION" --with-decryption --path "$P/$1/" \
    --query 'Parameters[*].[Name,Value]' --output text \
    | while IFS=$'\t' read -r name value; do
        [ "$value" = "unset" ] && continue
        echo "$${name##*/}=$value"
      done > "/opt/crm/$1.env.new"
  mv "/opt/crm/$1.env.new" "/opt/crm/$1.env"
}

REG="$(get ECR_REGISTRY)"
TAG="$${1:-$(get IMAGE_TAG)}"
DB_MODE="$(get DB_MODE)"
LOG_GROUP="$(get LOG_GROUP)"
envfile api
envfile web

aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REG" >/dev/null
docker network inspect crm >/dev/null 2>&1 || docker network create crm >/dev/null

run() {
  local name="$1"; shift
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network crm --restart unless-stopped \
    --log-driver awslogs --log-opt awslogs-region="$REGION" --log-opt awslogs-group="$LOG_GROUP" \
    --log-opt awslogs-stream="$(hostname)-$name" "$@" >/dev/null
  echo "started $name"
}

# Starter size: PostgreSQL in a container, data on the separate EBS volume mounted at /var/lib/crm.
if [ "$DB_MODE" = "container" ] && ! docker ps --format '{{.Names}}' | grep -qx postgres; then
  run postgres --memory 512m --shm-size 128m \
    -e POSTGRES_PASSWORD="$(get POSTGRES_PASSWORD)" -e POSTGRES_DB=crm \
    -v /var/lib/crm/postgres:/var/lib/postgresql/data \
    postgres:16 -c shared_buffers=128MB -c max_connections=60
  until docker exec postgres pg_isready -U postgres -q; do sleep 2; done
fi

docker pull "$REG/crm/api:$TAG" >/dev/null
docker pull "$REG/crm/web:$TAG" >/dev/null

if [ "$PRIMARY" = "true" ]; then
  # Migrations create the roles; then give them their passwords (idempotent).
  docker run --rm --network crm --env-file /opt/crm/api.env "$REG/crm/api:$TAG" node -e \
    "require('./apps/api/dist/core/database/migrations').runMigrations(process.env.MIGRATION_DATABASE_URL, console.log).then(n => console.log(n + ' migration(s) applied'))"
  MIG_URL="$(grep '^MIGRATION_DATABASE_URL=' /opt/crm/api.env | cut -d= -f2-)"
  docker run --rm --network crm postgres:16 psql -q "$MIG_URL" \
    -c "ALTER ROLE crm_app PASSWORD '$(get CRM_APP_PASSWORD)'" \
    -c "ALTER ROLE crm_worker PASSWORD '$(get CRM_WORKER_PASSWORD)'" \
    -c "ALTER ROLE crm_platform PASSWORD '$(get CRM_PLATFORM_PASSWORD)'"
fi

docker ps --format '{{.Names}}' | grep -qx gotenberg || run gotenberg --memory 600m gotenberg/gotenberg:8
run api --memory 450m --env-file /opt/crm/api.env "$REG/crm/api:$TAG"
run worker --memory 350m --env-file /opt/crm/api.env -e APP_MODE=worker "$REG/crm/api:$TAG" node apps/api/dist/worker.js
run web --memory 300m --env-file /opt/crm/web.env "$REG/crm/web:$TAG"

TUNNEL="$(get CLOUDFLARE_TUNNEL_TOKEN)"
if [ "$TUNNEL" != "unset" ]; then
  docker ps --format '{{.Names}}' | grep -qx cloudflared || run cloudflared --memory 100m cloudflare/cloudflared:latest tunnel --no-autoupdate run --token "$TUNNEL"
else
  echo "Cloudflare tunnel token not set yet: the app runs but is not reachable from the internet"
fi

docker image prune -f >/dev/null
echo "deployed $TAG"
