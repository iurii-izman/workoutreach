$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$lockPath = Join-Path $runtime 'telegram-bot.lock'
$statusPath = Join-Path $runtime 'telegram-bot-status.json'

if (-not (Test-Path -LiteralPath $lockPath)) {
  [pscustomobject]@{ ok = $true; status = 'not_running' } | ConvertTo-Json
  exit 0
}

$botPid = [int](Get-Content -Raw -LiteralPath $lockPath).Trim()
$process = Get-Process -Id $botPid -ErrorAction SilentlyContinue
if ($process) {
  Stop-Process -Id $botPid -Force
  $process.WaitForExit(5000) | Out-Null
}
Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue
[pscustomobject]@{ ok = $true; status = 'stopped' } | ConvertTo-Json
