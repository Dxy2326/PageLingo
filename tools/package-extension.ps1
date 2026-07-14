param(
  [string]$OutDir
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "manifest.json") | ConvertFrom-Json
if (-not $OutDir) { $OutDir = Join-Path $Root "dist" }

$PackageFiles = @(
  "manifest.json",
  "service-worker.js",
  "shared-utils.js",
  "x-content.js",
  "web-translator.js",
  "site-profiles.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "providers.js",
  "personas.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "README.md",
  "PRIVACY.md",
  "LICENSE"
)

foreach ($Rel in $PackageFiles) {
  if (-not (Test-Path (Join-Path $Root $Rel))) {
    throw "Missing required file: $Rel"
  }
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  Get-ChildItem -Path $Root -Filter "*.js" -File -Recurse |
    Where-Object { $_.FullName -notmatch '[\\/](\.git|dist|node_modules)[\\/]' } |
    ForEach-Object {
    & node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax check failed: $($_.Name)" }
  }
  $TestFiles = @(Get-ChildItem -Path (Join-Path $Root "tests") -Filter "*.test.js" -File -ErrorAction SilentlyContinue)
  if ($TestFiles.Count -gt 0) {
    & node --test ($TestFiles | ForEach-Object FullName)
    if ($LASTEXITCODE -ne 0) { throw "JavaScript tests failed" }
  }
} else {
  Write-Warning "node not found; skipped JavaScript syntax checks and tests"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Name = "$($Manifest.name)-$($Manifest.version).zip"
$Zip = Join-Path $OutDir $Name
if (Test-Path $Zip) { Remove-Item $Zip -Force }

$Stage = Join-Path ([IO.Path]::GetTempPath()) "pagelingo-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

try {
  foreach ($Rel in $PackageFiles) {
    $Source = Join-Path $Root $Rel
    $Target = Join-Path $Stage $Rel
    New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Target
  }

  # ponytail: staging keeps archive paths clean; add signing only when store releases need it.
  Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Zip -Force

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Archive = [IO.Compression.ZipFile]::OpenRead($Zip)
  try {
    $Names = $Archive.Entries | ForEach-Object FullName
    if ($Names -notcontains "manifest.json") { throw "Package missing manifest.json" }
    $Forbidden = $Names | Where-Object {
      $_ -match '(^|[\\/])(\.git|dist|node_modules|\.vscode|\.idea)([\\/]|$)' -or
      $_ -match '(^|[\\/])secrets\.js$'
    }
    if ($Forbidden) { throw "Package contains forbidden file: $($Forbidden -join ', ')" }
  }
  finally {
    $Archive.Dispose()
  }
}
finally {
  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Created $Zip"
