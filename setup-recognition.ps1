$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$runtime = Join-Path $PSScriptRoot '.runtime'
New-Item -ItemType Directory -Force $runtime | Out-Null
$msi = Join-Path $runtime 'audiveris.msi'
if (!(Test-Path $msi)) { Invoke-WebRequest 'https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-windowsConsole-x86_64.msi' -OutFile $msi }
if ((Get-FileHash $msi -Algorithm SHA256).Hash -ne '5F1B4E96A12C53C7DA426814B76E599363C4181E291855996E0A6878DDA95F71') { throw 'Recognition engine checksum mismatch.' }
$extracted = Join-Path $runtime 'audiveris'
if (!(Test-Path $extracted)) {
  $sevenZip = 'C:/Program Files/7-Zip/7z.exe'
  if (!(Test-Path $sevenZip)) { throw '7-Zip is required to extract the portable recognition engine.' }
  & $sevenZip x $msi "-o$extracted" -y | Out-Null
}
$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.OpenDatabase($msi, 0)
$dirs = @{}; $components = @{}
$v = $db.OpenView('SELECT Directory, Directory_Parent, DefaultDir FROM Directory'); $v.Execute()
while ($r = $v.Fetch()) { $dirs[$r.StringData(1)] = @($r.StringData(2), $r.StringData(3)) }
$v = $db.OpenView('SELECT Component, Directory_ FROM Component'); $v.Execute()
while ($r = $v.Fetch()) { $components[$r.StringData(1)] = $r.StringData(2) }
function Get-RelativeDirectory([string]$id) {
  if (!$id -or $id -eq 'TARGETDIR') { return '' }
  $entry = $dirs[$id]
  $name = ($entry[1] -split '\|')[-1]
  if ($name -eq '.' -or $name -eq 'SourceDir') { $name = '' }
  $parent = Get-RelativeDirectory $entry[0]
  if (!$parent) { return $name }; if (!$name) { return $parent }
  return Join-Path $parent $name
}
$target = Join-Path $runtime 'engine'
$v = $db.OpenView('SELECT File, Component_, FileName FROM File'); $v.Execute()
$count = 0
while ($r = $v.Fetch()) {
  $name = ($r.StringData(3) -split '\|')[-1]
  $rel = Get-RelativeDirectory $components[$r.StringData(2)]
  $folder = if ($rel) { Join-Path $target $rel } else { $target }
  New-Item -ItemType Directory -Force $folder | Out-Null
  Copy-Item -LiteralPath (Join-Path $extracted $r.StringData(1)) -Destination (Join-Path $folder $name)
  $count++
}
Write-Output "Portable recognition engine ready: $count files."
Get-ChildItem $target -Recurse -Filter Audiveris.exe | Select-Object -ExpandProperty FullName
$languageFolder = Join-Path $env:APPDATA 'AudiverisLtd/audiveris/config/tessdata'
New-Item -ItemType Directory -Force $languageFolder | Out-Null
$languageFile = Join-Path $languageFolder 'eng.traineddata'
if (!(Test-Path $languageFile) -or (Get-FileHash $languageFile -Algorithm SHA256).Hash -ne 'DAA0C97D651C19FBA3B25E81317CD697E9908C8208090C94C3905381C23FC047') {
  Invoke-WebRequest 'https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/eng.traineddata' -OutFile $languageFile
}
if ((Get-FileHash $languageFile -Algorithm SHA256).Hash -ne 'DAA0C97D651C19FBA3B25E81317CD697E9908C8208090C94C3905381C23FC047') { throw 'OCR language checksum mismatch.' }
Write-Output 'English OCR ready (includes the legacy engine required by Audiveris).'
