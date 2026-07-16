$ErrorActionPreference = 'Stop'
node scripts/validate-workflows.mjs
node scripts/prepare-workflow-import.mjs
Get-ChildItem -LiteralPath '.\artifacts\workflow-import' -Filter '*.json' | Sort-Object Name | ForEach-Object {
  docker compose cp $_.FullName "workoutreach-n8n:/tmp/$($_.Name)"
  docker compose exec -T workoutreach-n8n /workoutreach/n8n-entrypoint.sh import:workflow --input="/tmp/$($_.Name)"
}
