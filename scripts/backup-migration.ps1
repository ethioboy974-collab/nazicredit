$ErrorActionPreference = "Stop"

$ProjectDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$BackupRoot = Join-Path $ProjectDir "migration-backup"
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupDir = Join-Path $BackupRoot $Stamp
$AppStaging = Join-Path $BackupDir "customer-credit-app"
$CloudflareSource = Join-Path $env:USERPROFILE ".cloudflared"
$CloudflareStaging = Join-Path $BackupDir "cloudflared-private"
$DumpFile = Join-Path $BackupDir "customer_credit.sql"
$ZipFile = Join-Path $BackupRoot "customer-credit-migration-$Stamp.zip"
$MySqlDump = "C:\xampp\mysql\bin\mysqldump.exe"

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

function Copy-ProjectFiles {
  New-Item -ItemType Directory -Force -Path $AppStaging | Out-Null

  $skipDirs = @(".git", ".chrome-dump-profile", "migration-backup")
  $skipFilePatterns = @("*.log")

  Get-ChildItem -Path $ProjectDir -Force | ForEach-Object {
    if ($_.PSIsContainer -and $skipDirs -contains $_.Name) {
      return
    }

    foreach ($pattern in $skipFilePatterns) {
      if ($_.Name -like $pattern) {
        return
      }
    }

    Copy-Item -LiteralPath $_.FullName -Destination $AppStaging -Recurse -Force
  }
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

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

if (-not (Test-Path $MySqlDump)) {
  throw "Could not find XAMPP mysqldump at $MySqlDump. Start from the old PC with XAMPP installed."
}

$envValues = Read-EnvFile -Path (Join-Path $ProjectDir ".env")
$dbHost = Get-EnvValue -Values $envValues -Name "DB_HOST" -Default "127.0.0.1"
$dbPort = Get-EnvValue -Values $envValues -Name "DB_PORT" -Default "3306"
$dbUser = Get-EnvValue -Values $envValues -Name "DB_USER" -Default "root"
$dbPassword = Get-EnvValue -Values $envValues -Name "DB_PASSWORD" -Default ""
$dbName = Get-EnvValue -Values $envValues -Name "DB_NAME" -Default "customer_credit"

Write-Host ""
Write-Host "Creating MySQL backup..."

$dumpArgs = @(
  "-h", $dbHost,
  "-P", $dbPort,
  "-u", $dbUser,
  "--databases", $dbName,
  "--routines",
  "--events",
  "--triggers",
  "--single-transaction",
  "--result-file=$DumpFile"
)

if ($dbPassword) {
  $dumpArgs += "--password=$dbPassword"
}

& $MySqlDump @dumpArgs
if ($LASTEXITCODE -ne 0) {
  throw "MySQL backup failed."
}

Write-Host "Copying app files..."
Copy-ProjectFiles

if (Test-Path $CloudflareSource) {
  Write-Host "Copying private Cloudflare tunnel files..."
  Copy-Item -LiteralPath $CloudflareSource -Destination $CloudflareStaging -Recurse -Force
} else {
  Write-Warning "Cloudflare tunnel folder was not found at $CloudflareSource."
}

$readme = @"
Customer Credit Migration Backup
Created: $(Get-Date)

Use this package only on the new store PC.
Keep it private. It contains the app settings and Cloudflare tunnel files.

On the new PC:
1. Install XAMPP.
2. Start Apache and MySQL in XAMPP.
3. Install Node.js LTS if this PC does not have Node.
4. Copy the customer-credit-app folder to Documents.
5. Open the copied customer-credit-app folder.
6. Double-click restore-on-new-pc.bat.
7. Double-click start-server.bat.
8. Double-click start-permanent-tunnel.bat.
9. Open https://credit.nazicredit.com/login and test.

After the new PC works, stop start-server.bat and start-permanent-tunnel.bat on the old PC.
"@

Set-Content -Path (Join-Path $BackupDir "READ-ME-FIRST.txt") -Value $readme -Encoding ASCII

Write-Host "Creating migration zip..."
Compress-Archive -Path (Join-Path $BackupDir "*") -DestinationPath $ZipFile -Force

Write-Host ""
Write-Host "Migration backup created:"
Write-Host $ZipFile
Write-Host ""
Write-Host "Keep this zip private. Move it to the new PC with a USB drive or private transfer."
