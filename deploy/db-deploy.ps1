# Applies pending database migrations for a SmartPlan-Advisor box, optionally
# taking a pg_dump backup first. Invoked by the deploy workflows.
#
# Ported from the SmartPlan repo (deploy/db-deploy.ps1) — keep the two in step.
# Differences: pnpm workspace instead of yarn, and the runner executes from
# TypeScript source via tsx (`pnpm db:migrate`) rather than a bundled .cjs,
# because the API already runs from source on these boxes.
#
# Run from the box's app folder (the deploy SSH step does `Set-Location` there
# first). It expects, relative to that folder:
#   .env                  (with DATABASE_URL)   - read for the backup
#   db/src/migrate.ts     (the runner)          - shipped by the deploy
#   db/migrations/*.sql   (the migration files) - shipped by the deploy
#   node_modules          (pnpm install already run, so tsx + postgres exist)
#
# Usage:
#   powershell -NoProfile -File deploy\db-deploy.ps1                          # migrate only
#   powershell -NoProfile -File deploy\db-deploy.ps1 -Backup -Prefix advisor  # backup, then migrate
param(
  [switch]$Backup,
  [string]$Prefix = "advisor"
)
$ErrorActionPreference = "Stop"

# Read one KEY=value line from .env the way dotenv does: trim whitespace and
# strip surrounding single/double quotes (a quoted value works for the app via
# dotenv, so it must work here too).
function Get-EnvValue([string]$key) {
  $line = Get-Content .env -ErrorAction SilentlyContinue | Select-String "^\s*$key="
  if (-not $line) { return $null }
  $v = ($line.ToString() -split '=', 2)[1].Trim()
  if ($v.Length -ge 2 -and (($v[0] -eq '"' -and $v[-1] -eq '"') -or ($v[0] -eq "'" -and $v[-1] -eq "'"))) {
    $v = $v.Substring(1, $v.Length - 2)
  }
  return $v
}

if ($Backup) {
  $dburl = Get-EnvValue 'DATABASE_URL'
  if (-not $dburl) { Write-Error "DATABASE_URL not found in .env - cannot back up"; exit 1 }

  # Locate pg_dump: explicit PG_DUMP_PATH (process env, then .env) wins; else the
  # highest-NUMBERED PostgreSQL version under Program Files ("18" must beat "9.6",
  # so sort by parsed version, not by string). psql isn't on PATH on these boxes.
  $pgDump = $env:PG_DUMP_PATH
  if (-not $pgDump) { $pgDump = Get-EnvValue 'PG_DUMP_PATH' }
  if (-not $pgDump) {
    $pgDump = (Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
      Sort-Object { [version]($_.FullName -replace '.*PostgreSQL\\([\d.]+)\\.*', '$1.0') } -Descending |
      Select-Object -First 1).FullName
  }
  if (-not $pgDump -or -not (Test-Path $pgDump)) {
    Write-Error "pg_dump not found. Install PostgreSQL client tools or set PG_DUMP_PATH (in .env or the environment)."
    exit 1
  }

  # Backup directory: an ABSOLUTE, stable path outside the app folder (which the
  # deploy churns each release). Absolute is essential - relative "backups\"
  # resolves differently for PowerShell cmdlets ($PWD) vs. an external exe like
  # pg_dump ([Environment]::CurrentDirectory), and Set-Location only updates the
  # former, so over SSH they diverge and the dump + prune miss each other.
  # Overridable via BACKUP_DIR (process env, then .env).
  $backupDir = $env:BACKUP_DIR
  if (-not $backupDir) { $backupDir = Get-EnvValue 'BACKUP_DIR' }
  if (-not $backupDir) { $backupDir = 'C:\smartplan-backups' }
  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $out = Join-Path $backupDir "$Prefix-$stamp.sql"
  Write-Host "Backing up database to $out (via $pgDump)..."
  & $pgDump --no-owner --no-privileges --file $out $dburl
  if ($LASTEXITCODE -ne 0) { Write-Error "pg_dump failed - aborting BEFORE migrating"; exit 1 }
  Write-Host "Backup written: $out"

  # Retain only the 10 most recent backups for this prefix. Pruning is
  # housekeeping - never let it abort the deploy.
  try {
    Get-ChildItem -Path $backupDir -Filter "$Prefix-*.sql" -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 10 |
      Remove-Item -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Host "Backup pruning skipped: $($_.Exception.Message)"
  }
}

Write-Host "Applying pending migrations..."
pnpm db:migrate
if ($LASTEXITCODE -ne 0) { Write-Error "Migration failed"; exit 1 }
Write-Host "Migrations up to date."
