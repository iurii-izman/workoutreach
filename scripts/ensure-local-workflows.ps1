$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$compose = @('compose', '-f', 'compose.yaml', '-f', 'compose.local.yaml')
Set-Location -LiteralPath $root

$expected = @(
  '01_telegram_ingest',
  '02_analyze_company',
  '03_render_review',
  '04_telegram_actions',
  '05_mock_dispatch',
  '90_error_handler'
)

function Get-LocalWorkflowList {
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    $output = & docker @compose exec -T workoutreach-n8n /workoutreach/n8n-entrypoint.sh list:workflow 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -eq 0) {
      return @($output | Where-Object { $_ -match '^wo[A-Za-z0-9]+\|' })
    }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "N8N_WORKFLOW_LIST_FAILED: n8n did not become ready within 90 seconds"
}

$listed = Get-LocalWorkflowList
$names = @($listed | ForEach-Object { ($_ -split '\|', 2)[1].Trim() })
$present = @($expected | Where-Object { $names -contains $_ })

if ($present.Count -eq $expected.Count) {
  [pscustomobject]@{ ok = $true; workflows = $expected.Count; action = 'reused' } | ConvertTo-Json -Compress
  exit 0
}

if ($present.Count -ne 0) {
  throw "N8N_WORKFLOW_SET_PARTIAL: found $($present.Count) of $($expected.Count); refusing an automatic overwrite"
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'import-workflows.ps1')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$verified = Get-LocalWorkflowList
$verifiedNames = @($verified | ForEach-Object { ($_ -split '\|', 2)[1].Trim() })
foreach ($name in $expected) {
  if ($verifiedNames -notcontains $name) {
    throw "N8N_WORKFLOW_IMPORT_INCOMPLETE: $name"
  }
}

[pscustomobject]@{ ok = $true; workflows = $expected.Count; action = 'imported_inactive' } | ConvertTo-Json -Compress
