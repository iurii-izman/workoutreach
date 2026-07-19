$ErrorActionPreference = 'Stop'

& node (Join-Path $PSScriptRoot 'configure-gmail-secret.mjs') --disable
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-local-stage2.ps1')
exit $LASTEXITCODE
