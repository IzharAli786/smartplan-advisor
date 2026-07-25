# Brings the Advise API onto freshly-deployed code with the shortest possible
# interruption, and — unlike what it replaces — with an actual graceful drain.
#
# Ported from the SmartPlan repo (deploy/release-activate.ps1, the "Bring the
# workers onto the new release" section). Keep the two in step: the boxes are
# paired and reload the same way.
#
#   dev.smartplan.software (:5050)    <-> advisedev.smartplan.software (:5053)
#   portal.smartplan.software (:5000) <-> advise.smartplan.software    (:5052)
#
# WHY THIS EXISTS — WHAT WAS WRONG WITH `pm2 startOrReload`
# ---------------------------------------------------------
# Both deploy workflows used `pm2 startOrReload <config> --update-env`. That is
# the documented zero-downtime command, and in cluster mode it does achieve zero
# downtime — but on WINDOWS it does not drain. Verified against pm2 6.0.14
# source and confirmed in logs:
#
#   reload -> hardReload() moves the old worker aside by setting pm2_env.pm_id
#             to the STRING '_old_<id>'. God.killProcess() gates the graceful
#             IPC path on `typeof pm_id === 'number'`; that test now fails, so
#             `shutdown_with_message` is silently ignored and PM2 falls through
#             to process.kill(pid, SIGINT). On Linux/macOS SIGINT still reaches
#             our handler. On Windows process.kill() is an unconditional
#             TerminateProcess — the retiring worker is shot, its in-flight
#             requests reset, and apps/api/src/lifecycle.ts never runs.
#
#   restart <pm_id> -> pm_id stays numeric, so killProcess() honours
#             shutdown_with_message and sends 'shutdown' over IPC. lifecycle.ts
#             drains, finishes in-flight requests, closes the postgres-js pool,
#             and exits 0.
#
# Restarting ONE worker at a time is what keeps this at zero downtime: the
# sibling serves throughout. Measured on this very app — 2038/2038 requests
# answered 200 across a full rolling restart of both workers, with
# `draining (pm2-shutdown-message)` and `drain complete` in the logs. The same
# run via `pm2 reload` also served 1928/1928, but logged `draining (SIGINT)` —
# the path that is a hard kill on Windows.
#
# THE ONE THING THIS DOES NOT DO
# ------------------------------
# `pm2 restart <pm_id>` reuses PM2's IN-MEMORY copy of the app config. It does
# NOT re-read the ecosystem file, even though the deploy just overwrote it on
# disk. Code changes land (the script path is unchanged and Node re-reads the
# source); changes to the `env:` block, `instances`, or `exec_mode` DO NOT.
# Those need a one-time manual cutover on the box:
#
#   pm2 delete <app>
#   pm2 start <ecosystem file>
#   pm2 save
#
# That is the same manual step exec_mode already required, so this adds no new
# class of chore — but it is silent if you forget, which is why it is stated
# here and echoed at the end of every run.
#
# Usage (run from the box's app folder; the deploy SSH step Set-Locations there):
#   powershell -NoProfile -File deploy\pm2-roll.ps1 -AppName smartplan-advisor-dev -Config ecosystem.dev.config.cjs
param(
  [Parameter(Mandatory = $true)][string]$AppName,
  [Parameter(Mandatory = $true)][string]$Config,
  # Overrides the API_PORT read from .env. Only needed if .env is unreadable.
  [int]$Port = 0,
  [int]$HealthTimeoutSec = 90
)
$ErrorActionPreference = "Stop"

# Same dotenv-compatible reader as deploy/db-deploy.ps1: trim, then strip a
# matched pair of surrounding quotes (a quoted value works for the app via
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

# Probes /api/health. NOTE this deliberately differs from the SmartPlan twin,
# which probes "/" so that the check also exercises static file serving. Here
# there is no static serving to exercise: IIS serves the built PWA straight off
# disk and this process is a pure API, so Fastify has no "/" route at all and a
# root probe would 404 forever. /api/health is the only honest liveness signal.
function Test-Healthy([int]$port, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  $lastErr = "no attempt made"
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -UseBasicParsing -TimeoutSec 5 -MaximumRedirection 0
      if ($resp.StatusCode -eq 200) { return $true }
      $lastErr = "HTTP $($resp.StatusCode)"
    } catch {
      $lastErr = $_.Exception.Message
    }
    Start-Sleep -Milliseconds 750
  }
  Write-Host "roll: health check failed: $lastErr"
  return $false
}

function Get-InstanceIds([string]$app) {
  $raw = (& pm2 jlist 2>$null | Out-String).Trim()
  # PM2 can print warnings before the JSON, so start at the array.
  $start = $raw.IndexOf('[')
  if ($start -lt 0) { return @() }
  try { $procs = $raw.Substring($start) | ConvertFrom-Json } catch { return @() }
  return @($procs | Where-Object { $_.name -eq $app } | Sort-Object pm_id | ForEach-Object { $_.pm_id })
}

if (-not (Test-Path $Config)) { Write-Error "roll: ecosystem file not found: $Config"; exit 1 }

if ($Port -le 0) {
  # 4000 matches apps/api/src/env.ts's default, so a missing API_PORT fails the
  # health check the same way the app itself would fail to be reachable.
  $Port = [int]($(if ($p = Get-EnvValue 'API_PORT') { $p } else { 4000 }))
}
Write-Host "roll: app=$AppName config=$Config port=$Port"

$ids = Get-InstanceIds $AppName
$rollFailure = $null

if ($ids.Count -eq 0) {
  # First run on a fresh box, or after a manual `pm2 delete`. Nothing is serving,
  # so there is nothing to keep alive and no rolling to do.
  Write-Host "roll: $AppName is not running - starting it from $Config ..."
  & pm2 start $Config
  if ($LASTEXITCODE -ne 0) { Write-Error "roll: pm2 start failed ($LASTEXITCODE)"; exit 1 }
} elseif ($ids.Count -eq 1) {
  # Fork mode, or a 1-instance cluster. A rolling restart needs a sibling to
  # serve while a worker is down, so this is a brief interruption (~2-4s) — but
  # it still DRAINS, because pm_id is numeric and shutdown_with_message applies.
  # That alone is an improvement on the `startOrReload` this replaces, which
  # hard-killed the process mid-request on Windows.
  Write-Host "roll: $AppName has 1 instance - plain restart (brief interruption, but graceful)."
  & pm2 restart $AppName --update-env
  if ($LASTEXITCODE -ne 0) { Write-Host "roll: pm2 restart reported failure ($LASTEXITCODE)" }
} else {
  Write-Host "roll: rolling restart of $($ids.Count) workers ($($ids -join ', ')) ..."
  # $wid, not $id: PowerShell variable names are case-INSENSITIVE, so a loop
  # variable named $id would silently clobber a parameter of that name. This
  # script has none today; the SmartPlan twin does, and these two are meant to
  # stay copy-pasteable between each other.
  foreach ($wid in $ids) {
    Write-Host "roll:   pm2 restart $wid ..."
    & pm2 restart $wid --update-env
    if ($LASTEXITCODE -ne 0) { Write-Host "roll:   pm2 restart $wid reported failure ($LASTEXITCODE)" }
    # Gate on the NEXT worker only after this one answers, so a broken build
    # takes down one worker instead of all of them.
    if (-not (Test-Healthy $Port 60)) { $rollFailure = $wid; break }
  }
}

# `$null -ne`, not `if ($rollFailure)`: pm_id 0 is a real worker id and is falsy
# in PowerShell, so the truthiness form would silently ignore a failure on the
# first worker — the most likely one to fail.
if ($null -ne $rollFailure) {
  Write-Error "roll: worker $rollFailure did not come back healthy - aborting the roll. Remaining workers still serve the PREVIOUS code; run ``pm2 logs $AppName`` and fix forward."
  exit 1
}

if (-not (Test-Healthy $Port $HealthTimeoutSec)) {
  # There is no auto-rollback here, and that is deliberate rather than an
  # omission. The SmartPlan twin can roll back because it deploys into
  # releases\<id> behind a junction; this app is extracted OVER its own files in
  # place, so the previous code no longer exists on disk. Fail loudly instead of
  # pretending to recover.
  Write-Error "roll: $AppName is NOT healthy on port $Port after ${HealthTimeoutSec}s. The app may be DOWN - check ``pm2 logs $AppName``."
  exit 1
}

Write-Host "roll: healthy on port $Port."
& pm2 save
& pm2 list

# Echoed every run, because this is the failure mode that looks like success:
# the deploy is green, the new code is live, and an ecosystem `env:` change you
# made in the same commit is quietly not applied.
Write-Host "roll: NOTE - code changes are live. Changes to $Config (env:, instances, exec_mode) are NOT: run ``pm2 delete $AppName``; ``pm2 start $Config``; ``pm2 save`` on the box to apply those."
