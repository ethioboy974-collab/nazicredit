$ErrorActionPreference = "Stop"

$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackupRoot = Join-Path $ProjectDir "migration-backup"
$MySql = "C:\xampp\mysql\bin\mysql.exe"

function Read-EnvFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
      continue
    }

    $parts = $trimmed.Split("=", 2)
    $values[$parts[0].Trim()] = $parts[1].Trim()
  }

  return $values
}

function Quote-Cmd {
  param([string]$Value)
  '"' + $Value.Replace('"', '\"') + '"'
}

function Get-EnvValue {
  param(
    [hashtable]$Values,
    [string]$Name,
    [string]$Default
  )

  if ($Values.ContainsKey($Name) -and $Values[$Name] -ne "") {
    return $Values[$Name]
  }

  return $Default
}

if (-not (Test-Path $MySql)) {
  throw "Could not find XAMPP mysql at $MySql. Install XAMPP and start MySQL first."
}

$latestBackup = $null
if (Test-Path $BackupRoot) {
  $latestBackup = Get-ChildItem -Path $BackupRoot -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if ($null -eq $latestBackup) {
  throw "No migration backup folder found. Put the migration-backup folder inside this app folder."
}

$dumpFile = Join-Path $latestBackup.FullName "customer_credit.sql"
if (-not (Test-Path $dumpFile)) {
  throw "Could not find customer_credit.sql in $($latestBackup.FullName)."
}

$envValues = Read-EnvFile -Path (Join-Path $ProjectDir ".env")
$dbHost = Get-EnvValue -Values $envValues -Name "DB_HOST" -Default "127.0.0.1"
$dbPort = Get-EnvValue -Values $envValues -Name "DB_PORT" -Default "3306"
$dbUser = Get-EnvValue -Values $envValues -Name "DB_USER" -Default "root"
$dbPassword = Get-EnvValue -Values $envValues -Name "DB_PASSWORD" -Default ""

Write-Host ""
Write-Host "Restoring MySQL database..."

$commandParts = @(
  (Quote-Cmd $MySql),
  "-h", (Quote-Cmd $dbHost),
  "-P", (Quote-Cmd $dbPort),
  "-u", (Quote-Cmd $dbUser)
)

if ($dbPassword) {
  $commandParts += Quote-Cmd "--password=$dbPassword"
}

$commandParts += "<"
$commandParts += Quote-Cmd $dumpFile

cmd.exe /c ($commandParts -join " ")
if ($LASTEXITCODE -ne 0) {
  throw "MySQL restore failed."
}

$cloudflareStaging = Join-Path $latestBackup.FullName "cloudflared-private"
if (Test-Path $cloudflareStaging) {
  $cloudflareTarget = Join-Path $env:USERPROFILE ".cloudflared"
  Write-Host "Restoring Cloudflare tunnel files..."
  New-Item -ItemType Directory -Force -Path $cloudflareTarget | Out-Null
  Copy-Item -LiteralPath (Join-Path $cloudflareStaging "*") -Destination $cloudflareTarget -Recurse -Force
} else {
  Write-Warning "No Cloudflare tunnel files found in this backup. Run setup-nazicredit-permanent-tunnel.bat on this PC if the tunnel will not start."
}

Write-Host ""
Write-Host "Restore complete."
Write-Host "Next, start XAMPP Apache/MySQL, then run start-server.bat and start-permanent-tunnel.bat."
