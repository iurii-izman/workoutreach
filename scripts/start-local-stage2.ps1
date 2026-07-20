$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$compose = @('compose', '-f', 'compose.yaml', '-f', 'compose.local.yaml')
Set-Location -LiteralPath $root

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stop-telegram-bot.ps1') | Out-Null
& node --env-file=.env scripts/bootstrap-local-runtime-secrets.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node scripts/bootstrap-dev-secrets.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& docker @compose config --quiet
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& docker @compose up -d workoutreach-postgres workoutreach-n8n workoutreach-proxy
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& docker @compose --profile tools run --rm workoutreach-migrate
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'ensure-local-workflows.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& docker @compose up -d --build workoutreach-bot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$deadline = [DateTime]::UtcNow.AddMinutes(3)
do {
  Start-Sleep -Seconds 2
  $state = & docker inspect --format '{{.State.Health.Status}}' workoutreach-bot 2>$null
  if ($LASTEXITCODE -eq 0 -and $state -eq 'healthy') {
    [pscustomobject]@{
      ok = $true
      mode = 'local-postgres-long-polling'
      postgres = 'internal-only'
      n8n = 'local-only'
      public_webhook = $false
      mail_transport = 'see npm run local:status'
    } | ConvertTo-Json
    exit 0
  }
} while ([DateTime]::UtcNow -lt $deadline)

[pscustomobject]@{ ok = $false; status = 'bot_health_timeout' } | ConvertTo-Json
exit 1
