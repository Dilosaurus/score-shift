$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$ready = $false
try { $ready = (Invoke-RestMethod 'http://127.0.0.1:5173/api/health' -TimeoutSec 2).engine -like 'Audiveris*' } catch {}
if (!$ready) {
  $nodePath = (Get-Command node).Source
  New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot '.runtime') | Out-Null
  Start-Process -FilePath $nodePath -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot '.runtime/server.out.log') -RedirectStandardError (Join-Path $PSScriptRoot '.runtime/server.err.log')
}
Write-Output 'ScoreShift: http://127.0.0.1:5173'
