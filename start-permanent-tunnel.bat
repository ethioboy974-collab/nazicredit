@echo off
cd /d "%~dp0"
echo Starting permanent public link for Customer Credit Ledger...
echo Address: https://credit.nazicredit.com
echo Keep this window open unless the tunnel is installed as a Windows service.
echo.
tools\cloudflared.exe tunnel --no-autoupdate run --url http://127.0.0.1:5500 customer-credit-ledger
pause
