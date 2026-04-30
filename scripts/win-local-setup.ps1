$ErrorActionPreference = "Stop"

$src = (Resolve-Path "$PSScriptRoot\..").Path
$destRoot = "C:\dev"
$dest = Join-Path $destRoot "mxlplayer"

Write-Host "Source: $src"
Write-Host "Dest:   $dest"

if (-not (Test-Path $destRoot)) {
  New-Item -ItemType Directory -Path $destRoot | Out-Null
}

if (Test-Path $dest) {
  Write-Host "Removing existing $dest"
  Remove-Item -Recurse -Force $dest
}

Write-Host "Copying project to short path..."
Copy-Item -Recurse -Force -Path "$src\*" -Destination $dest

Set-Location $dest

Write-Host "Installing dependencies..."
npm install

Write-Host ""
Write-Host "Done. Run:"
Write-Host "  cd $dest"
Write-Host "  npm run dev"

