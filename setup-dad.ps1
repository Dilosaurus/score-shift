# One-time setup for a transcription machine. Run from the project folder in PowerShell.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Need($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) { throw "$name is not installed. $hint" }
}
Need node   'Install Node.js LTS: winget install --id OpenJS.NodeJS.LTS -e'
Need npm    'Install Node.js LTS: winget install --id OpenJS.NodeJS.LTS -e'
Need python 'Install Python: winget install --id Python.Python.3.12 -e'
Need git    'Install Git: winget install --id Git.Git -e'
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  Write-Warning 'gcloud is not installed yet (winget install --id Google.CloudSDK -e). Transcribing works without it; publishing does not.'
}

Write-Output "node $(node -v), python $(python --version)"
Write-Output 'Installing JavaScript dependencies (exact versions from package-lock.json)...'
npm ci
Write-Output 'Installing Python dependencies...'
python -m pip install --upgrade pip | Out-Null
python -m pip install -r requirements.txt
Write-Output 'Running the tests...'
npm test
npm run test:chart
Write-Output ''
Write-Output 'ready'
Write-Output 'Next: gcloud auth login   (then: python tools\chart\chart.py publish --dry-run)'
