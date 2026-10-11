# Creates the CRM database on Windows.
# Usage (PowerShell, in this folder):
#   .\setup_db.ps1 -Password yourpassword            # empty database
#   .\setup_db.ps1 -Password yourpassword -Sample    # with sample data
#   .\setup_db.ps1 -Password yourpassword -Test      # with sample data + run the 51 tests
param(
  [Parameter(Mandatory=$true)][string]$Password,
  [string]$Database = "crm_dev",
  [string]$DbHost = "localhost",
  [string]$Port = "5432",
  [string]$User = "postgres",
  [switch]$Sample,
  [switch]$Test
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$psql = (Get-Command psql -ErrorAction SilentlyContinue).Source
if (-not $psql) { $psql = Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName }
if (-not $psql) { Write-Host "psql not found. Install PostgreSQL 16 (with Command Line Tools) first." -ForegroundColor Red; exit 1 }
$env:PGPASSWORD = $Password; $env:PGHOST = $DbHost; $env:PGPORT = $Port; $env:PGUSER = $User; $env:PSQL = $psql
function Run-Psql([string[]]$a) { & $psql @a; if ($LASTEXITCODE -ne 0) { Write-Host "Stopped: the step above failed." -ForegroundColor Red; exit 1 } }
if ($Test) { $Sample = $true }
Write-Host "1/5 Recreating database $Database"
Run-Psql @("-d","postgres","-q","-v","ON_ERROR_STOP=1","-c","DROP DATABASE IF EXISTS $Database WITH (FORCE)","-c","CREATE DATABASE $Database")
Write-Host "2/5 Tables (schema.sql)";     Run-Psql @("-d",$Database,"-q","-v","ON_ERROR_STOP=1","-f","schema.sql")
Write-Host "3/5 Security (security.sql)"; Run-Psql @("-d",$Database,"-q","-v","ON_ERROR_STOP=1","-f","security.sql")
Write-Host "4/5 Defaults (seed.sql)";     Run-Psql @("-d",$Database,"-q","-v","ON_ERROR_STOP=1","-o","NUL","-f","seed.sql")
if ($Sample) { Write-Host "5/5 Sample data"; Run-Psql @("-d",$Database,"-q","-v","ON_ERROR_STOP=1","-o","NUL","-f","tests\sample_data.sql") } else { Write-Host "5/5 Sample data skipped" }
$count = & $psql -d $Database -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'"
Write-Host "Tables created: $count" -ForegroundColor Green
if ($Test) {
  $env:PGDATABASE = $Database
  $py = (Get-Command python -ErrorAction SilentlyContinue).Source
  if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
  if (-not $py) { Write-Host "Python not found: install it from python.org to run the tests." -ForegroundColor Yellow } else { & $py tests\run_tests.py }
}
Write-Host "Done. Open pgAdmin and look at database $Database."
