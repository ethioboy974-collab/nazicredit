param(
  [Parameter(Mandatory = $true)]
  [string]$Hostname,

  [string]$TunnelName = "customer-credit-ledger",

  [switch]$OverwriteDns
)

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Cloudflared = Join-Path $ProjectDir "tools\cloudflared.exe"
$StarterFile = Join-Path $ProjectDir "start-permanent-tunnel.bat"
$CertPath = Join-Path $env:USERPROFILE ".cloudflared\cert.pem"

function Get-TunnelByName {
  param([string]$Name)

  $raw = & $Cloudflared tunnel list --output json --name $Name 2>$null
  if (-not $raw) {
    return $null
  }

  $items = $raw | ConvertFrom-Json
  if ($null -eq $items) {
    return $null
  }

  @($items) | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}

if (-not (Test-Path $Cloudflared)) {
  throw "Missing tools\cloudflared.exe. Ask Codex to set up the public tunnel tool again."
}

if ($Hostname -notmatch "^[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}$") {
  throw "Use a full address like credit.yourstore.com."
}

Write-Host ""
Write-Host "Permanent tunnel setup"
Write-Host "Address: https://$Hostname"
Write-Host "Tunnel:  $TunnelName"
Write-Host ""
Write-Host "Step 1 of 4: checking the local app..."

try {
  Invoke-WebRequest -Uri "http://127.0.0.1:5500/login" -UseBasicParsing -TimeoutSec 5 | Out-Null
  Write-Host "Local app is running."
} catch {
  Write-Warning "The app is not answering at http://127.0.0.1:5500/login. Start it before testing the public address."
}

Write-Host ""
Write-Host "Step 2 of 4: logging into Cloudflare..."
if (Test-Path $CertPath) {
  Write-Host "Cloudflare login certificate already exists."
} else {
  Write-Host "A browser window may open. Sign in, then choose the domain that owns $Hostname."
  & $Cloudflared tunnel login
}

Write-Host ""
Write-Host "Step 3 of 4: creating or reusing the named tunnel..."
$tunnel = Get-TunnelByName -Name $TunnelName
if ($null -eq $tunnel) {
  & $Cloudflared tunnel create $TunnelName
  $tunnel = Get-TunnelByName -Name $TunnelName
}

if ($null -eq $tunnel) {
  throw "Cloudflare did not return the tunnel after creating it."
}

Write-Host "Tunnel ID: $($tunnel.id)"

Write-Host ""
Write-Host "Step 4 of 4: pointing the address to the tunnel..."
$routeArgs = @("tunnel", "route", "dns")
if ($OverwriteDns) {
  $routeArgs += "--overwrite-dns"
}
$routeArgs += @($TunnelName, $Hostname)
& $Cloudflared @routeArgs

$starter = @"
@echo off
cd /d "%~dp0"
echo Starting permanent public link for Customer Credit Ledger...
echo Address: https://$Hostname
echo Keep this window open unless the tunnel is installed as a Windows service.
echo.
tools\cloudflared.exe tunnel --no-autoupdate run --url http://127.0.0.1:5500 $TunnelName
pause
"@

Set-Content -Path $StarterFile -Value $starter -Encoding ASCII

Write-Host ""
Write-Host "Done."
Write-Host "Permanent address: https://$Hostname"
Write-Host "Starter created: $StarterFile"
Write-Host ""
Write-Host "Next: set PUBLIC_ORIGIN=https://$Hostname and COOKIE_SECURE=true in .env, then restart the app."
