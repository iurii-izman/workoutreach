$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  & docker compose -f compose.yaml -f compose.local.yaml stop workoutreach-bot workoutreach-proxy workoutreach-n8n workoutreach-postgres
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  [pscustomobject]@{ ok = $true; status = 'stopped'; volumes_preserved = $true } | ConvertTo-Json
} finally {
  Pop-Location
}
