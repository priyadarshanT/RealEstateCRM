# CRM database: setup on your PC

Database version 1.2 (matches SRS v1.2) · PostgreSQL 16 · 77 tables

## What you need
- PostgreSQL 16 with pgAdmin 4 and Command Line Tools (installer: postgresql.org/download)
- Python 3 (only to run the tests): python.org

## Windows (PowerShell)
1. Unzip this folder, e.g. to `C:\projects\crm-db`
2. Open PowerShell in that folder (Shift + right-click → Open PowerShell window here)
3. Allow local scripts for this window only:
   `Set-ExecutionPolicy -Scope Process Bypass`
4. Run one of:
   - Empty database: `.\setup_db.ps1 -Password YOUR_POSTGRES_PASSWORD`
   - With sample data: `.\setup_db.ps1 -Password YOUR_POSTGRES_PASSWORD -Sample`
   - Sample data + 51 tests: `.\setup_db.ps1 -Password YOUR_POSTGRES_PASSWORD -Test`

## Mac / Linux
`PGPASSWORD=YOUR_POSTGRES_PASSWORD ./setup_db.sh --test`

## Then
Open pgAdmin → Servers → PostgreSQL 16 → Databases → **crm_dev** (refresh with F5).
Right-click crm_dev → **ERD For Database** to see the diagram.

Running the script again rebuilds the database from scratch (all data in crm_dev is deleted).

## Files
| File | Purpose |
|---|---|
| schema.sql | All tables, relationships, rules, indexes |
| security.sql | Database roles, tenant isolation, append-only history, invoice locks |
| seed.sql | Currencies, permissions, defaults for each new brokerage |
| tests/sample_data.sql | Two sample brokerages with users, a lead, a project, a unit, an invoice |
| tests/run_tests.py | 51 automatic rule tests |
| setup_db.ps1 / setup_db.sh | One-command setup (Windows / Mac-Linux) |
