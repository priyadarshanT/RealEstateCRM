#!/usr/bin/env bash
# Creates the CRM database on Mac / Linux.
# Usage: PGPASSWORD=yourpassword ./setup_db.sh [--sample] [--test]
set -euo pipefail
cd "$(dirname "$0")"
DB="${PGDATABASE:-crm_dev}"; export PGHOST="${PGHOST:-localhost}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
SAMPLE=0; TEST=0
for a in "$@"; do case "$a" in --sample) SAMPLE=1;; --test) SAMPLE=1; TEST=1;; esac; done
echo "1/5 Recreating database $DB"
psql -d postgres -q -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
echo "2/5 Tables (schema.sql)";   psql -d "$DB" -q -v ON_ERROR_STOP=1 -f schema.sql
echo "3/5 Security (security.sql)"; psql -d "$DB" -q -v ON_ERROR_STOP=1 -f security.sql
echo "4/5 Defaults (seed.sql)";    psql -d "$DB" -q -v ON_ERROR_STOP=1 -f seed.sql >/dev/null
if [ $SAMPLE = 1 ]; then echo "5/5 Sample data"; psql -d "$DB" -q -v ON_ERROR_STOP=1 -f tests/sample_data.sql >/dev/null; else echo "5/5 Sample data skipped"; fi
echo "Tables created: $(psql -d "$DB" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
if [ $TEST = 1 ]; then PGDATABASE="$DB" python3 tests/run_tests.py; fi
echo "Done. Open pgAdmin and look at database $DB."
