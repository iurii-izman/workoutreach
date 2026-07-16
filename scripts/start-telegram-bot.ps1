$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root '.runtime'
$lockPath = Join-Path $runtime 'telegram-bot.lock'
$statusPath = Join-Path $runtime 'telegram-bot-status.json'
$stdoutPath = Join-Path $runtime 'telegram-bot.stdout.log'
$stderrPath = Join-Path $runtime 'telegram-bot.stderr.log'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

if (Test-Path -LiteralPath $lockPath) {
  $existingPid = [int](Get-Content -Raw -LiteralPath $lockPath).Trim()
  if (Get-Process -Id $existingPid -ErrorAction SilentlyContinue) {
    [pscustomobject]@{ ok = $true; status = 'already_running'; mail_transport = 'disabled' } | ConvertTo-Json
    exit 0
  }
  Remove-Item -LiteralPath $lockPath -Force
}

$node = (Get-Command node -ErrorAction Stop).Source
$process = Start-Process -FilePath $node `
  -ArgumentList @('--env-file=.env', 'scripts/telegram-bot.mjs') `
  -WorkingDirectory $root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

$deadline = [DateTime]::UtcNow.AddSeconds(20)
do {
  Start-Sleep -Milliseconds 250
  if (Test-Path -LiteralPath $statusPath) {
    $status = Get-Content -Raw -LiteralPath $statusPath | ConvertFrom-Json
    if ($status.pid -eq $process.Id -and $status.status -eq 'running') {
      [pscustomobject]@{ ok = $true; status = 'running'; mode = $status.mode; mail_transport = $status.mail_transport } | ConvertTo-Json
      exit 0
    }
    if ($status.pid -eq $process.Id -and $status.status -eq 'failed') { break }
  }
} while ([DateTime]::UtcNow -lt $deadline -and -not $process.HasExited)

[pscustomobject]@{ ok = $false; status = 'start_failed'; process_exited = $process.HasExited } | ConvertTo-Json
exit 1
