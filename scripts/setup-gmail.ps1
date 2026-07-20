$ErrorActionPreference = 'Stop'

$secure = Read-Host 'Enter the 16-character Google App Password (input is hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $plain | & node (Join-Path $PSScriptRoot 'configure-gmail-secret.mjs')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  if ($null -ne $plain) { $plain = $null }
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start-local-stage2.ps1')
exit $LASTEXITCODE
