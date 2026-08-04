@echo off
setlocal

cd /d "%~dp0"

echo.
echo Customer Credit Railway Deploy
echo Project: fabulous-upliftment
echo Service: customer-credit
echo Site:    https://credit.nazicredit.com
echo.

set "RAILWAY_CMD="
set "LOCAL_RAILWAY=%~dp0.railway-cli-temp\railway.exe"
set "RAILWAY_ZIP=%~dp0.railway-cli-temp\railway-windows.zip"
set "RAILWAY_URL=https://github.com/railwayapp/cli/releases/download/v5.30.1/railway-v5.30.1-x86_64-pc-windows-msvc.zip"

if exist "%LOCAL_RAILWAY%" (
  set RAILWAY_CMD="%LOCAL_RAILWAY%"
)

if not defined RAILWAY_CMD (
  for /f "delims=" %%R in ('dir /b /s "%USERPROFILE%\.railway\backups\railway-*.exe" 2^>nul') do set "RAILWAY_CMD=%%R"
  if defined RAILWAY_CMD echo Using the Railway deployment tool already installed on this computer.
)

if not defined RAILWAY_CMD (
  echo Railway CLI was not found. Downloading the official Windows version...
  if not exist "%~dp0.railway-cli-temp" mkdir "%~dp0.railway-cli-temp"
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri '%RAILWAY_URL%' -OutFile '%RAILWAY_ZIP%'; Expand-Archive -LiteralPath '%RAILWAY_ZIP%' -DestinationPath '%~dp0.railway-cli-temp' -Force; $exe = Get-ChildItem -LiteralPath '%~dp0.railway-cli-temp' -Filter railway.exe -Recurse | Select-Object -First 1; if (-not $exe) { throw 'railway.exe was not found in the downloaded package' }; if ($exe.FullName -ne '%LOCAL_RAILWAY%') { Copy-Item -LiteralPath $exe.FullName -Destination '%LOCAL_RAILWAY%' -Force }"
  if not errorlevel 1 (
    if exist "%LOCAL_RAILWAY%" set RAILWAY_CMD="%LOCAL_RAILWAY%"
  )
  echo.
)

if not defined RAILWAY_CMD (
  where railway >nul 2>nul
  if not errorlevel 1 (
    set "RAILWAY_CMD=railway"
  )
)

if not defined RAILWAY_CMD (
  where npx >nul 2>nul
  if not errorlevel 1 (
    set "RAILWAY_CMD=npx -y @railway/cli"
    echo Railway CLI was not found globally. This script will try npx -y @railway/cli.
    echo If npm needs to download it, this computer must have internet access.
    echo.
  )
)

if not defined RAILWAY_CMD (
  where pnpm >nul 2>nul
  if not errorlevel 1 (
    set "RAILWAY_CMD=pnpm dlx @railway/cli"
    echo Railway CLI was not found globally. This script will try pnpm dlx @railway/cli.
    echo If pnpm needs to download it, this computer must have internet access.
    echo.
  )
)

if not defined RAILWAY_CMD (
  echo Railway CLI could not be downloaded automatically.
  echo.
  echo Check your internet connection and run this file again.
  echo.
  pause
  exit /b 1
)

echo Checking Railway CLI...
call %RAILWAY_CMD% --version
if errorlevel 1 (
  echo.
  echo Railway CLI could not run.
  echo Install it globally, then run this file again:
  echo npm install -g @railway/cli
  echo.
  pause
  exit /b 1
)

echo.
echo Checking Railway login...
call %RAILWAY_CMD% whoami >nul 2>nul
if errorlevel 1 (
  echo Railway needs you to log in.
  call %RAILWAY_CMD% login
  if errorlevel 1 (
    echo.
    echo Railway login did not finish.
    pause
    exit /b 1
  )
)

echo.
if not exist ".railway" (
  echo This folder is not linked to a Railway project yet.
  echo When Railway asks, choose:
  echo   Project: fabulous-upliftment
  echo   Service: customer-credit
  echo.
  call %RAILWAY_CMD% link
  if errorlevel 1 (
    echo.
    echo Railway link did not finish.
    echo You can also run manually:
    echo railway link
    echo railway up --service customer-credit
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Deploying latest local files to Railway...
echo If Railway asks for a service, choose customer-credit.
echo.
call %RAILWAY_CMD% up --service customer-credit
if errorlevel 1 (
  echo.
  echo Deploy with --service did not finish.
  echo Retrying interactive deploy. Choose customer-credit if Railway asks.
  echo.
  call %RAILWAY_CMD% up
  if errorlevel 1 (
    echo.
    echo Railway deploy did not finish.
    echo Manual command to try from this folder:
    echo railway up --service customer-credit
    echo.
    pause
    exit /b 1
  )
)

echo.
echo Deploy request finished.
echo Open https://credit.nazicredit.com and test login plus barcode saved products.
echo.
pause
