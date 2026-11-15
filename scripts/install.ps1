$ErrorActionPreference = "Stop"

$Repo = if ($env:BEACON_REPO) { $env:BEACON_REPO } else { "nannndev/beacon" }
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"

Write-Host "==> Fetching latest Beacon release from $Repo..." -ForegroundColor Cyan
$Release = Invoke-RestMethod -Uri $ApiUrl -Headers @{ "User-Agent" = "beacon-installer" }

$Asset = $Release.assets | Where-Object { $_.name -match '-setup\.exe$' } | Select-Object -First 1
if (-not $Asset) {
  $Asset = $Release.assets | Where-Object { $_.name -match '\.exe$' } | Select-Object -First 1
}
if (-not $Asset) {
  throw "Could not find a Windows .exe installer in the latest release."
}

$TempDir = Join-Path $env:TEMP ("beacon-install-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

try {
  $InstallerPath = Join-Path $TempDir $Asset.name
  Write-Host "==> Downloading $($Asset.browser_download_url)..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $InstallerPath -UseBasicParsing

  Write-Host "==> Running Beacon installer..." -ForegroundColor Cyan
  Start-Process -FilePath $InstallerPath -ArgumentList "/S" -Wait
  Write-Host "Beacon installed successfully!" -ForegroundColor Green
}
finally {
  Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
}

