@echo off
cd /d "%~dp0"
echo Setting up permanent tunnel for:
echo   https://credit.nazicredit.com
echo.
echo Make sure nazicredit.com is Active in Cloudflare first.
echo.
powershell -ExecutionPolicy Bypass -File setup-permanent-tunnel.ps1 -Hostname credit.nazicredit.com -TunnelName customer-credit-ledger
pause
