$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$compose = @('compose', '-f', 'compose.yaml', '-f', 'compose.local.yaml')
Set-Location -LiteralPath $root

& node scripts/validate-workflows.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& node scripts/prepare-workflow-import.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Get-ChildItem -LiteralPath '.\artifacts\workflow-import' -Filter '*.json' | Sort-Object Name | ForEach-Object {
  & docker @compose cp $_.FullName "workoutreach-n8n:/tmp/$($_.Name)"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & docker @compose exec -T workoutreach-n8n /workoutreach/n8n-entrypoint.sh import:workflow --input="/tmp/$($_.Name)"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
