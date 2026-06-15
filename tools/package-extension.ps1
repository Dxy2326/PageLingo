param(
  [string]$OutDir
)

$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $Root "manifest.json") | ConvertFrom-Json
if (-not $OutDir) { $OutDir = Join-Path $Root "dist" }

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Name = "$($Manifest.name)-$($Manifest.version).zip"
$Zip = Join-Path $OutDir $Name
if (Test-Path $Zip) { Remove-Item $Zip -Force }

$Stage = Join-Path ([IO.Path]::GetTempPath()) "pagelingo-$([guid]::NewGuid())"
New-Item -ItemType Directory -Force -Path $Stage | Out-Null

$SkipDirs = @(".git", "dist", "node_modules", ".vscode", ".idea")
$SkipFiles = @("secrets.js")
$RootPrefix = $Root.TrimEnd("\") + "\"

try {
  Get-ChildItem -Path $Root -Recurse -File | ForEach-Object {
    $Rel = $_.FullName.Substring($RootPrefix.Length)
    $Top = $Rel.Split("\")[0]

    if ($SkipDirs -contains $Top) { return }
    if ($SkipFiles -contains $_.Name) { return }
    if ($_.Name -like "*.log" -or $_.Name -like "*.tmp" -or $_.Name -like ".env*") { return }

    $Target = Join-Path $Stage $Rel
    New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $Target
  }

  # ponytail: staging keeps archive paths clean; add signing only when store releases need it.
  Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $Zip -Force
}
finally {
  Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Created $Zip"
