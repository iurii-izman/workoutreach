$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  & node --env-file=.env scripts/gmail-self-test.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-stage2.ps1
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
